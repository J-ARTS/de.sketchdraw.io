<!-- @component Start, join and leave a session: the route (directly between the devices, or through a Cloudflare relay), link and PIN, the people in it (the host can remove a guest), the own name and the connection state. It also feeds the pointers of the others to the canvas and tells a guest when the host removed it or ended the session. -->
<script setup lang="ts">
import AppButton from '@/renderer/design-system/atoms/AppButton.vue';
import { computed, inject, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { t } from '@/renderer/i18n';
import { WHITEBOARD_KEY } from '@/renderer/state/contract';
import { RoomConnection } from '@/renderer/state/room-connection';
import { getDesktopBridge } from '@/platform';
import { DirectLink } from '@/collaboration/hdht/direct-link';
import { buildHdhtLink, createSessionId, HDHT_MAX_TTL_MS, isHdhtLink, normalizePin, optionalRelayUrl, parseHdhtInvitation } from '@/collaboration/hdht/invitation';
import { createHostKeys } from '@/collaboration/hdht/relay-channel';
import { cloudRelayBase, cloudRelayRoomUrl, relayHostName, storeCloudRelayAddress, storedCloudRelayAddress, storedSessionRoute, storeSessionRoute, type SessionRoute } from '@/collaboration/hdht/cloud-relay';
import { createHdhtGuestTransport, createHdhtHostTransport, type HdhtHostTransport } from '@/collaboration/hdht/session';
import type { CollaborationTransportStatus } from '@/collaboration/transport';
import { assertCollaborationDocumentSize, bindCrdtTransport, type CrdtTransportBinding } from '@/collaboration/crdt';
import { cleanParticipantName, createGuestPresence, createHostPresence, type GuestPresence, type HostPresence, type PresenceSnapshot } from '@/collaboration/presence';
import { participantLabel } from '@/renderer/lib/participant-label';
import AppSelect from '@/renderer/design-system/molecules/AppSelect.vue';
import ParticipantList from '@/renderer/design-system/molecules/ParticipantList.vue';
import AppFieldLabel from '@/renderer/design-system/atoms/AppFieldLabel.vue';
import AppTextField from '@/renderer/design-system/atoms/AppTextField.vue';
import AppIconButton from '@/renderer/design-system/atoms/AppIconButton.vue';
import { copyText } from '@/renderer/lib/copy-text';

const props = withDefaults(defineProps<{
  /** A session link the app was opened with; it is prefilled for the PIN join. */
  inviteLink?: string | null;
  /**
   * Whether the user can see this component. While it is hidden, what happens in the session (someone joined, the host
   * removed this device or ended the session) is also shown as a notice over the canvas.
   */
  visible?: boolean;
}>(), { inviteLink: null, visible: true });
const emit = defineEmits<{ 'link-consumed': [] }>();
const store = inject(WHITEBOARD_KEY)!;
const bridge = getDesktopBridge();
const role = ref<'editor' | 'viewer'>('viewer');
const roleOptions = computed(() => [{ value: 'viewer', label: t('Nur ansehen') }, { value: 'editor', label: t('Gemeinsam bearbeiten') }]);
/**
 * How the devices of a session reach each other (#300): directly (HyperDHT and volunteer helpers, no server), or all
 * through one relay at Cloudflare. The host chooses; the link carries the choice, so a guest follows it.
 */
const route = ref<SessionRoute>(storedSessionRoute());
const routeOptions = computed(() => [{ value: 'p2p', label: t('Direkt (P2P)') }, { value: 'cloud', label: t('Cloudflare-Relay') }]);
const relayAddress = ref(storedCloudRelayAddress());
const addressError = ref('');
/** The running session goes through a relay only: no direct route, no helper of this device. */
const viaRelay = ref(false), relayHost = ref('');
function chooseRoute(value: string): void {
  route.value = value === 'cloud' ? 'cloud' : 'p2p';
  storeSessionRoute(route.value);
  addressError.value = ''; error.value = '';
}
function commitRelayAddress(): void {
  relayAddress.value = relayAddress.value.trim();
  storeCloudRelayAddress(relayAddress.value);
}
/** The checked relay address, or null after saying next to the field what is wrong with it. */
function checkedRelayAddress(): string | null {
  commitRelayAddress();
  try { addressError.value = ''; return cloudRelayBase(relayAddress.value); } catch (value) {
    const code = value instanceof Error ? value.message : '';
    addressError.value = code === 'RELAY_URL_MISSING' ? t('Trage die Adresse des Relays ein.')
      : code === 'RELAY_URL_INSECURE' ? t('Der Relay muss verschlüsselt erreichbar sein (wss:// oder https://).')
      : t('Das ist keine gültige Relay-Adresse. Erwartet wird zum Beispiel sketchdraw-relay.name.workers.dev.');
    return null;
  }
}
const linkText = ref(''), pinText = ref(''), hostPin = ref(''), shareLink = ref('');
const busy = ref(false), active = ref(false), joined = ref(false), hosting = ref(false);
const stopping = ref(false);
const nativePending = ref(false), relayShareAllowed = ref(false);
const error = ref(''), note = ref('');
const status = shallowRef<CollaborationTransportStatus | null>(null);
const helperError = ref('');
let host: HdhtHostTransport | undefined, room: RoomConnection | undefined, native: DirectLink | undefined;
let binding: CrdtTransportBinding | undefined, offStatus = () => {};
let hostPresence: HostPresence | undefined, guestPresence: GuestPresence | undefined, offPointer = () => {};
/** People already seen in this session; null until the first list arrived, so nobody who was there before is announced. */
let seen: Set<string> | null = null;
/** The name others see. It is kept on this device and only leaves it inside a session: to the host, who shows it to the people in that session. */
const NAME_KEY = 'sketchdraw.display-name.v1';
function storedName(): string { try { return cleanParticipantName(localStorage.getItem(NAME_KEY) ?? ''); } catch { return ''; } }
const displayName = ref(storedName());
/**
 * Without a name of their own, people start with the name of their computer account (#250). It is a suggestion in
 * a field they see before a session starts; it is stored only once they change it, and a name they entered wins.
 */
let nameEdited = false;
function markNameEdited(): void { nameEdited = true; }
if (!displayName.value) void bridge.userName?.().then(name => { if (!nameEdited && !displayName.value) displayName.value = cleanParticipantName(name); }).catch(() => undefined);
const participants = computed(() => store.state.presence.participants);
const personLabel = participantLabel;
function commitName(): void {
  const clean = cleanParticipantName(displayName.value);
  displayName.value = clean;
  try { if (clean) localStorage.setItem(NAME_KEY, clean); else localStorage.removeItem(NAME_KEY); } catch { /* the name still applies to this session */ }
  hostPresence?.setName(clean); guestPresence?.setName(clean);
}
function showPresence(value: PresenceSnapshot): void {
  store.setPresence(value);
  if (!value.participants.length) return;
  const present = value.participants.filter(person => !person.self);
  // Only someone new is announced, and only while the list itself is out of sight; a participant that comes back
  // after an interruption keeps its entry.
  if (seen && !props.visible) for (const person of present) if (!seen.has(person.id) && person.state === 'online') store.announce(t('{name} ist der Session beigetreten.', { name: personLabel(person) }));
  seen = new Set(present.map(person => person.id));
}
/** The others see where this device points and which part of the drawing it shows (to follow it). */
function sharePointer(): void {
  offPointer();
  const offCursor = store.subscribePointer(point => { hostPresence?.setCursor(point); guestPresence?.setCursor(point); });
  const offView = store.subscribeView(view => { hostPresence?.setView(view); guestPresence?.setView(view); });
  offPointer = () => { offCursor(); offView(); };
}
function removeParticipant(id: string): void {
  const person = participants.value.find(value => value.id === id);
  if (!person || !hostPresence?.remove(id)) return;
  note.value = t('{name} wurde entfernt. Wer Link und PIN kennt, kann erneut beitreten – eine neue PIN verhindert das.', { name: personLabel(person) });
}
let generation = 0, disposed = false;
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
const routeText = computed(() => status.value?.route === 'direct' ? t('Direktverbindung')
  : status.value?.route === 'relay' ? (viaRelay.value && relayHost.value ? t('Verschlüsselt über den Relay {host}', { host: relayHost.value }) : t('Verschlüsselte Relay-Verbindung'))
  : t('Verbindungsweg wird gesucht'));
/** A host whose relay does not answer keeps trying; it says so instead of only "preparing". */
const relayProblem = computed(() => hosting.value && viaRelay.value && !!status.value?.error && status.value.state !== 'closed' && status.value.state !== 'ready'
  ? t('Der Relay {host} ist nicht erreichbar. Die App versucht es weiter – prüfe die Adresse und deine Internetverbindung.', { host: relayHost.value }) : '');
/** Before joining: a link that goes through a relay names it, because that relay sees the network address of the guest. */
const linkRelayHost = computed(() => {
  if (active.value || !linkText.value.trim()) return '';
  try { const invitation = parseHdhtInvitation(linkText.value); return invitation.relayUrl && !invitation.directKey ? relayHostName(invitation.relayUrl) : ''; } catch { return ''; }
});
function fail(value: unknown): void {
  const code = value instanceof Error ? value.message : String(value);
  error.value = /DOCUMENT_TOO_LARGE_FOR_COLLABORATION/.test(code) ? t('Dieses Diagramm ist für die Zusammenarbeit zu groß. Verkleinere es, bevor du eine Session startest.')
    : /SYNC_FAILED/.test(code) ? t('Der Abgleich ist fehlgeschlagen. Die Verbindung wurde beendet. Deine lokale Zeichnung bleibt erhalten.')
    : /PIN_INVALID/.test(code) ? t('Die PIN stimmt nicht. Bitte erneut eingeben.')
    : /PIN_LOCKED|PIN_RETIRED/.test(code) ? t('Zu viele PIN-Versuche. Bitte warten oder vom Gastgeber eine neue PIN anfordern.')
    : /INVITATION_EXPIRED/.test(code) ? t('Dieser Link ist abgelaufen. Bitte einen neuen Link anfordern.')
    : /HOST_KEY_MISMATCH|DOCUMENT_MISMATCH/.test(code) ? t('Die Identität oder das Dokument stimmt nicht mit dem Link überein.')
    : /INVITATION_INVALID|RELAY_URL/.test(code) ? t('Das ist kein gültiger Session-Link. Bitte den vollständigen Link einfügen.')
    : /DESKTOP_REQUIRED/.test(code) ? t('Gemeinsame Sessions laufen in der Desktop-App. Öffne den Link dort.')
    : /KICKED/.test(code) ? t('Der Gastgeber hat dich aus der Session entfernt.')
    : /SESSION_ENDED/.test(code) ? t('Der Gastgeber hat die Session beendet.')
    : /CONNECTION_LOST/.test(code) ? t('Die Verbindung zur Session ließ sich fünf Minuten lang nicht wiederherstellen.')
    : /ROOM_FULL/.test(code) ? t('Diese Session ist voll. Bitte später erneut versuchen.')
    : /ABORTED/.test(code) ? ''
    : viaRelay.value ? t('Keine Verbindung über den Relay {host}. Prüfe, ob die Session noch läuft und ob dein Netzwerk WebSocket-Verbindungen zulässt.', { host: relayHost.value })
    : t('Keine Verbindung erreichbar. Prüfe, ob der Gastgeber online ist. Ist UDP in einem der Netzwerke vollständig gesperrt, kommt keine Verbindung zustande.');
  // With the panel closed, what ends a session from outside is said where the person is working.
  if (!props.visible && /KICKED|SESSION_ENDED|CONNECTION_LOST/.test(code) && error.value) store.announce(error.value, 'error');
}
function setActive(value: boolean) { active.value = value; }
function updateLink(): void {
  if (!host) return;
  shareLink.value = buildHdhtLink({ version: 1, sessionId: sessionId, hostKey: host.hostKey, directKey: host.directKey, relayUrl: host.relayUrl, documentId: ownerAuthority!.session.documentId, expiresAt: host.expiresAt });
}
let sessionId = '';
/**
 * Development and test override only: a self-run relay endpoint for clients without native HyperDHT (browser preview).
 * The product has no gateway setting; desktop peers connect directly or through volunteer helpers.
 */
const RELAY_OVERRIDE_KEY = 'sketchdraw.hdht-relay-url.v1';
function relayOverride(): string { try { return localStorage.getItem(RELAY_OVERRIDE_KEY) ?? ''; } catch { return ''; } }

/**
 * While a session of this device runs, the device also offers its bounded relay capacity to other sessions (#162).
 * Calls are serialized so a stop always follows the start it belongs to; a failing helper never ends the session.
 */
let helperWanted = false, helperChain: Promise<void> = Promise.resolve();
function setHelper(enabled: boolean): Promise<void> {
  const api = bridge.helper;
  if (!api || helperWanted === enabled) return helperChain;
  helperWanted = enabled;
  helperChain = helperChain.then(async () => {
    try {
      if (enabled) {
        helperError.value = '';
        await api.start();
      } else {
        await api.stop();
      }
    } catch {
      if (enabled && !disposed && helperWanted) helperError.value = t('Der Relay-Helfer konnte nicht gestartet werden. Deine Session läuft ohne ihn weiter.');
    }
  });
  return helperChain;
}

async function start(): Promise<void> {
  if (busy.value || active.value || store.getRoomGuest()) return;
  const authority = store.getAuthority(), controller = store.getCrdtController();
  if (!authority || !controller) return;
  const cloud = route.value === 'cloud';
  const relayBase = cloud ? checkedRelayAddress() : null;
  if (cloud && !relayBase) return;
  const epoch = ++generation; busy.value = true; error.value = ''; note.value = '';
  ownerAuthority = authority;
  try {
    assertCollaborationDocumentSize(controller);
    const override = cloud ? null : optionalRelayUrl(relayOverride());
    if (!cloud && !isNative && !override) throw new Error('DESKTOP_REQUIRED');
    const keys = await createHostKeys();
    // The room of this session at the relay is named after the session key, so the link alone leads guests to it.
    const relay = relayBase ? await cloudRelayRoomUrl(relayBase, keys.publicKey) : override;
    if (disposed || generation !== epoch || store.getAuthority() !== authority || store.getCrdtController() !== controller) return;
    sessionId = createSessionId();
    viaRelay.value = cloud; relayHost.value = cloud && relay ? relayHostName(relay) : '';
    nativePending.value = isNative && !cloud; relayShareAllowed.value = false;
    // Through the relay nothing else runs: no DHT node, no direct listener and no helper of this device.
    native = !cloud && bridge.direct ? new DirectLink(bridge.direct) : undefined;
    const current = createHdhtHostTransport({
      sessionId, documentId: authority.session.documentId, hostKeys: keys, expiresAt: Date.now() + HDHT_MAX_TTL_MS,
      grantedRole: () => role.value,
      ...(native ? { peers: { link: native } } : {}), ...(relay ? { relay: { url: relay } } : {}),
    });
    host = current; hosting.value = true; joined.value = false; setActive(true);
    const inspect = () => { if (generation === epoch && host === current) status.value = current.getStatus(); };
    offStatus = current.subscribeStatus(inspect); inspect();
    const presence = createHostPresence(current, { name: displayName.value, onChange: value => { if (generation === epoch && host === current) showPresence(value); } });
    hostPresence = presence; seen = new Set(); showPresence(presence.snapshot()); sharePointer();
    binding = bindCrdtTransport(controller, current, undefined, {
      applyRemote: apply => { if (store.getAuthority() === authority) authority.applyExternalUpdate(apply); },
      onPeerError: (error, peer) => {
        if (generation !== epoch || host !== current) return;
        if (!current.getStatus().peers.some(value => value.peerId === peer.peerId && value.keyHash === peer.keyHash)) return;
        if (error.message === 'SYNC_TRANSFER_BUSY') current.retryPeer(peer.peerId); else { presence.forgetPeer(peer.peerId); current.kick(peer.peerId); }
      },
      onError: value => {
        if (generation !== epoch || host !== current) return;
        const reason = value.message === 'DOCUMENT_TOO_LARGE_FOR_COLLABORATION' ? value.message : 'SYNC_FAILED';
        fail(new Error(reason)); void stop(false, reason);
      },
    });
    hostPin.value = current.getPin(); updateLink();
    if (!cloud) void setHelper(true);
    // WSS registration and helper discovery already run; blocked native startup cannot hold them up.
    if (bridge.direct && native) {
      const link = native;
      void bridge.direct.hostStart().then(result => {
        if (disposed || generation !== epoch || host !== current) return;
        current.attachDirect(link, result.publicKey); nativePending.value = false; updateLink(); inspect();
      }).catch(() => {
        if (generation === epoch) { nativePending.value = false; note.value = t('Direktverbindung nicht verfügbar. Erreichbare Relay-Helfer werden weiter genutzt.'); }
      });
    }
  } catch (value) { if (generation === epoch) { fail(value); await stop(false); } }
  finally { if (generation === epoch) busy.value = false; }
}

async function join(): Promise<void> {
  if (busy.value || active.value) return;
  const epoch = ++generation; error.value = ''; note.value = '';
  try {
    const invitation = parseHdhtInvitation(linkText.value);
    const pin = normalizePin(pinText.value);
    if (!pin) { error.value = t('Bitte die sechsstellige PIN eingeben.'); return; }
    if (!isNative && !invitation.relayUrl) throw new Error('DESKTOP_REQUIRED');
    busy.value = true;
    // A link with a relay and no direct key was started with the relay route; the guest follows it and nothing else.
    const relayOnly = !!invitation.relayUrl && !invitation.directKey;
    viaRelay.value = relayOnly; relayHost.value = relayOnly ? relayHostName(invitation.relayUrl) : '';
    native = !relayOnly && bridge.direct ? new DirectLink(bridge.direct) : undefined;
    const transport = createHdhtGuestTransport({ invitation, pin, ...(native ? { direct: native } : {}) });
    const current = new RoomConnection(store, transport, { documentId: invitation.documentId, onChange(value, adopted) {
      if (generation !== epoch) return;
      status.value = value; joined.value = adopted;
      if (value.state === 'error') fail(new Error(value.error ?? 'CONNECTION_LOST'));
    } });
    const presence = createGuestPresence(transport, { name: displayName.value, onChange: value => { if (generation === epoch) showPresence(value); } });
    guestPresence = presence; seen = null; sharePointer();
    room = current; hosting.value = false; setActive(true); pinText.value = '';
    if (!relayOnly) void setHelper(true);
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
  const currentHostPresence = hostPresence, currentGuestPresence = guestPresence;
  host = undefined; room = undefined; binding = undefined; native = undefined; hostPresence = undefined; guestPresence = undefined;
  offStatus(); offStatus = () => {}; offPointer(); offPointer = () => {};
  currentHostPresence?.close(); seen = null; store.setPresence(null);
  busy.value = true; stopping.value = true;
  stopPromise = (async () => {
    try {
      // A guest that leaves on purpose says so first; the host then drops it from the list instead of waiting for it.
      await currentGuestPresence?.leave().catch(() => undefined);
      // Host close gives SESSION_ENDED a bounded flush window before native sockets are destroyed.
      await Promise.allSettled([currentHost?.close(reason), currentRoom?.close(keepLocalCopy, reason)]);
      await bridge.direct?.hostStop().catch(() => undefined);
      currentNative?.dispose();
      await currentBinding?.close().catch(() => undefined);
      await setHelper(false);
      if (disposed || generation !== epoch) return;
      hosting.value = false; joined.value = false; setActive(false); busy.value = false; status.value = null; shareLink.value = ''; hostPin.value = '';
      nativePending.value = false; relayShareAllowed.value = false; viaRelay.value = false; relayHost.value = '';
    } finally { stopping.value = false; stopPromise = undefined; }
  })();
  return stopPromise;
}
function renewPin() { if (host) hostPin.value = host.renewPin(); }
/** The copy symbol in the link field shows a tick for a moment after the link was copied. */
const linkCopied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
async function copy(value: string) {
  clearTimeout(copiedTimer);
  linkCopied.value = await copyText(value);
  note.value = linkCopied.value ? t('Verbindungstext kopiert.') : t('Bitte den Verbindungstext markieren und mit dem üblichen Tastenkürzel kopieren.');
  if (linkCopied.value) copiedTimer = setTimeout(() => { linkCopied.value = false; }, 2000);
}

// The workspace bar shows the running session and can end it without this panel being open (#223).
watch([active, hosting], () => store.setSession(active.value ? { hosting: hosting.value, end: () => stop(joined.value) } : null), { flush: 'sync' });
const offAuthority = store.subscribeAuthority(next => {
  if (room?.isAdopting) return;
  if ((active.value || busy.value) && next !== ownerAuthority && (!room?.isAdopted || !store.getRoomGuest())) void stop(false);
});
watch(() => props.inviteLink, link => {
  if (!link || !isHdhtLink(link) || active.value) return;
  linkText.value = link; pinText.value = ''; emit('link-consumed');
}, { immediate: true });
onBeforeUnmount(() => { clearTimeout(copiedTimer); store.setSession(null); disposed = true; helperWanted = false; offAuthority(); void stop(false); void bridge.helper?.stop().catch(() => undefined); });
</script>

<template>
  <section class="hdht-session" data-testid="hdht-session" :aria-label="t('Session mit Link und PIN')">
    <template v-if="!active">
      <h3>{{ t('Gemeinsam zeichnen') }}</h3>
      <p v-if="route === 'cloud'" data-testid="hdht-route-text">{{ t('Teile einen Link und eine PIN. Alle Geräte verbinden sich über einen Relay bei Cloudflare – auch dort, wo direkte Verbindungen gesperrt sind. Dein Diagramm bleibt Ende-zu-Ende verschlüsselt: Der Relay sieht Netzwerkadressen, Zeitpunkte und Datenmengen, aber weder PIN noch Inhalt.') }}</p>
      <p v-else data-testid="hdht-route-text">{{ t('Teile einen Link und eine PIN. Die Desktop-App verbindet eure Geräte direkt oder über freiwillige Relay-Helfer; dein Diagramm bleibt Ende-zu-Ende verschlüsselt. Solange deine Session läuft, leitet dieses Gerät auch verschlüsselte Daten anderer Sessions weiter.') }}</p>
      <div class="name-field"><AppFieldLabel for="hdht-name">{{ t('Dein Name') }}</AppFieldLabel><AppTextField id="hdht-name" v-model="displayName" data-testid="hdht-name" autocomplete="off" maxlength="40" :placeholder="t('So sehen dich die anderen')" :disabled="busy" @input="markNameEdited" @change="commitName" /></div>
      <AppSelect class="access-field" data-testid="hdht-route" :label="t('Verbindungsweg')" :model-value="route" :options="routeOptions" :disabled="busy" @update:model-value="chooseRoute(String($event))" />
      <div v-if="route === 'cloud'" class="name-field relay-field">
        <AppFieldLabel for="hdht-relay-address">{{ t('Relay-Adresse') }}</AppFieldLabel>
        <AppTextField id="hdht-relay-address" v-model="relayAddress" data-testid="hdht-relay-address" autocomplete="off" spellcheck="false" maxlength="2048" placeholder="sketchdraw-relay.name.workers.dev" :invalid="!!addressError" :aria-describedby="addressError ? 'hdht-relay-address-error' : 'hdht-relay-address-hint'" :disabled="busy" @change="commitRelayAddress" @keydown.enter.prevent="start" />
        <p v-if="addressError" id="hdht-relay-address-error" role="alert" class="error field-note" data-testid="hdht-relay-address-error">{{ addressError }}</p>
        <p v-else id="hdht-relay-address-hint" class="field-note">{{ t('Gäste brauchen die Adresse nicht – sie steht im Session-Link.') }}</p>
      </div>
      <AppSelect class="access-field" :label="t('Zugriff für Eingeladene')" :model-value="role" :options="roleOptions" :disabled="busy" @update:model-value="role = $event as 'viewer' | 'editor'" />
      <AppButton intent="primary" class="full" data-testid="hdht-start" :disabled="busy || !!store.getRoomGuest()" @click="start">{{ t('Session starten') }}</AppButton>
      <div class="separator">{{ t('oder beitreten') }}</div>
      <!-- Link and PIN share a row, so the route choice above does not push "join" out of the default window (#300). -->
      <div class="join-row">
        <label class="sd-field-label">{{ t('Session-Link') }}<input v-model="linkText" class="sd-input" :aria-label="t('Link für PIN-Beitritt')" autocomplete="off" spellcheck="false" maxlength="8192" :disabled="busy" /></label>
        <label class="sd-field-label">{{ t('PIN') }}<input v-model="pinText" class="sd-input pin" :aria-label="t('Sechsstellige PIN')" inputmode="numeric" autocomplete="off" maxlength="8" :disabled="busy" @keydown.enter.prevent="join" /></label>
      </div>
      <AppButton class="full" data-testid="hdht-join" :disabled="busy || !linkText.trim()" @click="join">{{ t('Mit PIN beitreten') }}</AppButton>
      <p v-if="linkRelayHost" class="field-note" data-testid="hdht-link-relay">{{ t('Dieser Link verbindet über den Relay {host}. Der Relay sieht deine Netzwerkadresse, aber keinen Inhalt.', { host: linkRelayHost }) }}</p>
    </template>
    <template v-else>
      <h3>{{ hosting ? t('Session läuft') : joined ? t('Du bist in der Session') : t('Session beitreten') }}</h3>
      <p role="status" data-testid="hdht-status">{{ stateText }}</p>
      <p v-if="hosting && viaRelay && !relayProblem" data-testid="hdht-active-route">{{ t('Verbindungsweg: Cloudflare-Relay ({host})', { host: relayHost }) }}</p>
      <p v-if="relayProblem" role="alert" class="error" data-testid="hdht-relay-problem">{{ relayProblem }}</p>
      <p v-if="joined && status?.state === 'reconnecting'" data-testid="hdht-reconnect-hint">{{ t('Die App versucht fünf Minuten lang, wieder beizutreten.') }}</p>
      <section v-if="participants.length" class="people" :aria-label="t('Personen in der Session')">
        <h4>{{ t('In der Session') }}</h4>
        <ParticipantList :participants="participants" :removable="hosting" @remove="removeParticipant" />
        <div class="name-field"><AppFieldLabel for="hdht-name-active">{{ t('Dein Name') }}</AppFieldLabel><AppTextField id="hdht-name-active" v-model="displayName" data-testid="hdht-name" autocomplete="off" maxlength="40" :placeholder="t('So sehen dich die anderen')" @input="markNameEdited" @change="commitName" @keydown.enter.prevent="commitName" /></div>
      </section>
      <template v-if="hosting && status?.state === 'ready'">
        <template v-if="nativePending && !relayShareAllowed">
          <p>{{ t('Direktverbindung wird noch vorbereitet …') }}</p>
          <p>{{ t('Du kannst bereits über Relay-Helfer einladen. Dieser Link enthält den Direktweg noch nicht.') }}</p>
          <AppButton class="full" data-testid="hdht-share-relay" @click="relayShareAllowed = true">{{ t('Link jetzt über Relay-Helfer teilen') }}</AppButton>
        </template>
        <template v-else>
        <div class="copy-field">
          <label class="sd-field-label" for="hdht-link">{{ t('Link zum Teilen') }}</label>
          <div class="copy-row">
            <input id="hdht-link" class="sd-input" readonly :value="shareLink" data-testid="hdht-link" :aria-label="t('Session-Link zum Kopieren')" @focus="($event.target as HTMLInputElement).select()" />
            <AppIconButton class="copy-button" data-testid="hdht-copy-link" :icon="linkCopied ? 'check' : 'copy'" :icon-size="18" :label="t('Session-Link kopieren')" @click="copy(shareLink)" />
          </div>
        </div>
        <label class="sd-field-label">{{ t('PIN getrennt teilen') }}<input class="sd-input pin" readonly :value="hostPin" data-testid="hdht-host-pin" :aria-label="t('PIN zum Teilen')" @focus="($event.target as HTMLInputElement).select()" /></label>
        <AppButton class="full" @click="renewPin">{{ t('Neue PIN') }}</AppButton>
        <AppSelect class="access-field" :label="t('Zugriff für neue Beitritte')" :model-value="role" :options="roleOptions" @update:model-value="role = $event as 'viewer' | 'editor'" />
        </template>
      </template>
      <template v-else-if="joined"><p>{{ store.state.roomGuest?.role === 'editor' ? t('Gemeinsam bearbeiten') : t('Nur ansehen') }} · {{ routeText }}</p></template>
      <AppButton class="full" data-testid="hdht-stop" :disabled="stopping" @click="stop(joined)">{{ hosting ? t('Session beenden') : joined ? t('Sitzung verlassen und Kopie behalten') : t('Verbindungsaufbau abbrechen') }}</AppButton>
    </template>
    <p v-if="helperError" role="alert" class="error" data-testid="hdht-helper-error">{{ helperError }}</p>
    <p v-if="error" role="alert" class="error">{{ error }}</p><p v-if="note" role="status">{{ note }}</p>
  </section>
</template>

<style scoped>
.hdht-session h3{margin:0 0 8px;font-size:15px}.hdht-session h4{margin:0 0 var(--space-1);font-size:var(--font-size-s);font-weight:600;color:var(--text-muted)}.people{margin:var(--space-3) 0 var(--space-4);padding:var(--space-3) 0;border-block:1px solid var(--border-subtle)}.name-field{display:grid;gap:5px;margin:var(--space-3) 0 var(--space-2)}.name-field .sd-field-label{margin:0}.name-field .sd-input{margin-top:0}.relay-field{margin-top:0}.hdht-session .field-note{margin:0 0 var(--space-1)}.join-row{display:grid;grid-template-columns:minmax(0,1fr) 7.75rem;gap:var(--space-2);align-items:end}.hdht-session .sd-input{min-height:42px}.join-row .sd-input{height:42px}.join-row .pin{padding-inline:8px;text-align:center}.hdht-session p{font-size:12px;line-height:1.6;color:var(--text-muted);margin:8px 0 12px}.sd-field-label{display:block;margin:12px 0 8px}.access-field{margin:12px 0 8px}.sd-input{width:100%;margin-top:5px}.full{width:100%;margin:8px 0}.pin{font:18px var(--font-mono);letter-spacing:.2em}.copy-field{margin:12px 0 8px}.copy-field .sd-field-label{margin:0 0 5px}.copy-row{position:relative}.copy-row .sd-input{margin-top:0;padding-right:40px;text-overflow:ellipsis}.copy-button{position:absolute;top:50%;right:2px;width:32px;height:28px;min-width:0;min-height:0;transform:translateY(-50%);color:var(--text-muted)}.copy-button:hover{color:var(--text-primary)}.separator{margin:12px 0;text-align:center;font-size:12px;color:var(--text-muted)}.error{color:var(--status-error)!important}
</style>
