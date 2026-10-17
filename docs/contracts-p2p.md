# Strict-P2P-Zusammenarbeit — S4-Vertragsentwurf

Issues [#6](https://github.com/J-ARTS/de.sketchdraw.io/issues/6) und [#14](https://github.com/J-ARTS/de.sketchdraw.io/issues/14), Codex, 17.10.2026. **Entwurf zur Architekturfreigabe**, keine implementierte API und kein bestandener P2P-Test. Grundlage: [ADR 0002](decisions/0002-direct-peer-session-order.md), [Architektur](architecture.md), [Domänenvertrag](contracts.md), [MCP-Vertrag](contracts-mcp.md) und dessen [unabhängiges Review](reviews/codex-mcp-contract-review.md). Antigravity implementiert Transport, IAM und Replikation; Claude Code integriert den abgestimmten Store-Vertrag und die Oberfläche; Codex prüft die Abnahme.

## 1. Autorität und tatsächlich vorhandene Integrationsgrenzen

Ein Owner-Peer ordnet die gemeinsamen Änderungen. Jeder Gast verbindet sich direkt mit ihm; Gäste brauchen keine Verbindung untereinander. Der Owner ist eine teilnehmende Desktop-App, kein externer Dienst. Ohne Owner entstehen keine neuen gemeinsamen Commits. Es gibt keine automatische Wahl eines Ersatz-Owners und keine behauptete Offline-Konvergenz.

Der tatsächlich vorhandene `DocumentController` in `src/domain/controller.ts` arbeitet synchron: `dispatch(command, context)`, `undo(actorId)`, `redo(actorId)`, `getSnapshot()`, `getHistoryState(actorId)`, `subscribe(listener)`. `dispatch` prüft CAS und lässt semantische No-Ops unverändert. Undo/Redo haben selbst keinen `expectedRevision`-Parameter. Subscriber erhalten abgetrennte Snapshots, keine Operation-/Actor-Metadaten. Daher können sie allein kein vollständiges P2P-Commitprotokoll erzeugen.

Der Owner verwendet **genau den vorhandenen Controller seines geöffneten Dokuments**. Alle Human-, Code-, Import-, MCP- und Peer-Schreibvorgänge einschließlich Undo/Redo laufen durch einen gemeinsamen WriteGateway. Niemand behält einen zweiten direkten Schreibpfad. Die Domänen-API bleibt synchron; der Gateway übernimmt asynchrones Einreihen, Prüfung, Transport und Ergebnisauflösung. Ein Controllerwechsel erzeugt auch bei identischer Dokument-ID eine neue, nicht wiederverwendete `controllerEpoch`.

Ein Gast besitzt einen validierten, abgetrennten Readonly-Mirror des bestätigten Owner-Zustands. Er erzeugt dafür keinen schreibbaren Controller und führt keine lokale autoritative History. `applyCommand` darf intern zur Prüfung einer **bereits vom Owner bestätigten** Änderung verwendet werden; dies ist keine lokale Annahme eines Vorschlags. Pointer-, Text- und Codeentwürfe bleiben separat. Eine explizite lokale Weiterarbeit nach Verlassen der Session erzeugt einen neuen lokalen Controller aus einem gewählten Snapshot; sie ist eine getrennte Arbeit, keine Fortsetzung gemeinsamer Commits.

## 2. Gemeinsame Gateway-Typen

Folgende Typen werden aus `src/session/index.ts` exportiert. Sie ergänzen die Store-/Adapterebene, ohne `DocumentController` zu verändern. Die `DocumentSessionKey`-Epoche beschreibt die lokale Controller-Instanz; `PeerSessionKey` bindet die Netzwerkfreigabe an genau diese Instanz. Die Implementierung verwendet die Domain-Typen direkt.

```ts
import type {
  CommandContext, DocumentCommand, DocumentController, DocumentSession,
  HistoryAvailability,
} from '../domain';

export interface DocumentSessionKey {
  documentId: string;
  controllerEpoch: string; // random 128-bit hex; never reused
}
export interface PeerSessionKey extends DocumentSessionKey {
  sessionId: string;       // random 128-bit hex; never reused
  permissionEpoch: number; // non-negative safe integer
}
export type WriteAction =
  | { kind: 'dispatch'; command: DocumentCommand }
  | { kind: 'undo' }
  | { kind: 'redo' };
export interface WriteIntent {
  requestId: string;       // scopeId + ':' + clientSequence; stable across retries
  expectedRevision: number;
  action: WriteAction;
}
export type WriteOutcome =
  | { status: 'committed'; requestId: string; revision: number }
  | { status: 'no-op'; requestId: string; revision: number }
  | { status: 'rejected'; requestId: string; code: WriteErrorCode;
      accepted: boolean; currentRevision?: number }
  | { status: 'outcome-unknown'; requestId: string };
export interface DocumentSnapshotSource {
  getSnapshot(): DocumentSession; // detached validated copy
  subscribe(listener: (snapshot: DocumentSession) => void): () => void;
}
export interface ReadonlyDocumentSource extends DocumentSnapshotSource {
  getHistoryState(): HistoryAvailability; // for this bound actor
}
export interface BoundWriteGateway {
  readonly session: DocumentSessionKey;
  nextRequestId(): string | null; // no new ID while this actor has an unresolved write
  submit(intent: WriteIntent): Promise<WriteOutcome>;
  queryOutcome(requestId: string): Promise<WriteOutcome
    | { status: 'pending'; requestId: string } | { status: 'not-seen' }>;
}
export interface TransitionBarrier {
  readonly token: string;
  readonly session: DocumentSessionKey;
  readonly snapshot: DocumentSession;
  readonly draftGeneration: number;
  readonly unresolvedRequestIds: readonly string[]; // guest only; never implicitly saved
}
export interface DocumentLifecycleGate {
  beginTransition(reason: 'close' | 'replace' | 'revoke',
    draftGeneration: number): Promise<TransitionBarrier>;
  isCurrent(barrier: TransitionBarrier, draftGeneration: number): boolean;
  cancelTransition(token: string): void;
  completeTransition(token: string): void;
}
```

```ts
export type WriteErrorCode =
  | 'ACCESS_DENIED' | 'ACCESS_REVOKED' | 'SESSION_CHANGED' | 'DOCUMENT_MISMATCH'
  | 'REVISION_CONFLICT' | 'HISTORY_EMPTY' | 'HISTORY_CONFLICT' | 'VALIDATION_FAILED'
  | 'REQUEST_TOO_LARGE' | 'BUSY' | 'TRANSITION_PENDING' | 'NOT_CONNECTED'
  | 'PEER_NOT_READY' | 'SEQUENCE_GAP' | 'REQUEST_ID_REUSED' | 'REQUEST_TIMEOUT'
  | 'PROTOCOL_ERROR' | 'AUTHORITY_DIVERGED' | 'INTERNAL_ERROR';
export declare class SessionAccessError extends Error {
  readonly code: WriteErrorCode;
  constructor(code: WriteErrorCode);
}
```

`OUTCOME_UNKNOWN` ist kein nachgewiesenes Scheitern. Nicht autorisierte Antworten enthalten keinen Dokumentstand. Source-/Factory-/Lifecycle-Methoden, die keinen `WriteOutcome` zurückgeben, melden Fehler als `SessionAccessError extends Error` mit `readonly code: WriteErrorCode`; keine beliebigen Exceptions oder Fehlertexte über die Wire-Grenze serialisieren.

Ein `BoundWriteGateway` entsteht ausschließlich durch die eigene vertrauenswürdige Store-/IAM-Komposition. Weder `actorId` noch `source`, Grant oder Rolle stammen frei aus `WriteIntent`. Lokale Bindungen besitzen intern Actor, Source, Grant-ID und Grant-Generation. `human`, `code` und `import` können denselben lokalen menschlichen Actor verwenden; lokale MCP-Freigaben bekommen eigene Agent-Actor. Ein Peer-Gateway bindet Session, Schlüssel und registrierten Actor-Scope. Eine aus JavaScript nachgebaute Bindung ist kein Berechtigungsnachweis: Netzwerkgrenzen prüfen die Signatur und serverseitige Zuordnung erneut.

Vor **jedem** synchronen Controller-Aufruf werden aktive Session, aktuelle Grant-Generation, Schreibrecht, Actorbindung, CAS und Lifecycle-Gate erneut synchron geprüft. Zwischen dieser Prüfung und `dispatch`/`undo`/`redo` liegt kein `await`. Undo/Redo erhalten CAS durch diese Gateway-Prüfung; ihr bestehender synchroner Domain-Aufruf bleibt unverändert. Ein Subscriber darf keine direkte reentrante Controller-Mutation auslösen. Unerwartete Revisionen durch einen umgangenen Gateway stoppen die Session mit `AUTHORITY_DIVERGED`, statt dafür erfundene Commitmetadaten zu erzeugen.

`beginTransition` sperrt den Eingang bereits beim Aufruf, bevor sein Promise wartet. Noch nicht linearisierte Operationen werden verworfen/abgewiesen; bereits linearisiert angewendete Operationen sind im Barrier-Snapshot enthalten. Drain wartet auf lokale Commitauflösung, **nicht** auf entfernte ACKs, Netzwerk-Timeouts oder einen MCP-Client. Eine externe Antwort kann trotz lokal bekanntem Commit verloren gehen.

Vor der endgültigen Schließ-/Öffnenentscheidung müssen lokale Text-/Codeentwürfe entweder bestätigt angewendet oder ausdrücklich behalten/verworfen werden. Der Store sperrt neue UI-Eingaben während dieser Vorbereitung. Ein ungelöster Entwurf oder unbekannter Schreibausgang verhindert die Behauptung „alles gespeichert“. Der Barrier-Snapshot, `controllerEpoch`, Token, Revision und `draftGeneration` werden nach jeder asynchronen Dialog-/Speicherfortsetzung erneut geprüft. Das Gate bleibt bis zum tatsächlichen Schließen bzw. Controllerwechsel bestehen. Abbruch oder Speicher-/IPC-Fehler lösen ausschließlich das passende Token, niemals eine neuere Sperre. Verwerfen erfolgt nur durch die entsprechende Nutzerentscheidung.

UI-Widerruf sperrt den lokalen Gateway vor dem ersten `await` zu Main. Ein von Main ausgelöster Widerruf benötigt die bestätigte Renderer-/Gateway-Sperre; „widerrufen“ darf nicht schon bei bloßem Versenden des Signals behauptet werden. Vor dem linearen Sperrpunkt bestätigte Änderungen bleiben bestätigt. Diese Regeln gelten ebenso für MCP; Details MC-01–MC-04 im verlinkten Review.

### Gemeinsame Autorität ohne Importzyklus

`src/session` importiert ausschließlich Domain-Typen/-Funktionen und Plattformgrundlagen; weder `src/collaboration`, MCP, Vue noch Electron Main. MCP-, Collaboration- und Rendereradapter importieren `src/session`. Die vertrauenswürdige Renderer-Komposition erzeugt pro geöffnetem Dokument genau eine Authority und übergibt dieselbe Instanz an diese Adapter. Die folgenden Exporte gehören ebenfalls nach `src/session/index.ts`:

```ts
export interface GrantCheck {
  readonly session: DocumentSessionKey;
  readonly bindingId: string;
  readonly bindingGeneration: number; // authority-assigned, never reused in this session
  readonly grantId: string;
  readonly grantGeneration: number;
  readonly actorId: string;
  readonly source: CommandContext['source'];
  readonly permission: 'read' | 'write';
}
export type GrantDecision = { allowed: true }
  | { allowed: false; code: 'ACCESS_DENIED' | 'ACCESS_REVOKED' | 'SESSION_CHANGED' };
export type GrantGuard = (check: GrantCheck) => GrantDecision; // synchronous, no I/O
export interface ActorBindingOptions {
  actorId: string; // trusted composition only; never copied from untrusted intent
  source: CommandContext['source'];
  grantId: string;
  grantGeneration: number;
  guard: GrantGuard;
  peerSessionId?: string; // required exactly for source: 'peer'; trusted OwnerSession ID
}
export interface ActorBinding {
  readonly bindingId: string;
  readonly bindingGeneration: number;
  readonly scopeId: string; // authority-generated 128-bit request namespace
  readonly actorId: string;
  readonly source: ReadonlyDocumentSource;
  readonly gateway: BoundWriteGateway;
}
export interface DocumentCommit {
  readonly session: DocumentSessionKey;
  readonly bindingId: string;
  readonly requestId: string;
  readonly actorId: string;
  readonly source: CommandContext['source'];
  readonly action: WriteAction;
  readonly previousRevision: number;
  readonly snapshot: DocumentSession; // exact result; revision = previousRevision + 1
}
export interface DocumentAuthority {
  readonly session: DocumentSessionKey;
  readonly source: DocumentSnapshotSource; // trusted adapters; no unbound history access
  readonly lifecycleGate: DocumentLifecycleGate;
  bindActor(options: ActorBindingOptions): ActorBinding;
  revokeBinding(bindingId: string): void; // synchronous; queued writes lose permission
  finalizePeerSession(peerSessionId: string): void; // trusted irreversible session end
  subscribeCommits(listener: (commit: DocumentCommit) => void): () => void;
}
export interface DocumentAuthorityOptions {
  controller: DocumentController; // exclusive ownership transferred to this authority
  onFatal?: (error: { code: 'AUTHORITY_DIVERGED' | 'INTERNAL_ERROR' }) => void;
}
export declare function createDocumentAuthority(
  options: DocumentAuthorityOptions,
): DocumentAuthority;
```

`createDocumentAuthority` liest/validiert den aktuellen Controllerstand, erzeugt die `controllerEpoch` über `crypto.getRandomValues` selbst und übernimmt den Controller exklusiv. Es gibt keinen Export des Controllers, keine frei wählbare Epoche und keinen öffentlichen `dispatch` auf der Authority. Bei bestehender Anwendung wird der bisherige Controller an dieser einen Stelle übernommen; seine bisherigen Writer werden auf Bindings umgestellt. Der Domainkonstruktor und dessen Synchronsignaturen ändern sich dadurch nicht.

`bindActor` ist eine vertrauenswürdige Kompositionsfunktion, kein IPC-/MCP-/Peer-Endpunkt. Sie validiert alle IDs und Generationen, erzeugt eine neue Binding-/Scope-ID sowie eine innerhalb der Authority nie wiederverwendete `bindingGeneration` und hält Session, Grant-ID, beide Generationen, Actor und Source unveränderlich privat. Der Guard liest eine lokale IAM-Tabelle und prüft exakt die angefragten Werte; seine Signatur darf keine Promise liefern. Er darf keine Mutation, Reentranz oder externe Kommunikation auslösen. Bei Throw, ungültigem Rückgabewert oder nicht mehr passender Generation wird verweigert. Die Authority prüft zusätzlich ihren eigenen Bindungsstatus und die Session; ein Guard kann widerrufene Bindings nicht wiederbeleben. Source-Reads, History, Subscriberzustellung und Ergebnisabfragen prüfen Leserecht erneut. Eine widerrufene Quelle liefert keine neuen Daten und beendet ihre Subscription; bereits abgetrennte Kopien werden nicht als rückrufbar behauptet.

`revokeBinding` sperrt synchron vor Rückkehr, verwirft noch nicht linearisierte Aufträge dieser Bindung und entfernt ihre Subscriber. Wiederholter Widerruf derselben bekannten Bindung ist idempotent; alte Gatewayobjekte bleiben gesperrt. Bereits ausgeführte Commits und deren Journal werden nicht zurückgerollt. Änderungen an der Grant-Tabelle werden ebenfalls synchron vor einem asynchronen Main-Ack wirksam. Das wiederholte Erzeugen neuer Bindings darf Limits nicht umgehen: höchstens 64 lebende oder noch zur Deduplizierung erforderliche Bindings je Authority, davon höchstens 40 Peer-Scopes und 16 lokale Bindings. Alte Peer-Journale dürfen erst nach unwiderruflicher Beendigung ihrer gesamten Peer-Session entfallen; ihre alten Gatewayobjekte bleiben lokal gesperrt. Innerhalb einer noch gültigen Session werden High-Water-Marks nicht zur Platzgewinnung vergessen. Bei Ausschöpfung: `BUSY` und sichtbarer neuer Sessionstart, kein stilles erneutes Annehmen alter IDs.

`subscribeCommits` liefert ausschließlich tatsächlich angewendete Revisionserhöhungen, genau einmal und in Commitreihenfolge; No-Ops und Ablehnungen haben nur ihren Gateway-Ausgang. Action und Ergebnissnapshot stammen aus dem vor Mutation validierten, abgetrennten Intent bzw. dem exakten Controllerergebnis. Externe Listener erhalten unveränderliche bzw. erneut abgetrennte Werte. Das interne Ergebnisjournal ist bereits aktualisiert, bevor eine Listenerbenachrichtigung sichtbar wird. Listener werden ohne Warten auf ihre asynchronen Folgen bedient; Exceptions werden isoliert und erzeugen weder Rollback noch ein falsches Reject. Reentrante `submit`-Aufrufe gelangen höchstens ans Ende derselben Queue. Hashing/Signierung hängen eine separate begrenzte Verarbeitung an diese Commitmetadaten; sie lesen keinen späteren Snapshot als Ersatz. Ein Client, der erst ab Revision `r` synchronisiert, ignoriert bereits erfasste ältere Benachrichtigungen und verlangt danach eine lückenlose Folge.

Human-/Code-/Importbindungen dürfen denselben menschlichen Actor für gemeinsame History führen; ihre Request-Scopes und Sources bleiben getrennt. Der Store benutzt ihre gebundenen Sources für History. Ein lokaler MCP-Grant erhält einen eigenen Actor/Scope. Der Collaborationadapter erzeugt Peer-Bindings erst aus bestätigtem Key, Owner-Rolle und zugewiesenem Scope; sein synchroner Guard prüft auch aktuelle Kanalbindung und Permission-Epoche. `DocumentAuthority.source` und `bindActor` werden ausschließlich an vertrauenswürdige Adapter weitergegeben, niemals an Tool-/Diagrammpayloads.

`completeTransition` ist vom intern gespeicherten Grund abhängig: `close`/`replace` legt die alte Authority dauerhaft still; erst eine neue Factory kann wieder schreiben. Bei `revoke` sind die betroffenen Bindings vor dem Abschluss widerrufen; nach Ende der Peer-Session werden lokale, weiterhin berechtigte Bindings auf derselben Authority wieder zugelassen. `cancelTransition` löst nur das aktive passende Token. Ein zweiter Übergang ersetzt eine aktive Sperre nicht still; er erhält `TRANSITION_PENDING`. Native Close-IPC wird während aktiver Sperre gesendet; ein ACK allein hebt sie nicht auf. Bei tatsächlichem Fensterende wird die Authority entsorgt, bei eindeutigem Close-Abbruch kontrolliert entsperrt.

`peerSessionId` ist nur für Peer-Bindings zulässig und dort erforderlich; sie ist die validierte, unveränderlich gebundene 128-Bit-Session-ID der vertrauenswürdigen Owner-Komposition. Nach unwiderruflichem Ende der gesamten Peer-Session ruft ausschließlich der Collaborationadapter `finalizePeerSession(peerSessionId)` auf. Alle Gruppenbindungen müssen zuvor synchron widerrufen und ihre lokale Arbeit terminalisiert sein; andernfalls `BUSY` ohne Teilfreigabe. Der Abschluss wartet nicht auf entfernte ACKs. Er entfernt ausschließlich die Gruppenjournale/High-Water-Marks aus den Retentionsbudgets und ist bei Wiederholung wirkungslos. Alte Gateway-/Sourceobjekte bleiben dauerhaft widerrufen; verspätete Verarbeitung oder erneute Bindung derselben abgeschlossenen Session darf sie nicht wiederbeleben. Lokale Bindings, MCP-Grants, Controllerrevision und History bleiben erhalten. Der Abschluss ist kein öffentlicher IPC-/MCP-/Peer-Aufruf und keine Dokumentmutation. Freigegeben von Root nach [PP-01](reviews/codex-p2p-contract-review.md).

### Lokale Abschlussgrenze beim Gast

Der Gast verwendet dieselben Gateway-/Source-/Gate-Typen, aber keine `DocumentAuthority`. Sein Gate kann den entfernten Owner nicht einfrieren. Es sperrt neue lokale Übermittlungen und neue Mirrorinstallationen synchron, nimmt den letzten vollständig validierten Mirror als Barrier-Snapshot und wartet nur auf lokale Verarbeitung. Inflight-Signatur-/Chunkprüfungen müssen vor Installation nochmals das Gate prüfen. Eingehende Daten bleiben begrenzt gepuffert; bei ausgeschöpftem Budget wird die Verbindung geschlossen und Resync notwendig, statt den eingefrorenen Snapshot zu ändern.

Beim Gast enthält die Barrier alle schon übermittelten, noch ungeklärten Request-IDs. Diese gelten beim Speichern der Barrier-Kopie weiterhin ausdrücklich als **nicht mitgespeichert**; eingehende Resultate werden erst nach Aufheben der Barrier verarbeitet. Close/Replace ist nur nach sichtbarer Entscheidung zulässig: abbrechen und Ausgänge klären oder diese ausstehenden lokalen Entwürfe ausdrücklich verwerfen. Kein unbeschränktes Warten auf Ownerantwort, kein implizites Verwerfen. Ein Cancel verarbeitet gültige gepufferte Daten oder startet Resync mit frischer Nonce und klärt dieselben Request-IDs. Ein bestätigtes Leave/Close beendet die Verbindung; die gespeicherte Datei beschreibt ausschließlich die bestätigte Revision des Barrier-Snapshots. P2P-14 muss Owner- und Gastvariante getrennt prüfen.

## 3. Öffentliche Collaboration-API

Geplante Exporte aus `src/collaboration/index.ts`:

```ts
import type {
  BoundWriteGateway, DocumentAuthority, DocumentLifecycleGate,
  DocumentSnapshotSource, PeerSessionKey, ReadonlyDocumentSource,
} from '../session';

export type PeerRole = 'owner' | 'editor' | 'viewer';
export type PeerState = 'pairing' | 'awaiting-confirmation' | 'syncing' | 'ready'
  | 'disconnected' | 'resync-required' | 'revoked' | 'closed';
export interface PairingText { invitationId: string; text: string; expiresAt: number }
export interface PairingReview {
  invitationId: string;
  ownerKeyFingerprint: string;
  peerKeyFingerprint: string;
  ownerDtlsFingerprint?: string;
  peerDtlsFingerprint?: string;
  comparisonCode: string;
  role: 'editor' | 'viewer';
}
export interface CollaborationStatus {
  mode: 'owner' | 'guest';
  state: PeerState;
  session: PeerSessionKey;
  role: PeerRole;
  confirmedRevision: number;
  pendingWrites: number;
  hasUnresolvedOutcome: boolean;
  peers: readonly { peerId: string; role: PeerRole; state: PeerState }[];
}
export interface OwnerSession {
  source: DocumentSnapshotSource;
  createInvitation(role: 'editor' | 'viewer',
    options?: { resumePeerId: string }): Promise<PairingText>;
  acceptAnswer(text: string): Promise<PairingReview>;
  confirmPeer(invitationId: string, comparisonCode: string): Promise<void>;
  // Ends the current permission/session generation; see lifecycle policy below.
  revokePeer(peerId: string): Promise<void>;
  getStatus(): CollaborationStatus;
  subscribeStatus(listener: (status: CollaborationStatus) => void): () => void;
  close(): Promise<void>;
}
export interface GuestPairing {
  answer: PairingText;
  review: PairingReview;
  confirmOwner(comparisonCode: string): Promise<GuestSession>;
  cancel(): void;
}
export interface GuestSession {
  source: ReadonlyDocumentSource;
  gateway: BoundWriteGateway; // role checked at owner; viewer never gains write
  lifecycleGate: DocumentLifecycleGate; // local mirror/submission barrier, not owner freeze
  getStatus(): CollaborationStatus;
  subscribeStatus(listener: (status: CollaborationStatus) => void): () => void;
  acceptReconnectOffer(text: string): Promise<GuestPairing>; // same live identity, new PC
  leave(): Promise<void>;
}
declare const identityBrand: unique symbol;
export interface SessionIdentity {
  readonly [identityBrand]: true; // private runtime registry, not just a TypeScript cast
  readonly publicKeyBase64Url: string;
  readonly keyHash: string;
}
export interface OwnerSessionOptions {
  authority: DocumentAuthority;
  identity: SessionIdentity;
  onStatus?: (status: CollaborationStatus) => void;
}
export interface GuestOptions {
  identity: SessionIdentity;
  onStatus?: (status: CollaborationStatus) => void;
}
export declare function createSessionIdentity(): Promise<SessionIdentity>;
export declare function createOwnerSession(options: OwnerSessionOptions): Promise<OwnerSession>;
export declare function acceptInvitation(text: string, options: GuestOptions): Promise<GuestPairing>;
```

`DocumentAuthority`, Gateway-, Source- und Gate-Typen werden ausschließlich aus `../session` importiert. `OwnerSessionOptions.authority` ist die bereits bestehende lokale Autorität, keine zweite Modellkopie. `GuestOptions` enthält **keinen** Controller. `SessionIdentity` ist ein von der Factory registriertes Handle; privater Schlüssel und Signierfunktionen bleiben in einer privaten Registry. Ein nachgebautes Objekt oder fremdes Handle wird abgewiesen. Die konkreten Produktionsfabriken verwenden WebCrypto, Plattformuhr und `RTCPeerConnection`; ein interner Testadapter darf diese ersetzen, wird aber nicht als benutzerkonfigurierbarer Transport exportiert. Statuscallbacks sind optional, abgetrennt und dürfen keinen Commit blockieren. Ein Owner hat höchstens eine aktive Peer-Session je Authority; der zweite Factoryaufruf liefert `BUSY`. Das Owner-UI verwendet weiterhin seine lokale ActorBinding für History und Writes, nicht einen neuen Collaboration-Controller.

Beim Reconnect erstellt der Owner mit `resumePeerId` ein neues Offer. Der Gast importiert es über `acceptReconnectOffer` unter seiner noch lebenden Identität und liefert ein neues Answer. `acceptAnswer`/`confirmPeer` und `confirmOwner` schließen denselben Bestätigungsablauf ab. Die bestehende Rolle wird dabei nicht still geändert. Alte Kanalbindungen verlieren vor Aktivierung der neuen Verbindung ihre Berechtigung; wartende alte Nachrichten werden unmittelbar vor Commit erneut gegen diese Bindung geprüft.

## 4. Transport und manuelles Pairing

Produktkonfiguration: `new RTCPeerConnection({ iceServers: [], iceTransportPolicy: 'all', iceCandidatePoolSize: 0 })`. Kein verstecktes `setConfiguration` mit ICE-Diensten, kein Cloud-Identity-Provider und keine Fetch-/WebSocket-Signalingroute. Der Owner erzeugt genau zwei zuverlässige, geordnete DataChannels: `sketchdraw-control-v1` und `sketchdraw-bulk-v1`, beide mit Protokoll `sketchdraw.p2p.v1`; `maxRetransmits` und `maxPacketLifeTime` bleiben ungesetzt. Der Gast akzeptiert nur diese zwei Kanäle. Medien-Tracks, weitere Kanäle und Renegotiation werden in v1 abgewiesen.

`iceServers: []` bedeutet keine konfigurierten STUN-/TURN-**Dienste**. ICE-Verbindungsprüfungen verwenden dennoch STUN-Nachrichten direkt zwischen den Peers. Die Vorgabe darf deshalb nicht als „kein einziges STUN-Paket“ dargestellt werden. [W3C RTCConfiguration](https://www.w3.org/TR/webrtc/#rtcconfiguration-dictionary), [RFC 8445, Connectivity Checks](https://www.rfc-editor.org/rfc/rfc8445.html#section-2.2).

Offer/Answer-Ablauf:

1. Owner erzeugt eine einmalige Einladung und PeerConnection, legt die Kanäle an, erstellt Offer und setzt es lokal. Erst nach `iceGatheringState === 'complete'` wird **`pc.localDescription`** exportiert, nicht das frühere Ergebnis von `createOffer()`. Listener vor dem Warten registrieren, Zustand sofort erneut prüfen, Fehler-/Closepfad mit abhängen. Gathering nach 20 Sekunden ohne Abschluss: `GATHERING_TIMEOUT`, Verbindung schließen, frische Einladung anbieten.
2. Gast prüft Größen, Version, Signatur, Sessionbindung und SDP-Struktur, setzt genau dieses vollständige Offer, erzeugt/setzt Answer, wartet ebenfalls auf vollständiges Gathering und exportiert seine aktuelle lokale Beschreibung. Unvollständige oder leere Kandidatenmengen werden nicht als erfolgreiche Verbindung bezeichnet. Nicht allein auf ein einzelnes `icecandidate`-Ereignis verlassen. [W3C ICE-Gathering](https://www.w3.org/TR/webrtc/#dom-rtcicegatheringstate).
3. Owner importiert das an seine noch offene Einladung gebundene Answer. Die Einladung ist nur einmal verwendbar und nach fünf Minuten abgelaufen; Owner prüft seine lokal gemessene Laufzeit, damit Uhrabweichungen beim Gast keine Einladung verlängern. Ein zweiter Gast erhält ein eigenes Offer/eine eigene PeerConnection.
4. Nach Transportaufbau werden nur Authentifizierungsnachrichten akzeptiert. Beide Menschen vergleichen den unten definierten Code über einen unabhängig vertrauenswürdigen Weg und bestätigen explizit. Erst danach überträgt der Owner Grant und Dokument. Offene Kanäle allein bedeuten weder Authentifizierung noch fertige Synchronisation.

Der SDP-Import erlaubt genau eine DataChannel-`m=application`-Sektion mit DTLS/SCTP und SHA-256-Fingerprint; keine Audio-/Videoabschnitte, keine weiteren Transports. Maximal 64 Kandidaten, eindeutige erforderliche SDP-Felder und passende Offer-/Answer-Typen. `relay`-/`srflx`-Kandidaten in importierten Paketen werden im Strict-Profil abgewiesen; während direkter ICE-Prüfung entstehende peer-reflexive Kandidaten sind kein externer STUN-Dienst. SDP wird validiert und anschließend unverändert an WebRTC übergeben, nicht durch willkürliches Kürzen „repariert“.

Direkte Pfade sind unter anderem im geeigneten LAN oder bei erreichbaren direkten IPv6-Adressen möglich. NAT, Firewall, mDNS-Adressierung und Browser-/OS-Datenschutzrichtlinien können sie verhindern. Die App meldet diese Grenze und aktiviert keinen Relay-Fallback. Sie ändert keine Firewall-, Browser-Sicherheits- oder Netzwerk-Privatsphäreneinstellungen. Pairing-Pakete können lokale Adressen enthalten und gehören nicht in öffentliche Issues oder Telemetrie. [RFC 8828, IP Address Handling](https://www.rfc-editor.org/rfc/rfc8828.html).

## 5. Identität, Fingerprints und Rollen

V1 verwendet WebCrypto ECDSA mit P-256/SHA-256. Der öffentliche Schlüssel wird als 65-Byte-Raw-Punkt importiert/exportiert; `peerKeyHash` ist SHA-256 dieser Bytes. Signaturen verwenden das WebCrypto-Format `r || s` mit 64 Bytes, kein ASN.1-DER. Private Schlüssel bleiben für die laufende Session nicht exportierbar im Speicher. Kein `Math.random` für Schlüssel, IDs oder Nonces und kein eigener Kryptografie-Fallback. Fehlende WebCrypto-Funktionen sind ein erklärbarer Abbruch. [W3C Web Cryptography, ECDSA](https://www.w3.org/TR/2017/REC-WebCryptoAPI-20170126/#ecdsa-operations).

Jedes Pairing-Paket enthält Version, Typ, vollständige Session-/Dokumentbindung, Einladung-ID, 256-Bit-Nonce, Erzeugungs-/Ablaufzeit, öffentlichen Schlüssel, exakte SDP-Zeichenfolge, SHA-256-DTLS-Fingerprint und Signatur. Das Offer nennt die angebotene Rolle; das Answer zusätzlich den Hash des vollständigen signierten Offers. Der äußere Transport ist Base64url von UTF-8-JSON, ohne Kompression. Maximal 256 KiB decodiert und 350 KiB eingegebener Text, SDP maximal 192 KiB.

Signierte Objekte verwenden `SignedPayload { payload: string, signature: string }`. Die Signatur deckt exakt `UTF8('sketchdraw.p2p.v1\n' + payload)` ab. `payload` bleibt die ursprüngliche JSON-Zeichenfolge: zum Verifizieren niemals neu serialisieren, normalisieren oder Felder verschiedener Pakete mischen. Äußere Hülle und Payload werden größenbegrenzt jeweils einmal strikt geparst und schema-validiert; das ist beim erstmaligen Pairing nötig, um den angebotenen öffentlichen Schlüssel zu lesen. Geparste Felder gelten bis erfolgreicher Signaturprüfung und erforderlicher menschlicher Bestätigung als unbestätigt. Doppelte JSON-Schlüssel, unbekannte Felder, ungültige Zahlen/IDs, verbotene Record-Schlüssel und übertiefe Strukturen werden verworfen. Der stabile Intentdigest für Wiederholungen ist separat definiert (§6); veränderliche Verbindungshüllen und ECDSA-Signaturbytes gehören nicht zu ihm.

`offerHash = SHA256(UTF8(exaktes signiertes Offer-JSON))`, entsprechend `answerHash`. Der Vergleichscode besteht aus den ersten 128 Bits von `SHA256(UTF8('sketchdraw.pair.v1\n' + offerHash + '\n' + answerHash))`, dargestellt als acht Vierergruppen Hex. Zusätzlich bleiben beide vollständigen Key-/DTLS-Fingerprints einsehbar. Der Code wird vollständig verglichen, nicht auf sechs Ziffern gekürzt. Ein selbst signierter Schlüssel aus demselben unbestätigten Austausch beweist noch keine Identität; der unabhängige menschliche Vergleich ist notwendig. Die Bindung von Identitätsprüfung an die DTLS-Fingerprints folgt dem Sicherheitsproblem aus [RFC 8827](https://www.rfc-editor.org/rfc/rfc8827.html#section-5.1), ohne dessen externen Identity-Provider zu übernehmen.

Vor Dokumentfreigabe: SHA-256-Fingerprint aus SDP mit dem Paketwert vergleichen; nach DTLS-Verbindung `pc.sctp.transport.getRemoteCertificates()` prüfen und SHA-256 des ersten DER-Zertifikats mit diesem Wert vergleichen. Fehlende Zertifikate, andere Schlüssel oder Fingerprintabweichungen schließen die Verbindung. Beide Seiten tauschen signierte `pair-confirm`-Nachrichten mit Transcript-Hash aus; lokale menschliche Bestätigung und Gegenbestätigung müssen vorhanden sein. Fingerprints sind Zertifikathashes, nicht SDP-Hashes. [RFC 8122](https://www.rfc-editor.org/rfc/rfc8122.html#section-5), [W3C RTCDtlsTransport](https://www.w3.org/TR/webrtc/#rtcdtlstransport-interface).

Der Owner signiert anschließend einen Grant über Session, Dokument, `permissionEpoch`, `peerKeyHash`, Rolle und erlaubte Actor-Scope-IDs. Ownerrechte bleiben lokal und können nicht angefragt werden. Viewer erhalten Snapshot/Commitdaten, aber weder Dispatch noch Undo/Redo. Editor erhalten diese Schreiboperationen nur für ihre gebundenen Actors. Der Owner kann nicht via fremde Peer-Actor impersoniert werden.

Der menschliche Peer-Actor lautet `peer:<64-hex-keyhash>:human`. Agenten auf diesem Peer bekommen nach Registrierung einen separaten Owner-zugewiesenen Actor `peer:<64-hex-keyhash>:agent:<16-hex-scope>`. Damit bleiben alle Actors unter dem Domainlimit 128 und in dessen Zeichenvorrat. Höchstens ein Human- und sieben Agent-Scopes pro Peer. Der Owner prüft jedes Mal Peer-Key, erlaubten Scope, aktuelle Rolle und Epoche. Lokale MCP-Freigabe und Peer-Editorrolle müssen beide Schreibrecht gewähren; die schwächere Freigabe gewinnt. Ohne eingerichtete Scope-/Grant-Brücke werden Guest-MCP-Writes ausdrücklich mit `ACCESS_DENIED` beantwortet. Ein Gast darf nie direkt in seinen Mirror schreiben. Lokale MCP-Widerrufe sperren den zugehörigen Scope vor weiterer Übermittlung; alte bestätigte Agentenänderungen bleiben erhalten.

## 6. Vorschläge, Sequenz und Commitpunkt

Ein authentifizierter Vorschlag enthält vollständigen `PeerSessionKey`, `requestId`, monotonen `clientSequence` je Actor-Scope, `expectedRevision`, Owner-zugewiesene Scope-ID sowie die Aktion bzw. den Hash ihres übertragenen Payloads. Der Owner leitet `actorId` aus Kanal-/Schlüssel-/Scopebindung ab; eine zusätzliche behauptete Actor-ID wird höchstens auf Übereinstimmung geprüft. Peer-Dispatch wird als Domain-Quelle `peer` ausgeführt; menschliche/Agenten-Trennung bleibt im Actor-Namespace erhalten.

Der Gateway trennt einen stabilen Intent von seiner Verbindungshülle. Beim ersten Submit werden die Commanddaten abgetrennt, validiert und einmal als kompaktes UTF-8-JSON gespeichert; Wiederholungen verwenden exakt diese Bytes. Bei Dispatch ist `commandHash` ihr SHA-256, bei Undo/Redo `null`. Der Intentdigest ist SHA-256 über `UTF8('sketchdraw.intent.v1\n' + JSON.stringify([documentId, controllerEpoch, scopeId, requestId, expectedRevision, action.kind, commandHash]))`. Die feste Tuple-Reihenfolge verhindert Mehrdeutigkeit; IDs, sichere Zahlen und Aktionsart werden vorher geprüft. Auf dem Draht wird das Command als exakt dieser Text bzw. Transfer derselben Bytes transportiert. Gleiche ID mit anders serialisierten Commandbytes gilt als abweichende Wiederverwendung; deshalb hält der Gateway das Original bis zur Klärung. Channel-ID, Pairing-Nonce und Signatur sind ausschließlich Teil der aktuellen signierten Transporthülle. Ein Reconnect darf diese Hülle neu signieren, ohne Intentdigest, Request-ID oder Payload zu ändern. An den Gateway übergebene Objekte dürfen nach Einreihung keine Mutation durch den Aufrufer mehr erlauben.

`submit` reserviert `(Binding, requestId)` und die begrenzten Original-Intentbytes synchron vor dem ersten `await`, auch vor WebCrypto-Hashing. Eine identische Wiederholung teilt denselben Pending-Eintrag; abweichende Felder/Bytes werden schon gegen diesen Eintrag abgewiesen. Ein Timeout eines einzelnen Wartenden entfernt die Reservierung nicht. Größen-/Kapazitätsfehler vor Annahme liefern `accepted:false`; eine angenommene Reservierung endet genau einmal als lokaler Commit, No-Op oder terminale Ablehnung. So entsteht auch während asynchroner Vorbereitung kein zweiter Ausführungspfad.

Die Owner-Authority führt eine begrenzte FIFO über **alle** Schreibquellen. Nach Upload und Validierung eines Commands wartet es in derselben Queue wie lokale UI-/MCP-Aktionen. Der unmittelbare Commitpunkt ist der synchrone Controller-Aufruf nach den letzten Autorisierungs-/CAS-/Barrierprüfungen. Lokale Vorbereitungen wie Signaturprüfung oder Hashberechnung davor erteilen keine spätere Schreibberechtigung. Während einer synchronen Transaktion greift keine andere Mutation ein.

Bei Revision `r` gilt:

| Ausgang | Domäne | Protokoll/Ergebnis |
| --- | --- | --- |
| Änderung angenommen | genau `r + 1` | signierter Commit mit `previousRevision=r`, `revision=r+1`, vorherigem/nachherigem Zustandshash |
| Semantischer No-Op | unverändert `r`, keine History/Notification | signiertes `no-op`-Resultat; **kein** erfundener Commit, kein Mirror-Umschreiben |
| CAS/Validierung/Rolle/History abgelehnt | unverändert | terminales strukturiertes Resultat, Entwurf bleibt erhalten |
| Commit angewendet, Antwort/Signierung/Transport danach scheitert | lokale Änderung bleibt angewendet | kein Rollback; Request-Journal kennt den Commitpunkt, entfernter Aufrufer ggf. `outcome-unknown` |

Sessionbeginn setzt den bestehenden Domainstand nicht zurück: `baseRevision` ist die aktuelle Controllerrevision. Wire-Revisionen sind diese absoluten Revisionen; ein optionaler Commitzähler ist `revision - baseRevision`. Alle Werte sind sichere nichtnegative JavaScript-Ganzzahlen. Vor Überlauf wird eine neue Controller-/Peer-Session erforderlich, niemals Wraparound.

Der Owner speichert Intentdigest und Status vor dem Controller-Aufruf und setzt den lokalen Ausgang unmittelbar danach ohne Netzwerkwartezeit. Hash/Signatur/Broadcast dürfen den bereits angewendeten Commit nicht zurückrollen. Jeder Commit erfasst einen unveränderlichen Snapshot des exakten Ergebnisses; spätere asynchrone Hashberechnung darf keinen neueren Zustand unterschieben. Eine interne Serialisierungs-/Signaturstörung nach Commit stoppt weitere gemeinsame Writes, erhält den lokalen Stand und meldet die technische Störung. Die UI darf lokale Anwendung von ausstehender Peerzustellung unterscheiden.

Normale Dispatch-Commits übertragen das validierte Command und die Hashkette. Gäste berechnen den Folgezustand über `applyCommand`, prüfen Domaininvarianten, kanonische Größe und Hash und übernehmen ihn erst dann atomar. Undo/Redo werden **nur beim Owner** durch `controller.undo(boundActor)`/`redo(boundActor)` ausgeführt; Gäste rufen kein eigenes Undo auf. Da die Domain keine transportierbare inverse Operation liefert, enthält ein solcher Commit einen signierten Snapshot-Verweis auf das Ergebnis. Dessen Übernahme verlangt dieselbe nächste Revision und den richtigen Vorgängerhash. Kein freies „Snapshot-Replace“ vom Gast zum Owner.

History-Verfügbarkeit wird vom Owner separat für den jeweiligen Scope mit Revision bestätigt und bei Änderungen aktualisiert. Ein Gast zeigt sie erst für seinen aktuellen Mirrorstand als belastbar. Ein History-Konflikt überschreibt weder fremde Änderungen noch Teile einer Transaktion.

### Wire-Nachrichten und Rollenrichtung

Alle Kontrollnachrichten sind `SignedPayload`; ihr Payload enthält `version: 1`, `type`, `PeerSessionKey` und die aktuelle `connectionId` (Einladung-ID der bestätigten PeerConnection). Ein erlaubter Schlüssel allein macht ein Paket auf einer abgelösten Verbindung nicht gültig. Jede Nachrichtenart hat ein geschlossenes Schema; fehlende oder zusätzliche Felder sind Fehler.

| Typ | Richtung / zusätzliche Nutzdaten |
| --- | --- |
| `pair-confirm` | beide; Transcript-Hash; einzige Art vor Freigabe neben begrenztem Ping/Fehler |
| `grant` | Owner → Gast; Peer-Key, Rolle, erlaubte Scopes, Permission-Epoche |
| `register-agent-scope` / `actor-scope` | Gast → Owner / Antwort; lokale Grantreferenz ohne Capabilitygeheimnis / Owner-zugewiesene Scope-ID; Editorrolle erforderlich |
| `proposal` | Editor → Owner; Scope, Sequenz, Request-ID, Basisrevision, Aktion oder Command-Transferhash |
| `result` | Owner → Ursprung; Request-ID, Digest, terminaler Ausgang und Revision; kein Nachweis einer Dateispeicherung |
| `commit` | Owner → Gäste; Vorgänger-/Folgerevision und -hash, Actor/Request-ID, Command- oder Ergebnissnapshot-Verweis |
| `history` | Owner → jeweiliger Scope; Revision und dessen History-Verfügbarkeit |
| `query-outcome` / `outcome` | Gast → Owner / Antwort; Scope/Request-ID/Digest / pending, not-seen oder gespeicherter Ausgang |
| `resume` / `checkpoint` | Gast → Owner / Antwort; letzte Revision/Hash und Resync-Nonce / Snapshotmanifest und dieselbe Nonce |
| `transfer-manifest`, `transfer-ready`, `transfer-abort` | Richtung gemäß Zweck; Transfer-ID und geprüfte Metadaten; Viewer darf keine Commandtransfers eröffnen |
| `applied` | Gast → Owner; vollständig validierte Revision/Hash; erlaubt keine zusätzliche Mutation |
| `ping` / `pong` | beide; einmalige Nonce, maximal eine offene Anfrage; kein Dokumentinhalt |
| `session-ended` | Owner → Gäste; Grund und Generation; schließt gemeinsame Schreibrechte |

Ein neu beitretender Gast sendet nach Grant eine initiale `resume`-Anforderung ohne vorhandenen Stand, aber mit frischer Nonce. Der Owner beantwortet sie durch einen signierten Checkpoint. Nach einer normalen Commitlücke wird eine neue Nonce verlangt; ein altes Checkpoint-Paket ist keine allgemeine Erlaubnis zum Snapshotwechsel.

## 7. Begrenzte Übertragung großer Zustände

Ein Dokumenthash ist `SHA256(UTF8(serializeDocument(document)))` mit dem bestehenden deterministischen Domainformat. Dokumente einschließlich Assets müssen vollständig bis **32 MiB** übertragbar sein. Kleine DataChannel-Nachrichten sind daher ein Framinglimit, kein verstecktes Dokumentlimit. Snapshot/Command werden unkomprimiert übertragen; keine Dekompressionsbombe und keine entfernte URL für Assets.

Große Payloads erhalten einen signierten Manifest-Kontrollsatz: Transfer-ID, Zweck `snapshot | command`, Byteanzahl, SHA-256, Chunkgröße/-anzahl, Sessionbindung sowie Revision/Vorgängerhash bzw. Request-ID. Nach Prüfung und Kapazitätsreservierung antwortet der Empfänger `transfer-ready`. Erst dann kommen Binärchunks auf dem Bulkkanal. Das vermeidet eine unterstellte Reihenfolge zwischen zwei DataChannels.

Binärheader: vier Bytes Magic/Version `53 44 50 01`, 16 Bytes Transfer-ID, `uint32` Chunkindex, `uint32` Byteoffset, `uint32` Nutzlänge, jeweils Big Endian; insgesamt 32 Bytes. Die maximale **gesamte** Nachricht ist `min(16_384, pc.sctp.maxMessageSize)` Bytes; Nutzlänge entsprechend kleiner. Ein nicht verfügbarer/zu kleiner Wert führt zu `TRANSPORT_LIMIT_UNSUPPORTED`, nicht zum Senden eines übergroßen Blocks. Infinity bedeutet weiterhin das eigene 16-KiB-Limit. Kontrollnachrichten passen ebenfalls in dieses ausgehandelte Limit; mindestens 4.096 Bytes werden vorausgesetzt. Die 16-KiB-Politik verhindert unnötig große SCTP-Nachrichten; sie ersetzt keine Prüfung des tatsächlich ausgehandelten Maximums. [RFC 8831, Data Channels](https://www.rfc-editor.org/rfc/rfc8831.html#section-6.6), [RFC 8841, max-message-size](https://www.rfc-editor.org/rfc/rfc8841.html#section-6).

Der Empfänger reserviert nur nach geprüftem Manifest. Exakte Offsets, Anzahl, Länge, Transferbindung und Duplikate prüfen; überlappende/widersprüchliche Chunks, unerwartete IDs oder mehr Bytes als angekündigt schließen den Transfer. Identische Duplikate innerhalb eines Transfers werden einmal gezählt. Nach vollständigem Empfang zuerst Gesamthash, dann UTF-8-Decode mit `fatal: true`, dann JSON-/Domainvalidierung. Für Snapshots zusätzlich Dokument-ID, exakte kanonische Serialisierung und Revision prüfen. Erst danach Mirror atomar ersetzen und `applied` bestätigen. Vorher bleibt der letzte gültige Zustand sichtbar und ein Upload ist noch kein Commit.

Initialsync nimmt beim Owner einen konsistenten Snapshot bei `r`, während spätere Commits begrenzt gesammelt werden. Der Gast bestätigt `r`, bekommt anschließend die lückenlose Folge und wird erst bei erfolgreichem Catch-up `ready`. Bei fehlender Logstrecke beginnt er mit einem neueren signierten Snapshot erneut. Höchstens zwei automatische Resyncversuche pro Verbindung; danach sichtbarer `RESYNC_REQUIRED`. Ein langsamer Peer blockiert niemals die gesamte lokale Bearbeitung.

| Ressource | Anfangslimit / Verhalten |
| --- | --- |
| Aktive Gäste | 4 je Owner; 2 zusätzliche Pairings, kein unbeschränkter PC-Pool |
| Snapshotbytes | 32 MiB, identisch mit Domainlimit |
| Command-Payload | 40 MiB einschließlich Commandhülle; Ergebnisdokument weiter höchstens 32 MiB |
| Transfer-Chunks | maximal 65.536; tatsächliche Zahl wird aus Byte-/Chunkgröße exakt geprüft |
| Gleichzeitige Transfers | 1 inbound + 1 outbound je Peer; global höchstens 2 inbound; andere `BUSY` |
| Rohdatenreservierung inbound | global höchstens 80 MiB; bei Reservierungsfehler nichts anwenden |
| Pending Writes | je Actor 1 übermittelt; lokal maximal 32; Owner global 64 und 40 MiB wartende Payloads |
| DataChannel-Sendepuffer | zusammen höchstens 1 MiB je Peer; ab 256 KiB Rest wieder produzieren; bei Close/Error Warten abbrechen |
| Commit-/Blobretention | höchstens 256 Commits oder 64 MiB, gemeinsame referenzierte Bytes einmal zählen |
| Request-Ergebnisjournal | höchstens 1.024 Einträge oder 4 MiB, keine vollständigen Dokumente darin |
| Frameprüfung | Grenzen vor Parse/Decode; Kontrollschemas Tiefe 16, Strings je Feld begrenzt; Domainpayload mit Domainlimits |

Die Bytebudgets beziehen sich auf gehaltene Wire-Payloads, nicht auf eine garantierte Gesamt-RAM-Obergrenze. JS-Strings, Parser, Domainclones und History benötigen zusätzlichen Speicher; das muss mit großen echten Dokumenten gemessen werden. Pufferfüllstand wird vor **jedem** Senden geprüft; `bufferedamountlow` ist ein Wakeup, keine Lieferbestätigung. [W3C RTCDataChannel](https://www.w3.org/TR/webrtc/#dom-rtcdatachannel-bufferedamount).

## 8. Idempotenz, Wiederverbindung und unklarer Ausgang

Jeder Actor-Scope hat eine vom Owner zugewiesene zufällige 128-Bit-`scopeId` und eine monotone `clientSequence`, beginnend bei 1. Die Wire-/Gateway-`requestId` ist exakt `<32-hex-scopeId>:<kanonische-dezimale-clientSequence>`; andere IDs werden abgewiesen. Damit kann dieselbe ID auch nach Cacheverdrängung nicht mit einer neuen Sequenz wiederverwendet werden. `nextRequestId()` liefert den nächsten noch nicht angenommenen Slot und bleibt bis dessen Annahme unverändert; bei ungeklärtem Vorgänger liefert es `null`. Noch nicht übermittelte UI-Aktionen bleiben begrenzte Entwürfe, statt Sequenzlücken durch vorzeitige ID-Reservierungen zu erzeugen. Ein MCP-Adapter bildet seine externe Client-ID über sein eigenes Grant-Journal stabil auf diese Gateway-ID ab. Der Owner speichert dauerhaft für die **lebende Session** den höchsten angenommenen Wert je Scope; höchstens 40 Peer-Scopes bei den obigen Grenzen einschließlich reservierter Erweiterung. Das große Ergebnisjournal darf ältere Resultate verlieren, dieser kleine High-Water-Mark nicht. Wiederverwendung nach Neustart ist ausgeschlossen: neuer Ownerprozess/Controller bedeutet neue Session.

- Gleiche Sequenz/Request-ID und gleicher Intentdigest mit vorhandenem Ergebnis: dieselbe Antwort, keine zweite Ausführung.
- Gleiche ID/Sequenz, anderer Digest: `REQUEST_ID_REUSED`, keine Mutation; Verbindung bei wiederholtem Verstoß schließen.
- Sequenz kleiner/gleich High-Water-Mark, Ergebnis bereits verworfen: `outcome-unknown`, **nie erneut ausführen**. CAS allein ist kein Ersatz für dieses Journal.
- Sequenz größer als der nächste erlaubte Wert: `SEQUENCE_GAP`; keine Ausführung. Neue Operationen warten, bis der vorherige Ausgang geklärt ist.
- `BUSY` vor Annahme verbraucht keine Sequenz und nennt `accepted:false`. Nach registrierter Annahme werden auch fachliche Ablehnungen als terminale Ergebnisse gespeichert und die Sequenz verbraucht.
- Ein `query-outcome` prüft zuerst aktuelle Rechte, Session und Scope. Registrierte, noch nicht terminale Intents liefern `pending`; nach der Antwortdeadline wird beim Aufrufer daraus `outcome-unknown`. `not-seen` bedeutet nur, dass dieser Intent bislang nicht registriert wurde; eine Wiederholung verwendet identische ID, Sequenz und Payload. Eine noch unterwegs befindliche erste Kopie bleibt damit deduplizierbar.

Deadline vor Übermittlung: `REQUEST_TIMEOUT`/`NOT_CONNECTED`, sofern sicher kein Vorschlag abgeschickt wurde. Nach Übermittlung ist fehlende Antwort `outcome-unknown`, kein nachgewiesener Fehler. Erneute Übermittlung unter neuer ID ist dann verboten. Die UI behält den Entwurf mit Request-ID, Basisrevision und Digest, zeigt „Ausgang noch unklar“ und bietet Statusabfrage/erneute Verbindung oder eine ausdrücklich getrennte lokale Kopie an.

Reconnect innerhalb derselben lebenden Session verlangt neue PeerConnection, neue Einladung und neue DTLS-Bindung; der Peer beweist denselben Session-Key. Rollen/Scopes werden aus der aktuellen Owner-Tabelle gelesen, nicht aus einem mitgebrachten alten Grant. Anschließend Request-Ausgänge klären und `resume { lastRevision, lastHash }` senden. Stimmt die gespeicherte Kette, fehlende Commits nachliefern; sonst signierten aktuellen Snapshot übertragen. Kein Zustandsübernehmen bei falschem Hash, falscher Owneridentität oder fehlender Session. Ein Snapshot darf eine bestätigte Revision nie zurücksetzen; gleicher Revision mit anderem Hash folgt ein Protokollfehler. Revisionssprünge sind nur als Antwort auf eine eigene ausstehende Resync-Anforderung mit passender einmaliger Nonce erlaubt. Alte Verbindungen dürfen nach Ersetzung keine zweite schreibende Verbindung desselben Peers bleiben.

| Deadline | Bedeutung |
| --- | --- |
| ICE Gathering 20 s | kein vollständiges Paket: abbrechen, neue Einladung |
| Pairing 5 min | einmalige Einladung verfallen; lokal beim Owner gemessen |
| Transportaufbau 30 s nach Remote Description | sichtbarer Verbindungsfehler; keine ICE-Dienstergänzung |
| Fingerprintbestätigung 2 min | ohne Bestätigung Verbindung schließen, kein Dokument freigeben |
| Inaktiver Transfer 15 s / Gesamtdauer 120 s | abbrechen, Reservierung freigeben; alter Mirror bleibt |
| Outcome-Wartezeit 15 s nach übermitteltem Vorschlag | ggf. `outcome-unknown`; kein automatischer zweiter Commit |
| Heartbeat 5 s / keine Antwort 15 s | `disconnected`, keine neuen gemeinsamen Writes; Timer-Suspend kann Fehlalarm erzeugen, deshalb kein Eigentümerwechsel |

## 9. Öffnen, Widerruf und Ownerverlust

Öffnen/Neuanlegen eines Dokuments, Renderer-/Owner-Neustart, bestätigter Controllerwechsel und vollständiger Freigabewiderruf beenden die Peer-Session. Alte Einladungen, Grants, Transfers und wartende Requests werden ungültig. Eine neue Freigabe erhält neue `controllerEpoch` bzw. `sessionId` und neue Permission-Epoche; gleiche Dokument-ID ist kein Wiederaufnahmebeweis.

Konservative v1-Policy zur Freigabe: **Ein Peer-Widerruf oder eine Rollensenkung beendet die ganze aktuelle Peer-Session**. Verbleibende Teilnehmer können anschließend mit neuen Einladungen freigegeben werden; es wird nicht stillschweigend ein altes Grant in eine neue Generation übernommen. Root hat diese v1-Regel am 17.10.2026 bestätigt. Die Oberfläche kündigt vor Widerruf/Herabstufung klar an, dass alle Teilnehmer getrennt werden und verbleibende Teilnehmer neu eingeladen werden müssen. Rollenwechsel ohne vollständige Trennung erfordern später ein eigenes atomar getestetes Epoch-/Rekey-Protokoll. Eine neue Einladung für einen zusätzlichen Peer ohne bestehende Rechte zu senken braucht keinen globalen Neustart.

Ownerverlust friert den Gastmirror beim letzten bestätigten Stand ein. Bereits empfangene Daten bleiben les-/exportierbar, lokale Entwürfe bleiben erhalten. Kein Guest-Writethrough, keine Übernahme der Ownerrolle, kein Zurücksetzen der Revision auf 0. „Lokal weiterarbeiten“ trennt sichtbar von der Session und erzeugt einen lokalen Controller; bei späterem Ownerkontakt wird diese Kopie nicht automatisch darübergeschrieben oder zurückgemischt. Der alte ausstehende Ausgang bleibt nachvollziehbar.

Nach einem Widerruf darf eine App bereits empfangene Kopien weder als gelöscht noch als zurückgeholt ausgeben. Kryptografie schützt Transport und geprüfte Identität; sie verhindert nicht, dass berechtigte Teilnehmer zuvor gelesene Inhalte kopieren. Ein bösartiger Owner ist keine vertrauenswürdige Konsensinstanz: Gäste können Struktur/Hashes prüfen, aber keine gutartige Absicht des Owners beweisen.

## 10. Konkrete Renderer-Anbindung

`src/renderer/state/contract.ts` enthält heute `WhiteboardState.document/revision`, getrennte `displayElements`, `draftElement`, `textEdit`, `gestureConflict`, `history`, `file` und lokale Viewport-/Auswahlwerte. `WhiteboardStore` bietet überwiegend synchrone Mutationsmethoden, `commitTextEdit(): boolean` und `undo()/redo(): void`. Diese Signaturen sind nicht selbst ein Nachweis, dass ein Remote-Write schon bestätigt ist.

Abgleich mit Claude vor Implementierung:

| Bestehender Punkt | Erforderliche Integration |
| --- | --- |
| Store-Erzeugung / Controllerbesitz | `source + gebundener gateway + lifecycleGate` injizieren; Owner behält private Authority, Gast nur Mirrorquelle |
| `pointerUp`, `endNudge`, Eigenschaften, Gruppen, Löschen, Titel | lokales Intent bilden und asynchron submitten; Komponenten dürfen Ereignismethoden `void` behalten, Erfolg kommt aus Storestatus/Outcome |
| `commitTextEdit(): boolean` | Boolean bedeutet höchstens „lokal akzeptiert/Composition beendet“, niemals Remote-Commit; ergänzen `pendingTextCommit`/Outcome und Draftretention bis Bestätigung |
| `undo` / `redo` | denselben Gateway verwenden; im Guestmodus ownerbestätigte History und CAS, keine lokale Historyreplikation |
| Canvas-/Code-/Importentwürfe | Basisrevision und Draftgeneration erhalten; bei Konflikt keine automatische neue ID/Revision; explizites Wiederanwenden mit neuen Guards |
| `document/revision` | nur bestätigte Source-Snapshots; keine optimistisch in die kanonische Liste geschriebenen Elemente; Vorschauen separat |
| `file`, `saveStatus` | Peer-Commit ist keine Dateispeicherung. Guest-Speicherung exportiert eine lokale Kopie; Owner-Dateihandle bleibt ausschließlich beim Owner |
| `newDocument`, `openDocument`, `resolveDialog`, Close | Lifecycle-Barrier/Token/Revisions-/Draftgeneration-Prüfung integrieren; Session vor tatsächlichem Controllerwechsel beenden |
| Native Menu / Shortcuts / MCP | ein gemeinsamer Mutationspfad; Fokus entscheidet weiterhin zwischen nativem Texteingabe-Undo und Dokument-Undo |
| UI-Zustand | `collaboration`, `pendingWrites`, `unresolvedOutcomes`, `canWrite`, `connectionNotice`; Viewer sperrt Bearbeitung, Owner erzwingt Rechte unabhängig davon |

Der Beitreten-Dialog überschreibt kein ungespeichertes lokales Dokument: vorher dieselbe Save/Discard/Cancel-Prüfung wie beim Öffnen. Einladung erstellen, Paket kopieren/importieren, Vergleichscode bestätigen, Rolle und Verbindung ansehen sowie Verlassen/Widerrufen sind getrennte erkennbare Schritte. Kein Dokumenttitel/-inhalt vor Fingerprintbestätigung. Fehlendes Internet-Pairing bekommt eine verständliche Meldung „Direkte Verbindung nicht möglich“ mit Netzwerklimit, keine endlose Ladeanzeige.

## 11. Abnahmematrix

Alle Nachweise sind **geplant**, nicht ausgeführt. Unit-Tests für Protokoll/Queue ergänzen reale Browser-/Electron-Clients; ein Mock-DataChannel allein erfüllt die Integration nicht.

| ID | Reale Zwei-Client-Prüfung / erwartetes Ergebnis |
| --- | --- |
| P2P-01 | Zwei getrennte App-/Browserkontexte, Offer/Answer manuell durch Testdriver übertragen; tatsächliche WebRTC-DataChannels, ICE-Konfiguration leer, kein Signalingrequest; beide identischer bestätigter Hash |
| P2P-02 | Owner zeichnet, Gast editiert, Owner-MCP ändert dasselbe Dokument; beide Mirrors folgen derselben Revision, Mensch kann Ergebnis bearbeiten |
| P2P-03 | Beide senden auf derselben Basisrevision: exakt ein Commit, ein Konflikt; unterlegener Entwurf unverändert vorhanden |
| P2P-04 | Viewer sendet trotz manipuliertem UI Dispatch/Undo/Redo; Owner lehnt ab. Gast versucht fremden Actor/Scope/Ownerrolle: unveränderter Zustand |
| P2P-05 | Guest-Human-Undo erhält Guest-Agent-/Owneränderungen; Änderung desselben betroffenen Felds erzeugt History-Konflikt. Stale Undo-Basis wird vor Domainaufruf abgewiesen |
| P2P-06 | Wiederholung derselben Request-ID/Sequenz, veränderte Payload, No-Op, verlorene Antwort und Journalverdrängung: keine Doppelmutation, keine neue Revision bei No-Op |
| P2P-07 | Verbindung nach Commit, vor Resultat unterbrechen; `outcome-unknown`, dann Reconnect mit derselben lebenden Session und erfolgreiche Statusklärung ohne zweite Mutation |
| P2P-08 | Dokument nahe 32 MiB einschließlich zulässiger Assets; mehrere Tausend Chunks, kontrollierter Rückstau, Hashgleichheit; 32 MiB + 1 abweisen, ohne alten Mirror zu verlieren |
| P2P-09 | Falscher Chunkhash/Offset, Duplikat mit anderen Bytes, falsche Session, unvollständiger Transfer, ungültige Dokumentreferenz: kein partieller Mirrorcommit, Reservierung anschließend frei |
| P2P-10 | Reconnect mit lückenhafter Retention: Snapshot + Catch-up, vorhandener Text-/Codeentwurf bleibt unverändert. Falscher Ausgangshash führt zur Resynchronisation |
| P2P-11 | Fingerprint-/Transcriptabweichung, andere Signatur, abgelaufene/erneut verwendete Einladung: kein Dokumentbyte freigeben |
| P2P-12 | Ownerprozess beenden: Gast bleibt lesbar, Entwürfe erhalten, neue Writes gesperrt, lokale Kopie möglich, kein automatischer neuer Owner |
| P2P-13 | Widerruf/Rollensenkung während Queue/Upload; verspätete Frames und alte Einladung ändern die neue Session nicht. Lokales und Main-initiiertes MCP-Revoke werden am selben Commitpunkt geprüft |
| P2P-14 | Owner: Close-/Open-Barrier gegen Peer-/MCP-Write und Saveantwort verschachteln; kein später Commit nach geprüftem Stand. Gast: Mirror während Save einfrieren, unbekannten Write sichtbar halten, eingehende Commits begrenzen; Cancel löst nur eigenes Token und holt gültigen Stand nach |
| P2P-15 | Nicht erreichbare direkte Verbindung/Firewall und ausgesetzter Timer: begrenzter sichtbarer Fehler, kein STUN-/TURN-/Relay-Fallback, kein falscher Commitstatus |
| P2P-16 | Zweite Verbindung mit gleicher Peeridentität, mehr als erlaubte Peers/Queues/Bytes und Requestflut: Grenzen werden durchgesetzt; laufende Owner-UI bleibt kontrollierbar |

Zwei Prozesse auf demselben Rechner belegen den Protokollpfad, keine netzübergreifende Erreichbarkeit. Zusätzlich zwei echte Rechner im LAN sowie jeweils verfügbare Windows-/Linux-/macOS-Kombinationen prüfen. Browserabnahme verwendet reale `RTCPeerConnection`, getrennte Kontexte und automatisiert nur das manuelle Kopieren/Bestätigen. Netzwerkbelege müssen auch ICE-Verkehr/ausgewählte Kandidaten prüfen; eine Fetch-Spy allein beweist nicht das Fehlen eines STUN-Diensts. Host-/peer-reflexive Pfade zulässig, Relaypfade nicht. Keine unbewiesene „funktioniert überall“-Aussage.

## 12. Offene Entscheidungen und Grenzen für die Rootfreigabe

| Bedenken | Entscheidungsvorschlag / verbleibender Nachweis |
| --- | --- |
| P2P-C01: Sync-Store und bereits laufende Claude-Arbeit | Gateway-/Barrier-Typen mit MCP und Claude abstimmen, danach einmalige Storeanpassung; Domain synchron lassen. Aktuelle Synchronsignaturen nicht mit erfundenen sofortigen Remoteergebnissen bedienen |
| P2P-C02: Fingerprint-/mDNS-Unterstützung in Electron | `getRemoteCertificates`, sichere WebCrypto-Kontexte und ICE ohne Server auf der tatsächlich installierten Electron-/Chromium-Version prüfen; fehlende Fähigkeit erklärt ablehnen, keine Sicherheitsflags abschalten |
| P2P-C03: Große Dokumente / History | Rohdatenlimits sind fest, Spitzen-RAM und UI-Latenz aus Domainclones/History noch messen. Snapshot für Undo/Redo ist korrekt, aber bei 32-MiB-Dokumenten teuer; kein unbelegtes Deltaformat erfinden |
| P2P-C04: Globaler Neustart bei Einzelwiderruf | Von Root am 17.10.2026 für v1 bestätigt; UI muss die Trennung aller Teilnehmer vor der Entscheidung erklären. Tests für Widerruf und Rollensenkung bleiben offen |
| P2P-C05: Sessionidentität nicht dauerhaft | Keine Wiederaufnahme nach Owner-/Rendererprozessverlust; bestätigte Dateien bleiben, In-Memory-History/Grants nicht. Persistente Schlüssel/Wiederaufnahme sind eigene spätere Verträge, keine implizite Installation im Betriebssystem-Schlüsselbund |
| P2P-C06: Unabhängiger Fingerprintvergleich | Gleicher unbestätigter Nachrichtenweg für Pakete und bloßes „passt schon“ beweist keine Gegenidentität. UI muss vollständigen Vergleich ermöglichen; Produkttexte nicht mit einem kurzen Code absolute Sicherheit versprechen |
| P2P-C07: Noch nicht implementierte Guest-MCP-Brücke | Peergebundene Human-/Agent-Scopes sind spezifiziert; bis beide Grants und Gateway integriert sind, Guest-MCP-Writes explizit verweigern. Das ist eine offen geführte Integrationslücke, keine fertige Agent-Kollaboration |
| P2P-C08: Strikte Formulierung ohne STUN | Root bestätigt am 17.10.2026: keine zentralen STUN-/TURN-Dienste; direkte ICE-Protokollpakete sind zulässig. Netzwerkabnahme muss diese tatsächliche Grenze prüfen |

Die API-Skizzen, Grenzwerte und UX-Entscheidungen dieses Dokuments sind eigene Architekturvorschläge. Die verlinkten Primärquellen belegen WebRTC-/Kryptografieeigenschaften, nicht die Sicherheit oder erfolgreiche Implementierung dieses Sketchdraw-Protokolls.
