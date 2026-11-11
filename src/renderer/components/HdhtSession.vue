<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useIntervalFn } from '@vueuse/core';
import { t } from '@/renderer/i18n';
import { WHITEBOARD_KEY } from '@/renderer/state/contract';
import { RoomConnection } from '@/renderer/state/room-connection';
import { getDesktopBridge } from '@/platform';
import { DirectLink } from '@/collaboration/hdht/direct-link';
import { buildHdhtLink, createSessionId, HDHT_MAX_TTL_MS, isHdhtLink, normalizePin, optionalRelayUrl, parseHdhtInvitation } from '@/collaboration/hdht/invitation';
import { createHostKeys } from '@/collaboration/hdht/relay-channel';
import { createHdhtGuestTransport, createHdhtHostTransport, type HdhtHostTransport } from '@/collaboration/hdht/session';
import type { CollaborationTransportStatus } from '@/collaboration/transport';
import type { HelperStatus } from '@/collaboration/hdht/types';
import { assertCollaborationDocumentSize, bindCrdtTransport, type CrdtTransportBinding } from '@/collaboration/crdt';
import { normalizeWebAppUrl, ownWebAppUrl } from '@/collaboration/session-link';

const props = defineProps<{ disabled?: boolean; inviteLink?: string | null }>();
const emit = defineEmits<{ active: [value: boolean]; 'link-consumed': [] }>();
const store = inject(WHITEBOARD_KEY)!;
const bridge = getDesktopBridge();
const role = ref<'editor' | 'viewer'>('viewer');
const linkText = ref(''), pinText = ref(''), hostPin = ref(''), shareLink = ref('');
const relayUrl = ref(''), webAppUrl = ref(ownWebAppUrl());
const busy = ref(false), active = ref(false), joined = ref(false), hosting = ref(false);
const stopping = ref(false);
const nativePending = ref(false), relayShareAllowed = ref(false);
const error = ref(''), note = ref('');
const status = shallowRef<CollaborationTransportStatus | null>(null);
const helper = shallowRef<HelperStatus | null>(null), helperBusy = ref(false), helperError = ref('');
let host: HdhtHostTransport | undefined, room: RoomConnection | undefined, native: DirectLink | undefined;
let binding: CrdtTransportBinding | undefined, offStatus = () => {};
let generation = 0, disposed = false, helperGeneration = 0;
let stopPromise: Promise<void> | undefined;
let ownerAuthority = store.getAuthority();
const isNative = !!bridge.direct;
const stateText = computed(() => {
  const value = status.value;
  if (!value) return busy.value ? t('Verbindung wird vorbereitet …') : '';
  if (value.state === 'error') return t('Verbindung beendet');
  if (value.state === 'reconnecting') return t('Verbindung unterbrochen · Erneuter Versuch {number}', { number: value.attempt ?? 1 });
  if (value.state === 'closed') return t('Sitzung beendet');
  if (hosting.value) return value.state !== 'ready' ? t('Verbindung wird vorbereitet …') : value.peers.length ? t('Verbunden · {count} {unit}', { count: value.peers.length, unit: value.peers.length === 1 ? t('Person') : t('Personen') }) : t('Wartet auf Teilnehmende');
  if (joined.value && value.state === 'ready') return t('Verbunden');
  return value.state === 'ready' ? t('Diagramm wird abgeglichen …') : value.phase === 'authenticating' ? t('PIN wird geprüft …') : t('Gegenstelle wird gesucht …');
});
const routeText = computed(() => status.value?.route === 'direct' ? t('Direktverbindung') : status.value?.route === 'relay' ? t('Verschlüsselte Relay-Verbindung') : t('Verbindungsweg wird gesucht'));
function fail(value: unknown): void {
  const code = value instanceof Error ? value.message : String(value);
  error.value = /DOCUMENT_TOO_LARGE_FOR_COLLABORATION/.test(code) ? t('Dieses Diagramm ist für die Zusammenarbeit zu groß. Verkleinere es, bevor du eine Session startest.')
    : /SYNC_FAILED/.test(code) ? t('Der Abgleich ist fehlgeschlagen. Die Verbindung wurde beendet. Deine lokale Zeichnung bleibt erhalten.')
    : /PIN_INVALID/.test(code) ? t('Die PIN stimmt nicht. Bitte erneut eingeben.')
    : /PIN_LOCKED|PIN_RETIRED/.test(code) ? t('Zu viele PIN-Versuche. Bitte warten oder vom Gastgeber eine neue PIN anfordern.')
    : /INVITATION_EXPIRED/.test(code) ? t('Dieser Link ist abgelaufen. Bitte einen neuen Link anfordern.')
    : /INVITATION_INVALID/.test(code) ? t('Das ist kein gültiger Session-Link. Bitte den vollständigen Link einfügen.')
    : /HOST_KEY_MISMATCH|DOCUMENT_MISMATCH/.test(code) ? t('Die Identität oder das Dokument stimmt nicht mit dem Link überein.')
    : /RELAY_URL/.test(code) ? t('Verwende eine gültige wss://-Adresse ohne Zugangsdaten, Parameter oder Fragment.')
    : /BROWSER_RELAY_REQUIRED/.test(code) ? t('Für den Browser muss der Gastgeber ein erreichbares WSS-Gateway anbieten. Öffne diesen Link sonst in der Desktop-App.')
    : /SESSION_ENDED|KICKED/.test(code) ? t('Der Gastgeber hat deine Verbindung beendet.')
    : /ROOM_FULL/.test(code) ? t('Diese Session ist voll. Bitte später erneut versuchen.')
    : /ABORTED/.test(code) ? ''
    : t('Keine Verbindung erreichbar. Prüfe, ob der Gastgeber online ist. Wenn UDP gesperrt ist, wird ein erreichbares WSS-Gateway benötigt.');
}
function setActive(value: boolean) { active.value = value; emit('active', value); }
function updateLink(): void {
  if (!host) return;
  shareLink.value = buildHdhtLink({ version: 1, sessionId: sessionId, hostKey: host.hostKey, directKey: host.directKey, relayUrl: host.relayUrl, documentId: ownerAuthority!.session.documentId, expiresAt: host.expiresAt }, webAppUrl.value);
}
let sessionId = '';

async function start(): Promise<void> {
  if (busy.value || active.value || props.disabled || store.getRoomGuest()) return;
  const authority = store.getAuthority(), controller = store.getCrdtController();
  if (!authority || !controller) return;
  const epoch = ++generation; busy.value = true; error.value = ''; note.value = '';
  ownerAuthority = authority;
  try {
    assertCollaborationDocumentSize(controller);
    const relay = optionalRelayUrl(relayUrl.value);
    if (!isNative && !relay) throw new Error('BROWSER_RELAY_REQUIRED');
    webAppUrl.value = normalizeWebAppUrl(webAppUrl.value);
    const keys = await createHostKeys();
    if (disposed || generation !== epoch || store.getAuthority() !== authority || store.getCrdtController() !== controller) return;
    sessionId = createSessionId();
    nativePending.value = isNative; relayShareAllowed.value = false;
    native = bridge.direct ? new DirectLink(bridge.direct) : undefined;
    const current = createHdhtHostTransport({
      sessionId, documentId: authority.session.documentId, hostKeys: keys, expiresAt: Date.now() + HDHT_MAX_TTL_MS,
      grantedRole: () => role.value,
      ...(native ? { peers: { link: native } } : {}), ...(relay ? { relay: { url: relay } } : {}),
    });
    host = current; hosting.value = true; joined.value = false; setActive(true);
    const inspect = () => { if (generation === epoch && host === current) status.value = current.getStatus(); };
    offStatus = current.subscribeStatus(inspect); inspect();
    binding = bindCrdtTransport(controller, current, undefined, {
      applyRemote: apply => { if (store.getAuthority() === authority) authority.applyExternalUpdate(apply); },
      onError: value => {
        if (generation !== epoch || host !== current) return;
        const reason = value.message === 'DOCUMENT_TOO_LARGE_FOR_COLLABORATION' ? value.message : 'SYNC_FAILED';
        fail(new Error(reason)); void stop(false, reason);
      },
    });
    hostPin.value = current.getPin(); updateLink();
    // WSS registration and helper discovery already run; blocked native startup cannot hold them up.
    if (bridge.direct && native) {
      const link = native;
      void bridge.direct.hostStart().then(result => {
        if (disposed || generation !== epoch || host !== current) return;
        current.attachDirect(link, result.publicKey); nativePending.value = false; updateLink(); inspect();
      }).catch(() => {
        if (generation === epoch) { nativePending.value = false; note.value = t('Direktverbindung nicht verfügbar. Erreichbare Helfer oder das WSS-Gateway werden weiter genutzt.'); }
      });
    }
  } catch (value) { if (generation === epoch) { fail(value); await stop(false); } }
  finally { if (generation === epoch) busy.value = false; }
}

async function join(): Promise<void> {
  if (busy.value || active.value || props.disabled) return;
  const epoch = ++generation; error.value = ''; note.value = '';
  try {
    const invitation = parseHdhtInvitation(linkText.value);
    const pin = normalizePin(pinText.value);
    if (!pin) { error.value = t('Bitte die sechsstellige PIN eingeben.'); return; }
    if (!isNative && !invitation.relayUrl) throw new Error('BROWSER_RELAY_REQUIRED');
    busy.value = true;
    native = bridge.direct ? new DirectLink(bridge.direct) : undefined;
    const transport = createHdhtGuestTransport({ invitation, pin, ...(native ? { direct: native } : {}) });
    const current = new RoomConnection(store, transport, { documentId: invitation.documentId, onChange(value, adopted) {
      if (generation !== epoch) return;
      status.value = value; joined.value = adopted;
      if (value.state === 'error') fail(new Error(value.error ?? 'CONNECTION_LOST'));
    } });
    room = current; hosting.value = false; setActive(true); pinText.value = '';
    const accepted = await current.join();
    if (generation !== epoch || disposed) return;
    if (!accepted) { await stop(false); note.value = t('Beitritt abgebrochen. Dein Dokument bleibt unverändert.'); }
  } catch (value) {
    if (generation === epoch) { fail(value); await stop(false); }
  } finally { if (generation === epoch) busy.value = false; }
}

function stop(keepLocalCopy: boolean, reason?: string): Promise<void> {
  if (stopPromise) return stopPromise;
  const epoch = ++generation;
  const currentHost = host, currentRoom = room, currentBinding = binding, currentNative = native;
  host = undefined; room = undefined; binding = undefined; native = undefined;
  offStatus(); offStatus = () => {};
  busy.value = true; stopping.value = true;
  stopPromise = (async () => {
    try {
      // Host close gives SESSION_ENDED a bounded flush window before native sockets are destroyed.
      await Promise.allSettled([currentHost?.close(reason), currentRoom?.close(keepLocalCopy, reason)]);
      await bridge.direct?.hostStop().catch(() => undefined);
      currentNative?.dispose();
      await currentBinding?.close().catch(() => undefined);
      if (disposed || generation !== epoch) return;
      hosting.value = false; joined.value = false; setActive(false); busy.value = false; status.value = null; shareLink.value = ''; hostPin.value = '';
      nativePending.value = false; relayShareAllowed.value = false;
    } finally { stopping.value = false; stopPromise = undefined; }
  })();
  return stopPromise;
}
function renewPin() { if (host) hostPin.value = host.renewPin(); }
async function copy(value: string) {
  try { await navigator.clipboard.writeText(value); note.value = t('Verbindungstext kopiert.'); }
  catch { note.value = t('Bitte den Verbindungstext markieren und mit dem üblichen Tastenkürzel kopieren.'); }
}

const helperPolling = useIntervalFn(async () => {
  const epoch = helperGeneration;
  try { const value = await bridge.helper?.status(); if (!disposed && epoch === helperGeneration && value) helper.value = value; } catch { /* next poll retries */ }
}, 3000, { immediate: false });
async function toggleHelper(event: Event) {
  const enabled = (event.target as HTMLInputElement).checked;
  if (!bridge.helper || helperBusy.value) return;
  const epoch = ++helperGeneration; helperBusy.value = true; helperError.value = '';
  try {
    if (enabled) helper.value = await bridge.helper.start();
    else { helperPolling.pause(); await bridge.helper.stop(); helper.value = await bridge.helper.status(); }
    if (!disposed && epoch === helperGeneration && helper.value?.running) helperPolling.resume();
  } catch { helperError.value = t('Der Relay-Helfer konnte nicht gestartet werden. Bitte erneut versuchen.'); }
  finally { if (epoch === helperGeneration) helperBusy.value = false; }
}
onMounted(async () => {
  try { const value = await bridge.helper?.status(); if (!disposed && value) { helper.value = value; if (value.running) helperPolling.resume(); } } catch { /* native capability is optional */ }
});
const offAuthority = store.subscribeAuthority(next => {
  if (room?.isAdopting) return;
  if ((active.value || busy.value) && next !== ownerAuthority && (!room?.isAdopted || !store.getRoomGuest())) void stop(false);
});
watch(() => props.inviteLink, link => {
  if (!link || !isHdhtLink(link) || active.value) return;
  linkText.value = link; pinText.value = ''; emit('link-consumed');
}, { immediate: true });
onBeforeUnmount(() => { disposed = true; helperGeneration++; offAuthority(); helperPolling.pause(); void stop(false); void bridge.helper?.stop().catch(() => undefined); });
</script>

<template>
  <section class="hdht-session" data-testid="hdht-session" :aria-label="t('Session mit Link und PIN')">
    <template v-if="!active">
      <h3>{{ t('Gemeinsam zeichnen') }}</h3>
      <p>{{ t('Teile einen Link und eine PIN. Die Desktop-App findet Gegenstellen und freiwillige Relay-Helfer dezentral. Dein Diagramm bleibt Ende-zu-Ende verschlüsselt.') }}</p>
      <label class="sd-field-label">{{ t('Zugriff für Eingeladene') }}<select v-model="role" class="sd-select" :disabled="busy || disabled"><option value="viewer">{{ t('Nur ansehen') }}</option><option value="editor">{{ t('Gemeinsam bearbeiten') }}</option></select></label>
      <button class="sd-btn sd-btn--primary full" data-testid="hdht-start" :disabled="busy || disabled || !!store.getRoomGuest()" @click="start">{{ t('Session starten') }}</button>
      <div class="separator">{{ t('oder beitreten') }}</div>
      <label class="sd-field-label">{{ t('Session-Link') }}<input v-model="linkText" class="sd-input" :aria-label="t('Link für PIN-Beitritt')" autocomplete="off" spellcheck="false" maxlength="8192" :disabled="busy || disabled" /></label>
      <label class="sd-field-label">{{ t('PIN') }}<input v-model="pinText" class="sd-input pin" :aria-label="t('Sechsstellige PIN')" inputmode="numeric" autocomplete="off" maxlength="8" :disabled="busy || disabled" @keydown.enter.prevent="join" /></label>
      <button class="sd-btn full" data-testid="hdht-join" :disabled="busy || disabled || !linkText.trim()" @click="join">{{ t('Mit PIN beitreten') }}</button>
    </template>
    <template v-else>
      <h3>{{ hosting ? t('Session läuft') : joined ? t('Du bist in der Session') : t('Session beitreten') }}</h3>
      <p role="status" data-testid="hdht-status">{{ stateText }}</p>
      <template v-if="hosting && status?.state === 'ready'">
        <template v-if="nativePending && !relayShareAllowed">
          <p>{{ t('Direktverbindung wird noch vorbereitet …') }}</p>
          <p>{{ t('Du kannst bereits über Relay einladen. Dieser Link enthält den Direktweg noch nicht.') }}</p>
          <button class="sd-btn full" data-testid="hdht-share-relay" @click="relayShareAllowed = true">{{ t('Link jetzt über Relay teilen') }}</button>
        </template>
        <template v-else>
        <label class="sd-field-label">{{ t('Link zum Teilen') }}<input class="sd-input" readonly :value="shareLink" data-testid="hdht-link" :aria-label="t('Session-Link zum Kopieren')" @focus="($event.target as HTMLInputElement).select()" /></label>
        <button class="sd-btn full" @click="copy(shareLink)">{{ t('Link kopieren') }}</button>
        <label class="sd-field-label">{{ t('PIN getrennt teilen') }}<input class="sd-input pin" readonly :value="hostPin" data-testid="hdht-host-pin" :aria-label="t('PIN zum Teilen')" @focus="($event.target as HTMLInputElement).select()" /></label>
        <button class="sd-btn full" @click="renewPin">{{ t('Neue PIN') }}</button>
        <label class="sd-field-label">{{ t('Zugriff für neue Beitritte') }}<select v-model="role" class="sd-select"><option value="viewer">{{ t('Nur ansehen') }}</option><option value="editor">{{ t('Gemeinsam bearbeiten') }}</option></select></label>
        </template>
      </template>
      <template v-else-if="joined"><p>{{ store.state.roomGuest?.role === 'editor' ? t('Gemeinsam bearbeiten') : t('Nur ansehen') }} · {{ routeText }}</p></template>
      <button class="sd-btn full" data-testid="hdht-stop" :disabled="stopping" @click="stop(joined)">{{ hosting ? t('Session beenden') : joined ? t('Sitzung verlassen und Kopie behalten') : t('Verbindungsaufbau abbrechen') }}</button>
    </template>
    <details class="network" data-testid="hdht-network">
      <summary>{{ t('Netzwerk und Relay-Hilfe') }}</summary>
      <p>{{ t('Freiwillige Desktop-Geräte können verschlüsselte Daten weiterleiten. Es wird kein fester Relay-Server benötigt. Wenn UDP vollständig gesperrt ist, hilft nur ein zusätzlich erreichbares WSS-Gateway.') }}</p>
      <label class="sd-field-label">{{ t('Optionales WSS-Gateway') }}<input v-model="relayUrl" class="sd-input" :aria-label="t('Optionales WSS-Gateway')" placeholder="wss://" spellcheck="false" :disabled="active || busy" /></label>
      <label class="sd-field-label">{{ t('Adresse der Web-App für Einladungslinks') }}<input v-model="webAppUrl" class="sd-input" :aria-label="t('Adresse der Web-App für PIN-Links')" type="url" :disabled="active || busy" /></label>
      <template v-if="bridge.helper">
        <label class="helper-switch"><input type="checkbox" :checked="helper?.running === true" :disabled="helperBusy" data-testid="hdht-helper" @change="toggleHelper" />{{ t('Dieses Gerät als Relay-Helfer anbieten') }}</label>
        <p>{{ t('Standardmäßig aus. Nutzt während der Laufzeit begrenzte Bandbreite für andere Sessions; deren Inhalte und PINs bleiben verschlüsselt.') }}</p>
        <p v-if="helper?.running" role="status">{{ t('Relay-Helfer aktiv · {sessions} Sessions · {connections} Verbindungen', { sessions: helper.sessions, connections: helper.connections }) }}</p>
        <p v-if="helperError" role="alert" class="error">{{ helperError }}</p>
      </template>
      <p v-else>{{ t('Dezentrale Suche und Relay-Hilfe sind in der Desktop-App verfügbar. Im Browser wird ein WSS-Gateway aus dem Link verwendet.') }}</p>
      <p v-if="hosting">{{ t('Erreichbare Relay-Helfer: {count}', { count: status?.helpers ?? 0 }) }}</p>
      <p v-if="status?.route">{{ routeText }}</p>
    </details>
    <p v-if="error" role="alert" class="error">{{ error }}</p><p v-if="note" role="status">{{ note }}</p>
  </section>
</template>

<style scoped>
.hdht-session h3{margin:0 0 8px;font-size:15px}.hdht-session p{font-size:12px;line-height:1.6;color:var(--text-muted);margin:8px 0 12px}.sd-field-label{display:block;margin:12px 0 8px}.sd-input,.sd-select{width:100%;margin-top:5px}.full{width:100%;margin:8px 0}.pin{font:18px var(--font-mono);letter-spacing:.2em}.separator{margin:12px 0;text-align:center;font-size:12px;color:var(--text-muted)}.network{margin:12px 0;padding-top:12px;border-top:1px solid var(--border-subtle)}summary{font-size:12px;cursor:pointer;font-weight:600}.helper-switch{display:flex;align-items:center;gap:8px;font-size:12px;margin:16px 0 8px}.error{color:var(--status-error)!important}summary:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
</style>
