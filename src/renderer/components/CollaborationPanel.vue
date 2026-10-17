<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { acceptInvitation, createOwnerSession, createSessionIdentity, type CollaborationStatus, type GuestPairing, type GuestSession, type OwnerSession, type PairingReview, type SessionIdentity } from '@/collaboration';
import type { DocumentAuthority } from '@/session';

const props = defineProps<{ open: boolean; authority: DocumentAuthority | null; joinGuest: (session: GuestSession) => Promise<boolean>; leaveGuest: () => Promise<boolean> }>();
const emit = defineEmits<{ close: [] }>();
const mode = ref<'invite' | 'join'>('invite'), role = ref<'viewer' | 'editor'>('viewer');
const inviteText = ref(''), incoming = ref(''), answerText = ref('');
const review = shallowRef<PairingReview | null>(null), status = shallowRef<CollaborationStatus | null>(null);
const checked = ref(false), busy = ref(false), error = ref(''), note = ref('');
let owner: OwnerSession | undefined, guest: GuestSession | undefined, pairing: GuestPairing | undefined;
let identity: Promise<SessionIdentity> | undefined, offStatus = () => {}, generation = 0, disposed = false;
const identityForSession = () => identity ??= createSessionIdentity();
const states: Record<CollaborationStatus['state'], string> = { pairing: 'Einladung vorbereiten', 'awaiting-confirmation': 'Code bestätigen', syncing: 'Diagramm abgleichen', ready: 'Verbunden', disconnected: 'Verbindung unterbrochen', 'resync-required': 'Neuer Abgleich erforderlich', revoked: 'Freigabe beendet', closed: 'Sitzung beendet' };
function report(value: unknown) {
  const code = value && typeof value === 'object' && 'message' in value ? String(value.message) : '';
  error.value = /DIRECT_CONNECTION_TIMEOUT|ICE|NOT_CONNECTED|TRANSFER_TIMEOUT|PEER_NOT_READY/.test(code)
    ? 'Eine direkte Verbindung ist in diesem Netzwerk nicht erreichbar. Es gibt keinen Vermittlungsserver. Prüft ein gemeinsam erreichbares Netzwerk und versucht eine neue Einladung.'
    : /EXPIRED/.test(code) ? 'Diese Einladung ist abgelaufen. Bitte eine neue Einladung verwenden.'
      : /COMPARISON|CONFIRM|IDENTITY|SIGNATURE|CERTIFICATE/.test(code) ? 'Identität oder Vergleichscode konnten nicht bestätigt werden. Bitte erneut direkt miteinander abgleichen.'
        : 'Die Verbindung konnte nicht bestätigt werden. Prüfe den vollständig kopierten Text und versuche es erneut.';
}
function clearPairing() { pairing?.cancel(); pairing = undefined; inviteText.value = ''; incoming.value = ''; answerText.value = ''; review.value = null; checked.value = false; }
function listen(session: OwnerSession | GuestSession) { offStatus(); status.value = session.getStatus(); offStatus = session.subscribeStatus(value => { status.value = value; }); }
watch(() => props.authority, (next, previous) => {
  if (next === previous) return;
  generation++; clearPairing(); busy.value = false; error.value = ''; note.value = '';
  if (owner) { void owner.close().catch(() => {}); owner = undefined; }
  if (next && guest) { void guest.leave().catch(() => {}); guest = undefined; }
  if (!guest) { offStatus(); offStatus = () => {}; status.value = null; }
});
async function createInvitation(resumePeerId?: string) {
  if (busy.value || !props.authority || inviteText.value) return;
  const authority = props.authority, epoch = generation;
  busy.value = true; error.value = ''; note.value = '';
  try {
    const key = await identityForSession();
    if (disposed || generation !== epoch || props.authority !== authority) return;
    if (!owner || ['closed', 'revoked'].includes(owner.getStatus().state)) {
      const created = await createOwnerSession({ authority, identity: key });
      if (disposed || generation !== epoch || props.authority !== authority) { await created.close(); return; }
      owner = created; listen(owner);
    }
    const peer = resumePeerId ? owner.getStatus().peers.find(peer => peer.peerId === resumePeerId) : undefined;
    const selectedRole = peer?.role === 'editor' ? 'editor' : peer ? 'viewer' : role.value;
    const invitation = await owner.createInvitation(selectedRole, resumePeerId ? { resumePeerId } : undefined);
    if (generation !== epoch || disposed) return;
    mode.value = 'invite'; inviteText.value = invitation.text;
    note.value = 'Sende die Einladung direkt an die andere Person. Sie gilt fünf Minuten.';
  } catch (value) { if (generation === epoch) report(value); }
  finally { if (generation === epoch) busy.value = false; }
}
async function inspectAnswer() {
  if (!owner || busy.value || !incoming.value.trim()) return;
  const current = owner, epoch = generation; busy.value = true; error.value = '';
  try { const result = await current.acceptAnswer(incoming.value.trim()); if (generation === epoch) { review.value = result; checked.value = false; } }
  catch (value) { if (generation === epoch) report(value); }
  finally { if (generation === epoch) busy.value = false; }
}
async function inspectInvitation() {
  if (busy.value || !incoming.value.trim() || owner) return;
  const epoch = generation; busy.value = true; error.value = '';
  try {
    pairing?.cancel();
    const result = guest ? await guest.acceptReconnectOffer(incoming.value.trim()) : await acceptInvitation(incoming.value.trim(), { identity: await identityForSession() });
    if (disposed || generation !== epoch) { result.cancel(); return; }
    pairing = result; answerText.value = result.answer.text; review.value = result.review; checked.value = false;
    note.value = 'Sende die Antwort zurück. Vergleicht danach den vollständigen Code über euren direkten Kontakt.';
  } catch (value) { if (generation === epoch) report(value); }
  finally { if (generation === epoch) busy.value = false; }
}
function waitUntilReady(session: GuestSession): Promise<void> {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {}, finished = false;
    const timer = setTimeout(() => finish(new Error('DIRECT_CONNECTION_TIMEOUT')), 35_000);
    const finish = (error?: Error) => { if (finished) return; finished = true; clearTimeout(timer); unsubscribe(); error ? reject(error) : resolve(); };
    const inspect = (value: CollaborationStatus) => { if (value.state === 'ready') finish(); else if (['closed', 'revoked', 'disconnected'].includes(value.state)) finish(new Error('NOT_CONNECTED')); };
    unsubscribe = session.subscribeStatus(inspect); if (finished) unsubscribe(); else inspect(session.getStatus());
  });
}
async function confirm() {
  const value = review.value;
  if (!value || !checked.value || busy.value) return;
  const epoch = generation; let prospective: GuestSession | undefined;
  busy.value = true; error.value = '';
  try {
    if (mode.value === 'invite' && owner) {
      await owner.confirmPeer(value.invitationId, value.comparisonCode);
      if (generation === epoch) { clearPairing(); note.value = 'Identität bestätigt. Der direkte Abgleich läuft.'; }
    } else if (pairing) {
      const joined = await pairing.confirmOwner(value.comparisonCode);
      pairing = undefined;
      if (disposed || generation !== epoch) { await joined.leave(); return; }
      const reconnecting = guest === joined;
      if (!reconnecting) prospective = joined;
      guest = joined; listen(joined); await waitUntilReady(joined);
      if (disposed || generation !== epoch) { await joined.leave(); return; }
      // Store owns the unsaved-document decision and installs only the confirmed guest mirror.
      const accepted = reconnecting || await props.joinGuest(joined);
      if (!accepted) { await joined.leave(); if (guest === joined) { guest = undefined; offStatus(); status.value = null; } }
      else { prospective = undefined; clearPairing(); note.value = 'Direkt verbunden. Änderungen werden im geöffneten Diagramm abgeglichen.'; }
    }
  } catch (value) {
    if (prospective) {
      await prospective.leave().catch(() => {});
      if (guest === prospective) { guest = undefined; offStatus(); offStatus = () => {}; status.value = null; clearPairing(); }
    }
    if (generation === epoch) report(value);
  }
  finally { if (generation === epoch) busy.value = false; }
}
async function endOwner() {
  const current = owner; if (!current) return;
  const epoch = ++generation; busy.value = true; clearPairing(); owner = undefined; offStatus();
  try { await current.close(); if (!disposed && generation === epoch) { status.value = current.getStatus(); note.value = 'Zusammenarbeit beendet. Dein lokales Dokument bleibt geöffnet.'; } }
  catch (value) { if (generation === epoch) report(value); }
  finally { if (generation === epoch) busy.value = false; }
}
async function leave() {
  if (!guest || busy.value) return;
  const current = guest, epoch = generation; busy.value = true;
  try {
    if (await props.leaveGuest()) {
      await current.leave();
      // Successful leave may itself replace the authority through the store.
      if (!disposed && (!guest || guest === current)) { guest = undefined; clearPairing(); offStatus(); status.value = null; note.value = 'Die bestätigte lokale Kopie bleibt geöffnet. Die Verbindung ist beendet.'; }
    }
  } catch (value) { if (generation === epoch) report(value); }
  finally { if (generation === epoch) busy.value = false; }
}
async function copy(value: string) {
  try { await navigator.clipboard.writeText(value); note.value = 'Verbindungstext kopiert.'; }
  catch { note.value = 'Bitte den Verbindungstext markieren und mit dem üblichen Tastenkürzel kopieren.'; }
}
onBeforeUnmount(() => { disposed = true; generation++; clearPairing(); offStatus(); void owner?.close().catch(() => {}); void guest?.leave().catch(() => {}); });
</script>

<template>
  <aside v-if="open" class="peer-panel sd-panel" aria-label="Zusammenarbeiten" data-testid="collaboration-panel">
    <header><h2>Zusammenarbeiten</h2><button class="sd-icon-btn" aria-label="Zusammenarbeit schließen" @click="emit('close')">×</button></header>
    <div class="body">
      <p>Verschlüsselt direkt zwischen euren Geräten. Einladungen und Antworten tauscht ihr selbst aus; es gibt keinen zentralen Speicher oder Vermittlungsserver.</p>
      <p class="network-note">Direkte Verbindungen funktionieren nicht in jedem Netzwerk. Beide Geräte müssen erreichbar und die App geöffnet bleiben.</p>
      <p v-if="status" role="status" class="connection-state">{{ states[status.state] }} · {{ status.mode === 'owner' ? 'Dein Dokument' : status.role === 'viewer' ? 'Nur ansehen' : 'Gemeinsam bearbeiten' }}</p>
      <p v-if="status?.hasUnresolvedOutcome" role="alert">Eine gesendete Änderung ist noch nicht bestätigt. Bitte wieder verbinden und abgleichen, bevor du sie erneut ausführst.</p>
      <div v-if="!owner && !guest" class="tabs" role="group" aria-label="Verbindungsart"><button class="sd-btn" :aria-pressed="mode === 'invite'" :disabled="busy || !!review" @click="mode = 'invite'; incoming = ''">Einladen</button><button class="sd-btn" :aria-pressed="mode === 'join'" :disabled="busy || !!review" @click="mode = 'join'; incoming = ''">Beitreten</button></div>
      <template v-if="mode === 'invite' && !guest">
        <label class="sd-field-label">Zugriff<select v-model="role" class="sd-select" :disabled="busy || !!inviteText"><option value="viewer">Nur ansehen</option><option value="editor">Gemeinsam bearbeiten</option></select></label>
        <button class="sd-btn full" :disabled="busy || !authority || !!inviteText" @click="createInvitation()">Einladung erstellen</button>
        <template v-if="inviteText"><label class="sd-field-label">Einladung<textarea class="sd-textarea" aria-label="Einladung zum Kopieren" :value="inviteText" readonly spellcheck="false" /></label><button class="sd-btn full" @click="copy(inviteText)">Einladung kopieren</button><label class="sd-field-label">Antwort der anderen Person<textarea v-model="incoming" class="sd-textarea" aria-label="Antwort einfügen" maxlength="358400" spellcheck="false" :disabled="busy || !!review" /></label><button class="sd-btn full" :disabled="busy || !incoming.trim() || !!review" @click="inspectAnswer">Antwort prüfen</button></template>
      </template>
      <template v-if="mode === 'join' && !owner">
        <label class="sd-field-label">{{ guest ? 'Neue Einladung zur Wiederverbindung' : 'Einladung der anderen Person' }}<textarea v-model="incoming" class="sd-textarea" aria-label="Einladung einfügen" maxlength="358400" spellcheck="false" :disabled="busy || !!review" /></label><button class="sd-btn full" :disabled="busy || !incoming.trim() || !!review" @click="inspectInvitation">Einladung prüfen</button>
        <template v-if="answerText"><label class="sd-field-label">Deine Antwort<textarea class="sd-textarea" aria-label="Antwort zum Kopieren" :value="answerText" readonly spellcheck="false" /></label><button class="sd-btn full" @click="copy(answerText)">Antwort kopieren</button></template>
      </template>
      <section v-if="review" class="comparison"><h3>Vergleicht diesen Code</h3><output aria-label="Vergleichscode">{{ review.comparisonCode }}</output><details><summary>Vollständige Identitäten anzeigen</summary><dl class="fingerprints"><dt>Dokumentbesitzer · Identität</dt><dd>{{ review.ownerKeyFingerprint }}</dd><dt>Gast · Identität</dt><dd>{{ review.peerKeyFingerprint }}</dd><dt>Dokumentbesitzer · Verbindung</dt><dd>{{ review.ownerDtlsFingerprint }}</dd><dt>Gast · Verbindung</dt><dd>{{ review.peerDtlsFingerprint }}</dd></dl></details><p>Der vollständige Code muss bei euch beiden gleich sein. Zugriff: {{ review.role === 'viewer' ? 'Nur ansehen' : 'Gemeinsam bearbeiten' }}.</p><label class="confirm-check"><input v-model="checked" type="checkbox" :disabled="busy" />Ich habe den vollständigen Code mit der anderen Person verglichen.</label><button class="sd-btn sd-btn--primary full" :disabled="busy || !checked" @click="confirm">Identität bestätigen</button></section>
      <ul v-if="owner && status?.peers.length" aria-label="Verbundene Personen" class="peers"><li v-for="(peer, i) in status.peers" :key="peer.peerId"><strong>Person {{ i + 1 }} · {{ peer.role === 'viewer' ? 'Nur ansehen' : 'Bearbeiten' }}</strong><span>{{ states[peer.state] }}</span><button v-if="peer.state === 'disconnected' || peer.state === 'resync-required'" class="sd-btn" :disabled="busy || !!inviteText" @click="createInvitation(peer.peerId)">Wiederverbinden</button></li></ul>
      <p v-if="owner" class="network-note">Eine Freigabe beendest du derzeit für die ganze Sitzung. Danach kannst du mit neuen Einladungen starten.</p>
      <button v-if="owner" class="sd-btn full" :disabled="busy" @click="endOwner">Sitzung für alle beenden</button>
      <button v-if="guest" class="sd-btn full" :disabled="busy" @click="leave">Sitzung verlassen und Kopie behalten</button>
      <button v-if="review && !owner && !guest && !busy" class="sd-btn full" @click="clearPairing">Verbindungsaufbau abbrechen</button>
      <p v-if="busy" role="status">Verbindung wird geprüft …</p><p v-if="error" role="alert" class="error">{{ error }}</p><p v-if="note" role="status">{{ note }}</p>
    </div>
  </aside>
</template>

<style scoped>
.peer-panel{position:absolute;right:12px;top:96px;bottom:72px;width:360px;z-index:8;display:flex;flex-direction:column;overflow:hidden}header{padding:8px 12px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border-subtle)}h2{font-size:13px}.body{padding:16px;overflow:auto}p{font-size:12px;line-height:1.7;margin:0 0 12px;color:var(--text-muted)}.network-note{font-size:11px}.tabs{display:flex;gap:6px;margin-bottom:14px}.full{width:100%;margin-bottom:12px}.sd-field-label{display:block;margin:12px 0 8px}.sd-textarea{height:80px;font:10px/1.5 var(--font-mono);resize:vertical}.comparison{padding:12px;border:1px solid var(--border-default);border-radius:6px;margin:16px 0}.fingerprints{font:10px/1.5 var(--font-mono);overflow-wrap:anywhere}.fingerprints dd{margin:4px 0 10px}.comparison summary{font-size:11px;cursor:pointer;margin-bottom:12px}.comparison h3{font-size:12px}.comparison output{display:block;font:14px/1.7 var(--font-mono);overflow-wrap:anywhere;margin:10px 0}.confirm-check{display:flex;gap:8px;font-size:12px;line-height:1.6;margin:12px 0}.connection-state{color:var(--text-primary);font-weight:600}.peers li{display:flex;gap:7px;flex-direction:column;padding:12px 0;border-top:1px solid var(--border-subtle);font-size:11px}.error{color:var(--status-error)}@media(max-width:860px){.peer-panel{top:188px;width:min(360px,calc(100vw - 24px))}}
</style>
