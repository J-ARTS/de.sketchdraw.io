# Unabhängige Prüfung der P2P- und Sessionverträge

Stand: 17.10.2026. Issues [#6](https://github.com/J-ARTS/de.sketchdraw.io/issues/6), [#14](https://github.com/J-ARTS/de.sketchdraw.io/issues/14). Reviewer: interner **Codex**-Subagent `domain_review`; kein Claude-Code-/Antigravity-Beitrag.

Geprüft: [P2P-Vertrag](../contracts-p2p.md), [MCP-Vertrag einschließlich beschlossener Ergänzungen](../contracts-mcp.md), [Codex-MCP-Review MC-01–MC-06](codex-mcp-contract-review.md), [ADR 0002](../decisions/0002-direct-peer-session-order.md) und die vorhandenen öffentlichen Domain-APIs in `src/domain/types.ts`/`controller.ts`. Graphify wurde vor der gezielten Dateiprüfung abgefragt; maßgeblich waren die aktuellen Dateien.

**Ergebnis:** Die gemeinsame Sessionautorität ist mit dem synchronen Controller und den beschlossenen MCP-Regeln vereinbar. Ein konkreter Lifecycle-Anschluss muss vor ihrer Peer-Integration ergänzt werden. Keine weiteren blockierenden Widersprüche im begrenzten Prüfumfang gefunden. Das ist eine Architekturprüfung, kein bestandener Netzwerk-, Kryptografie-, Plattform- oder Produktlauf.

## PP-01 — P2: Peer-Journale lassen sich nach Sessionende über die öffentliche Authority-API nicht freigeben

**Stellen im geprüften Stand:** `docs/contracts-p2p.md:117–160` (Binding-/Authority-API), `:167` (Retention und Grenzen), `:173` (dieselbe Authority nach Peer-Widerruf), `:375` (High-Water-Marks), `:400–402` (Ende der ganzen Peer-Session).

Die Authority verwaltet Peer-Scopes und ihre Deduplizierung. Alte Journale dürfen erst nach unwiderruflichem Ende der **gesamten Peer-Session** entfallen. `ActorBindingOptions` enthält aber keine Peer-Session-Zuordnung, und `DocumentAuthority` bietet nur `revokeBinding(bindingId)`, keinen Abschlussaufruf für die Retentiongruppe. Der Collaborationadapter soll ohne Importzyklus aus `src/session` importieren; die Authority kann daher das Schließen einer Collaboration-Session nicht selbst beobachten.

**Konkretes Gegenbeispiel:** Vier Gäste verwenden jeweils ihren Human- und sieben Agent-Scopes: 32 Peer-Bindings. Ein ausdrücklich bestätigter Peer-Widerruf beendet gemäß v1 die ganze Peer-Session; der lokale Controller und lokale MCP-Freigaben sollen bestehen bleiben. Danach werden vier neue Gäste mit denselben acht Scopes eingeladen. Behält die Authority die alten Journale, erreicht sie das 40-Peer-Scope-Limit bereits nach acht neuen Bindings. Löscht sie die Journale schon bei jedem individuellen `revokeBinding`, fehlt der vertraglich verlangte Nachweis des Gesamtendes. Einen neuen Controller nur zur Speicherfreigabe zu erzeugen würde zusätzlich lokale History/Grants unnötig unterbrechen.

### Kleinste vorgeschlagene Ergänzung

Nur eine Zuordnung am bestehenden Binding und ein vertrauenswürdiger Abschlussaufruf; kein neuer Controller, keine neue Wire-Nachricht und kein zusätzlicher Produktmodus:

```ts
export interface ActorBindingOptions {
  // Existing fields remain unchanged.
  peerSessionId?: string;
  // Required exactly when source === 'peer'.
  // The active OwnerSession's sessionId, supplied by trusted composition.
}

export interface DocumentAuthority {
  // Existing members remain unchanged.
  finalizePeerSession(peerSessionId: string): void;
}
```

Vorgeschlagene verbindliche Semantik:

1. `peerSessionId` wird bei `bindActor` validiert und unveränderlich intern gebunden. Für `source: 'peer'` ist sie erforderlich, für lokale Human-/Code-/Import-/Agent-Bindings verboten. Der Collaborationadapter übergibt seine bestätigte Owner-Session-ID; das Feld kommt nicht aus einem freien Peer-Intent.
2. Der Collaborationadapter beendet vor `finalizePeerSession` die gesamte zugehörige Peer-Session unwiderruflich: keine neuen Einladungen oder Scopes dieser Session, keine neuen gültigen Kanal-/Grantbindungen, alle betroffenen Bindings synchron widerrufen. Erst dieser vertrauenswürdige Aufruf bestätigt der Authority die erlaubte Retentionsfreigabe. Er ist keine Methode auf einem Gateway und wird nicht über IPC/MCP/Peer-Payloads zugänglich gemacht.
3. Die Authority akzeptiert den Abschluss nur, wenn **alle** zur Gruppe gehörenden Bindings bereits widerrufen sind und keine noch nicht lokal abgeschlossene Queue-/Commitarbeit dieser Gruppe existiert. Andernfalls `SessionAccessError('BUSY')`; keine Teilfreigabe. Das Warten hängt nicht von entfernten ACKs ab. Bereits lokale terminale Ergebnisse dürfen nach dem unwiderruflichen Sessionende freigegeben werden.
4. Erfolgreicher Abschluss entfernt ausschließlich zugehörige Journale, Originalpayloads und High-Water-Marks aus den Retentions-/Bindingbudgets. Lokale Bindings, lokale MCP-Grant-Journale, Controllerrevision, Dokument und Domain-History bleiben unverändert. Ein wiederholter Abschluss derselben bereits abgeschlossenen Gruppe ist wirkungslos.
5. Alte Gateway-/Sourceobjekte bleiben unabhängig von gelöschten Journaldaten dauerhaft gesperrt. Fehlende Journal-/Bindingeinträge sind keine Erlaubnis zur Neuregistrierung. Eine spät fertig werdende Hash-/Signaturvorbereitung darf weder den Scope neu erzeugen noch committen. Eine neue Peer-Session erhält neue Session-/Scope-IDs; ein alter Request wird nicht in deren Namespace übernommen.

Dies ergänzt ausschließlich die im Vertrag bereits beschlossene Retentionsgrenze. Die ganzen Peer-Sessions weiterhin bei Einzelwiderruf zu beenden ist eine bereits getroffene v1-Entscheidung und wird durch dieses Review nicht erneut infrage gestellt.

**Erforderlicher Nachweis nach Implementierung:**

- 32 Peer-Scopes plus lokale Human-/MCP-Bindings anlegen; gesamte Peer-Session widerrufen/finalisieren; erneut 32 Peer-Scopes auf derselben Authority anlegen. Kein künstliches `BUSY` durch die alten Journale.
- Abschluss bei noch aktivem Binding verweigern, ohne Journale teilweise zu löschen. Abschluss während noch nicht lokal geklärter Arbeit verweigern oder diese zuvor nach dem bestehenden Widerrufsvertrag terminalisieren.
- Nach Abschluss alte Gatewayobjekte, Sources, Request-IDs und verzögert fertige Vorbereitungen verwenden: keine neuen Dokumentdaten und keine Mutation.
- Lokale MCP-Bindings behalten ihre Freigabe; Dokumentrevision und vorhandene lokale History bleiben erhalten. Eine Sessionfinalisierung ist selbst keine Dokumentmutation.

## Bestätigte Konsistenzpunkte

- **Ein Commitweg:** Der bestehende Controller kann exklusiv übernommen werden. `dispatch` bleibt synchron; unmittelbar davor kann die Authority ihre Grant-/Session-/CAS-Prüfungen ausführen. Das nachträgliche Signieren benutzt den erfassten Ergebnissnapshot. Ein verlorener Antwortpfad wird nicht als Rollback ausgegeben.
- **Undo/Redo:** Die vorhandenen Domainmethoden besitzen keinen Revisionsparameter. Die ausdrücklich synchrone Gateway-CAS-Prüfung unmittelbar vor ihnen schließt diese Lücke, ohne eine Domain-API-Änderung zu benötigen. Gastmirrors führen kein konkurrierendes lokales Undo aus.
- **MCP und Lifecycle:** Die angenommenen MC-01–MC-04-Regeln sind übernommen: lokale Sperre vor asynchronem Widerruf, Barrier bis zum tatsächlichen Schließen, neue Epoche bei jeder Controller-Neuerzeugung und Pending-Deduplizierung vor dem ersten `await`.
- **Getrennte Grenzen:** Ein Peer-Widerruf beendet nach beschlossener v1-Policy die Peer-Session; er verlangt weder einen neuen lokalen Controller noch das Verwerfen lokaler MCP-Grants. Genau deshalb braucht die Retentionsbereinigung die kleine explizite Grenze oben.

## Prüfumfang und Übergabe

Es wurden keine Produktdateien verändert, keine Tests der noch nicht vorhandenen Sessionimplementation ausgeführt und keine GitHub-/Graph-Schreiboperationen vorgenommen. Die Gegenbeispiele sind Ablaufprüfungen an den Verträgen, keine behaupteten Laufzeitreproduktionen. WebRTC-/Krypto-Grundannahmen wurden in diesem Auftrag nicht erneut unabhängig verifiziert; die bereits benannten echten Zwei-Client-/Plattformtests bleiben erforderlich.

Root entscheidet über PP-01 und übernimmt die freigegebene API in den Vertrag. Danach ist aus dieser gezielten Prüfung die begrenzte Implementierung von `src/session` freigabefähig; Guest-MCP-Anbindung und Rendererumstellung bleiben die bereits dokumentierten separaten Integrationsaufträge.
