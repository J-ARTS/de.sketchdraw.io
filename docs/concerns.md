# Architektur-Bedenkenregister

Issue [#6](https://github.com/J-ARTS/de.sketchdraw.io/issues/6). Einträge sind offene Fragen bzw. Entscheidungen, keine automatisch bewiesenen Fakten.

| ID | Quelle | Bedenken | Status / Entscheidung | Erforderliche Evidenz |
| --- | --- | --- | --- | --- |
| C-001 | Nutzer: Strict P2P | Ohne Signaling-/Relay-Infrastruktur ist allgemeine Internet-Erreichbarkeit nicht garantiert. | Vorgabe beibehalten; manuelles Pairing und klare Fehleranzeige. | Zwei direkte Peers und nicht erreichbarer Peer; Konfiguration ohne STUN/TURN. |
| C-002 | Codex Architekturentwurf / Antigravity AG-04 | Ungeprüfte CRDT-Updates können Rollen und Schema-Invarianten umgehen. | ADR 0002: validierte Commands, Owner-Peer als expliziter Sequencer; Laufzeitnachweise offen. | Viewer-Manipulation, ungültige Updates, Konflikt-/Reconnect-Tests. |
| C-003 | Codex Architekturentwurf | Zwei getrennte Dokumentzustände für Canvas/Code verursachen Datenverlust. | Ein kanonisches Modell; Textentwurf separat, revisionsgeprüfte Anwendung. | Bidirektionale Roundtrips und simultane Änderungen. |
| C-004 | Codex Architekturentwurf | Imports und SVG können aktive Inhalte oder Dekompressionslast tragen. | Parserlimits, Sanitizing und Verlustberichte erforderlich. | Bösartige/überdimensionierte XML/SVG-Fixtures. |
| C-005 | Codex Graphify-Agent | Ein Run mit mehreren Tickets darf im Gesamtaufwand nicht mehrfach gezählt werden. | Summen nach eindeutiger Run-ID; Zuordnung getrennt von Messung. | Graphadapter-Unit-Tests. |
| C-006 | Codex Graphify-Agent | Graphify-Code-Refresh kann manuell ergänzte Ticket-/Tool-Knoten verlieren. | Deterministischer Traceability-Merge nach Code-Refresh. | Rebuild und query/path nach Refresh. |
| C-007 | Laufzeitbeobachtung / offizielle Claude-Code-Dokumentation | Claude-Fenstersteuerung nicht freigegeben; CLI 2.1.185 ignoriert den neu dokumentierten Parameter `--effort ultracode`. | Ersten Lauf beendet. Fortsetzung mit expliziter Sitzungseinstellung `ultracode=true` und `xhigh`; tatsächlicher Workflow mit zwei Sonnet-5.5-Reviewern bereits nachgewiesen, vollständiger Bericht liegt vor. Die effektive interne Ultracode-Flag-Auswertung bleibt nicht separat beobachtbar; der echte Workflow und Sonnet-5.5-Reviewer sind belegt. | Runtime-Ereignisse und fertiger Bericht; weder Start noch ignorierter Parameter beweisen den vollständigen Modus. |
| C-008 | Codex Live-Research DR-C04 | SVG-Rendering allein bietet keine zugängliche Objektbearbeitung. | Claude Code ergänzt semantische Elementnavigation, benannte Werkzeuge, Tastatur- und klickbare Alternativen zum Ziehen. | UI-T04/T05/T15 aus `docs/design-research.md`; Screenreader-Prüfung separat. |
| C-009 | Codex Live-Research DR-C05 | Dauerhaft offene Panels verdrängen die freie Zeichenfläche; Schließen kann Codeentwürfe verlieren. | Optionale Panels; bei kleinen Fenstern ein aktiver Bereich, Entwurfszustand bleibt unabhängig erhalten. | UI-T01/T07/T14, Fokus und Entwurf bei Fenstergrößenwechsel prüfen. |
| C-010 | Codex Live-Research DR-C06 | Lokales Arbeiten wird mit bestätigter Speicherung verwechselt; Speicherfehler können verborgen bleiben. | Speicherstatus ausschließlich aus bestätigter Persistenz; Fehler und externe Dateikonflikte erhalten den lokalen Entwurf. | UI-T10, fehlgeschlagener Schreibvorgang und externe Änderung; DesktopBridge-Vertrag durch externe Reviewer prüfen. |

Research-Abgleich: DR-C01/DR-C02 vertiefen C-003 (verlustfreie Syntax und Entwurfsrevision), DR-C03 vertieft C-001 (eigener Pairing-Flow, keine allgemeine Link-Zusage), DR-C07 vertieft C-004 (Asset-Provenienz, sichere SVGs und konkreter Verlustbericht). Belege und UI-T01–T15: `docs/design-research.md`.

Die drei Graphadapter-Reviewbefunde aus #7 (Pfadkollisionen, parallele Beziehungen im einfachen Graphen, verwaiste Hyperedges) werden dort mit Regressionstests verfolgt. Die Modellierungsentscheidung ist konservativ: bei möglichem Fremddatenverlust abbrechen und keine Quelldatei überschreiben.

## Antigravity-Review und Entscheidungen

Quelle: `docs/reviews/antigravity-architecture.md`, echter Gemini-4-Argon-High-Lauf `antigravity-architecture-002`. Die Tabelle dokumentiert Codex-Entscheidungen, keine bereits bestandenen Produkttests. Verantwortung für Umsetzung: Antigravity; UI-Anbindung: Claude Code; Nachweisprüfung: Codex.

| Review-ID | Entscheidung / Begründung | Nachweis / Ticket |
| --- | --- | --- |
| AG-01 | Angenommen: JSON-taugliche Null-Löschung, feldweise Stile/Metadaten und feste Connector-Endpunkte in Vertrag v2. | JSON-Roundtrip, Teilstil und abgekoppelter Connector; #9. |
| AG-02 | Angenommen: Weltkoordinaten, Containerrotation 0, Nachfahren genau einmal mitverschieben; Resize skaliert Kinder nicht. | Verschachtelung, Reparenting, externe Connectoren; #9/#10. |
| AG-03 | Angenommen: opake Datei-Handles, Versionstoken, strukturierte Resultate, serialisiertes atomares Speichern. Kein absoluter atomarer CAS gegenüber beliebigen Fremdprozessen behauptet. | Fremdänderung, gleichzeitige Saves, Schreibfehler; #8. |
| AG-04 | Teilweise angenommen: validierte Commands mit Rollenprüfung. Bloße Lamport-Sortierung ist ohne Replay/Finalität kein Konvergenznachweis; für S4 wird ein expliziter Session-Owner als Sequencer vorgesehen, siehe ADR 0002. | Zwei Peers, stale Revision, Viewer-Angriff, Reihenfolge/Resync; #14. |
| AG-05 | Angenommen und präzisiert: Batch atomar, History pro Actor, inverser Eingriff mit Feld-/Abhängigkeitsprüfung. Auch ein inverses Command darf fremde Folgeänderungen nicht überschreiben. | Fremdes Element bleibt erhalten; gleiches Feld erzeugt History-Konflikt; #9. |
| AG-06 | Angenommen: Parser erhält Ressourcenkontext; Codeentwurf behält Basisrevision. Keine stillen Assetverluste oder automatische Anwendung eines alten Entwurfs. | Bilder/ComponentSets im Roundtrip, konkurrierender Entwurf; #11. |
| AG-07 | Angenommen: lokale Capability mit Dokument-/Rechteumfang, Pflicht-CAS, UDS/Named-Pipe als Ziel; Diagrammtexte bleiben untrusted Daten. | Ungültiges Token, Read-only-Schreibversuch, falsches Dokument, stale Revision; #13. |
| AG-08 | Pairing-Zustände, Ablauf und Diagnose angenommen. Vorgeschlagene pauschale 3-Sekunden-Teilantwort nicht übernommen: vollständige ICE-Sammlung oder expliziter Timeout/Neustart. Zeit-/Netzwerkbehauptungen aus dem Review benötigen eigene Messung. | Direkte Peers, abgelaufenes Paket, Gathering-Timeout, unerreichbar; #14. |
| AG-09 | Metadaten-Command angenommen. Automatisches Löschen aller unreferenzierten Assets bei gewöhnlichem Delete abgelehnt: History/Codeentwurf könnten Ressourcen benötigen. Zunächst Größenlimits; spätere explizite Kompaktierung mit Referenzprüfung. | Metadaten-Patches, Bild-Delete/Undo ohne Verlust; #9/#11. |
| AG-10 | Angenommen: gemeinsame Grenzwerte und strukturierte Fehler, konkretisiert in Vertrag v2. Nur MIME-Präfixprüfung reicht nicht: Base64, Bytesignatur und decodierte Größe mitprüfen. | Grenzwerte, Prototype Pollution, ungültige Assets/URLs; #9/#12. |

## Externe Beiträge

- Claude Code: UI/UX, Bedienkomplexität, Canvas/Text-Konflikte, Accessibility, Performance, Testbarkeit.
- Antigravity: erster Bericht eingegangen und oben entschieden; weitergehende Laufzeit-/Sicherheitsnachweise stehen aus.

Jeder externe Bericht erhält eine referenzierte Datei und wird in diese Tabelle eingearbeitet. Dissens darf als offen bestehen bleiben; Codex muss eine begründete Entscheidung und den passenden Validierungsschritt nennen.

## Entscheidungen zum Claude-Code-Review

Quelle: `docs/reviews/claude-architecture.md`, Run `claude-architecture-002`, zwei tatsächliche Sonnet-5.5-Reviewer. Die 14 deduplizierten Bedenken bezogen sich größtenteils auf v1. Folgende Entscheidungen sind in v2 enthalten; sie sind noch keine Laufzeitnachweise.

| ID | Entscheidung / Begründung | Nachweis und Ticket |
| --- | --- | --- |
| CL-01 | Controller-API, Batch, CAS und History gemeinsam fixiert. | Atomarität/Revisionen; #9/#15. |
| CL-02 | Weltkoordinaten statt vorgeschlagener relativer Kinderkoordinaten; dadurch eine gemeinsame Geometrie für Canvas/Agenten. Container verschiebt Nachfahren einmal, Connectoren materialisieren Anker. | Nested Container, Reparenting, Connector-Move/Delete; #9. |
| CL-03 | Per-Actor-History angenommen. Partielles Undo abgelehnt: vollständiger HISTORY_CONFLICT bei berührten Fremdänderungen, keine stillen Teiloperationen. | Fremde Adds erhalten, gleiches Feld blockiert; #9. |
| CL-04 | JSON-null-Löschung und Partial-Style/Metadaten-Merge angenommen. | Wire-Roundtrip/Teilstil; #9. |
| CL-05 | Delete entkoppelt Connectoren mit sichtbarem Fallback. Reorder bleibt vollständige Permutation plus CAS für S1. | Delete/Cascade/Order-Konflikte; #9/#10. |
| CL-06 | Datei-Handles/Versionen, strukturierte Save-Ergebnisse, Close-Handshake und Menükanal ergänzt. Browserdownload behauptet keine bestätigte Speicherung. | Externe Änderung, Save-Race, Draft-Close; #8/#10. |
| CL-07 | Ressourcenkontext, Draft-Basisrevision, Diagnose-Code/Bereich ergänzt. Domain-Exceptions und Parser-Resultate bewusst getrennt. | Code-Roundtrip/Fehlerbereich/stale Draft; #11. |
| CL-08 | Persistente label/description und semantische Objektliste angenommen. | Tastatur, Screenreader, Roundtrip; #10/#15. |
| CL-09 | Font-Tokens und gebündelte Fonts; explizite Textgeometrie statt modellverändernder DOM-Messung. Pfad-Resize verändert Punkte/Box atomar. | Fonts, Text-/Pfadgrößen, plattformübergreifende Prüfung; #10. |
| CL-10 | Zentraler Menü-/Shortcutpfad, natives Text-Undo, IME-Drafts und Canvas-Scope festgelegt. | Kein Doppel-Undo, Composition bleibt erhalten; #10. |
| CL-11 | Deterministische IDs in Tests, zeitfreie Domain, kanonisches JSON ohne Geometrierundung, feste Limits. | Bytegleicher Roundtrip, NoOp, Grenzen; #9/#15. |
| CL-12 | Screen-space-Ziele, numerische/klickbare Alternativen, Zoom10–400%. | Interaktion bei verschiedenen Zoomstufen; #10. |
| CL-13 | Kataloginstanziierung/Widgets vor S2 konkretisieren. Keine erfundenen vorläufigen Domain-Exporte in S1. | Catalog-Vertrag und Set-Roundtrip; #11. |
| CL-14 | Overlay-Panels ändern Viewport nicht; Untergrenze960×640; Umsetzung in prüfbaren Scheiben, Aufwandsschätzung begrenzt nicht Produktumfang. | Kleine Fenster, Fokus, externe Änderungen; #10. |

Claude trifft Gestaltung innerhalb dieser Verträge eigenständig (E-01–E-14 im Bericht). Component-Unterstützung im Modell ist S1, Katalogerstellung folgt in S2; die freien acht Whiteboard-Werkzeuge werden jetzt implementiert.

## Desktop-Implementierungsreview

Quelle: `docs/reviews/antigravity-desktop.md`, tatsächlicher Run `antigravity-desktop-001`; unabhängige Codex-Prüfung in `docs/reviews/codex-desktop-findings.md`.

| ID | Entscheidung / Stand | Nachweis und Ticket |
| --- | --- | --- |
| AG-D01 | Relative Imports im Desktop-Bereich vermeiden die beschriebene Alias-Abweichung bereits. Kein bestätigter aktueller Buildfehler; spätere Alias-Verwendung erfordert abgestimmte Buildkonfiguration. | Electron-Bundle und Electron-Typecheck auf macOS bestanden; #8. |
| AG-D02 | Sandbox-Grenze beibehalten. Im geprüften Preload-Bundle ist `electron` das einzige externe `require`; das ersetzt den ausstehenden echten Fensterstart nicht. | Statische Bundleprüfung bestanden; native Bridge-/Isolationsprüfung nach Renderer-Integration; #8/#15. |
| AG-D03 | Speichern und Schließen nur nach bestätigtem `saved` des aktuellen Zustands. Konflikt, Abbruch, Fehler oder bloßer Browserdownload dürfen keine Schließfreigabe auslösen. Änderungen während des Speicherns müssen ebenfalls erhalten bleiben. | Renderer-/Electron-Integrationstest erforderlich; #10/#15. |
| CD-01 | Custom-Scheme-URL mit explizitem Protokoll/Host/Port prüfen; `URL.origin` ergibt für `app:` allein keine belastbare Autorität. | Unabhängiger Regressionstest reproduzierte #17; nach Reparatur bestanden, siehe docs/reviews/desktop-validation.md. |
| CD-02 | Save-as und Export müssen auch eine ursprünglich fehlende Zieldatei gegen zwischenzeitliche Fremdänderung schützen. Die bekannte minimale OS-Restlücke bleibt separat benannt. | Zwei unabhängige Dateisystemfälle reproduzierten #22; nach Reparatur bestanden, siehe docs/reviews/desktop-validation.md. |
| CD-03 | Symlink-Aliase müssen dieselbe Schreibsperre und echte Zielidentität verwenden; erfolgreiche Speicherung darf einen Dateilink nicht unbemerkt durch eine andere Datei ersetzen. | Zwei unabhängige Dateisystemfälle reproduzierten #23; nach Reparatur bestanden, siehe docs/reviews/desktop-validation.md. |

Weitere bestätigte Domain-Befunde stehen in `docs/reviews/codex-domain-findings.md`: rotierte Connectoren (#18), Typwechsel in Undo (#19), Größenbudget vor Commit (#20) und sichere Revisionsgrenzen (#21). Die ursprünglichen 18 bestandenen Domain-Abnahmetests deckten diese Randfälle nicht ab; gesonderte Regressionstests prüfen die Reparaturen.


## MCP-Vertragsreview und Übernahme

Quelle: `docs/reviews/codex-mcp-contract-review.md`, unabhängiger Codex-Reviewer. Noch keine bestandenen MCP-Produkttests. Die folgenden Entscheidungen stehen im überarbeiteten `docs/contracts-mcp.md`.

| ID | Entscheidung | Pflichtnachweis |
| --- | --- | --- |
| MC-01 | Angenommen: lokale Grant-/Sessionprüfung synchron direkt vor Commit; Main-Widerruf erst nach Gate-Ack vollständig. Vorher linearisierte Commits nicht nachträglich als unverändert ausgeben. | Unterbrochener Write, Revoke/Downgrade, verlorene Antwort. |
| MC-02 | Angenommen: gemeinsamer WriteGateway und Lifecycle-Barrier für sämtliche Writer samt Revision/Draftgeneration und Close-Token. | Save/Close gegen Agent-/Peer- und menschliche Änderungen; Cancel entsperrt korrekt. |
| MC-03 | Angenommen: Pending-ID vor await reservieren, Fingerprint inklusive Operation/Revision, gleiche Requests zusammenführen. Max4096 IDs je Grant ohne unsichere Verdrängung; danach neue Freigabe. | Gleichzeitige gleiche/geänderte IDs, No-Op, Timeout vor/nach Commit. |
| MC-04 | Angenommen: jede neue Controller-Instanz erhält neue Epoche, auch dieselbe Dokumentdatei; Navigation/Crash invalidiert Main-Grants. | Gleiches Dokument und alte Capability/Revision nach erneutem Öffnen. |
| MC-05 | Named-Pipe-Ziel für Windows ersetzt durch ausschließlich numerischen127.0.0.1-Listener; Unix behält privaten UDS. Gegenseitige noncegebundene HMAC-Authentifizierung gibt Capability nicht an einen fremden wiederbelegten Port. Lokale Erreichbarkeit wird nicht als OS-Benutzerisolation ausgegeben. | Falsches Secret, fremder Endpoint, Listenerneustart, gebundene Adresse, Auth-/Bufferlimits; Windowslauf. |
| MC-06 | Gepackter Electron-Executable startet gebündelten dist-mcp/server.cjs mit explizitem Run-as-Node-Modus. EOF/Abbruch räumt begrenzt auf; SDK-Probeprozess widerruft keine Benutzerfreigabe. | Gepackter Adapter ohne Checkout/globales Node, Pfad mit Leerzeichen, echter Host und EOF. |

Die Domain-Reparaturen #18–#21 bestehen nun32 Tests inklusive ursprünglicher unabhängiger Regressionen (`docs/reviews/domain-validation.md`). Desktop #17/#22/#23 besteht32 Tests (`docs/reviews/desktop-validation.md`). UI-/Plattformintegration bleibt getrennt offen; keine Gesamtfreigabe allein aus diesen Ergebnissen.

## Integrationsentscheidungen vom 17.10.2026

| ID / Quelle | Entscheidung und aktueller Nachweis |
| --- | --- |
| PP-01, unabhängiger Codex-P2P-Vertragsreview | Peer-Bindings tragen eine Sessionzuordnung; explizite Finalisierung gibt deren Journale erst nach unwiderruflichem Sessionende frei. Gemeinsame Authority mit19 Tests geliefert; echte Peerabnahme separat. |
| AG-Release, echter Antigravity-Bericht | Drei definierte Installer, gebündelter MCP-Start und ehrliche Signingangaben aufgenommen. Keine Lizenz oder E-Mail erfunden. Metadaten verwenden die bestätigte Repositoryidentität. |
| Codex-Release-Review, fünf Befunde | Windows-Shell, fehlendes MCP-Bundle, fremde Drafts, fehlende echte Paketstarts und unbestätigte Remote-Digests korrigiert.21 Skripttests bestanden; positive native Installerprüfungen offen. |
| MCP-Lifecycle, Frontend-Codexreview | Beim Dokumentwechsel kann die alte Authority bereits geschlossen sein. Lokale Grants zuerst sperren; Listener/Secrets auch dann vollständig aufräumen. Neue Regression bestanden. |
| Frontend-Lifecycle, Codexreview | Fehlgeschlagene oder stale Close-Barriers antworten Main mit Cancel; leere Titelentwürfe blockieren Save statt still verloren zu gehen.58 Renderer-Unitfälle nach Korrektur bestanden. |
| CI/MCP, Rootreview | Unit-SDKtest benötigt das echte Adapterbundle. `test:unit` baut es selbst, damit ein sauberer Checkout keine lokalen Altartefakte voraussetzt. |

Die aktuelle MCP-Produktabnahme mit echtem SDK und sichtbarem Canvas steht in `docs/reviews/codex-mcp-integration.md`. Reguläre Zuständigkeiten bleiben erhalten; temporäre Codex-Übernahme wurde ausdrücklich vom Nutzer freigegeben. Auch die zusätzlich gewünschten echten Claude-Modelle über Antigravity erreichten Kontingentgrenzen. Die Grenzen werden als Runergebnis erfasst, nicht als abgeschlossene Implementierung.

## Native Integration und Fremdprogramm-Abnahme

- **P2P-Netzwerk, #14:** Der lokale macOS-Host erreicht keine ICE-Verbindung. Derselbe Stand f8c55fb besteht auf dem unveränderten Ubuntu-Runner beide echten Chromium-/Electron-Transporttests (Run 39041998555, Job 117423198082). Kein STUN/TURN/Relay und keine Abschwächung der Sandbox hinzugefügt. Der dritte Produkt-UI-Test fand eine Mehrdeutigkeit zwischen bestätigtem Element und beibehaltenem Entwurf; getrennte semantische Ebenen und explizite Ergebnisprüfung sind erforderlich.
- **Guest-Reihenfolge, #14:** Ein bestätigter Owner-Reply kann vor dem asynchronen Dokumenttransfer eintreffen. Codex hält dann den exakten Request und seinen Entwurf fest und blockiert Speichern bis zum bestätigten Mirror. Unabhängige Entwürfe werden bei der Ergebnisprüfung nicht gelöscht. Rendererregressionen prüfen beide Reihenfolgen.
- **Manuelles Pairing, #14:** Der frühere 30-Sekunden-Timeout unmittelbar nach Offerimport verkürzt den manuellen Antwortaustausch unzulässig. Codex überprüft die Startpunkte für Verbindungs- und Bestätigungstimer; die ursprüngliche fünfminütige Einladung darf dabei nicht verlängert werden.
- **Interop, #12:** Eine echte diagrams.net-Runde erhält Labels und Verbindungsbindungen; ihre Änderung invalidiert erwartungsgemäß das alte eigene Metadaten-Envelope. Die native Group-Darstellung unterdrückt jedoch den Containerrahmen; ein sichtbarer rechteckiger Container wird geprüft.
- **Desktoptest, #15:** Der ursprüngliche Shelltest öffnet an der vollständigen App einen echten nativen Speicherdialog und nimmt fälschlich an, der Renderer beantworte Close nicht selbst. Der Test wird auf ein echtes Dirty-Dokument, kontrolliertes Dialog-Cancel und die sichtbare Verwerfen-/Abbrechen-Entscheidung angepasst. Der vorangegangene Fehlschlag bleibt dokumentiert.
