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
| C-011 | Claude Code, Mehrseiten-Vorschlag | Schema v2 macht neue Dokumente für ältere App-Versionen (v0.1.x) und v1-Peers unlesbar. | ADR 0006: Migration v1 → v2 beim Laden, Schema-Fehler beim Öffnen/Beitreten statt stiller Verfälschung; Hinweis in den Release-Notes. Kein v1-Export. | Test: v1-Datei und Vorschauseiten öffnen verlustfrei; v2 wird von der Schemaprüfung klar abgelehnt. |

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
| MC-03 | Angenommen: Pending-ID vor await reservieren, Fingerprint inklusive Operation/Revision, gleiche Requests zusammenführen. Max4096 IDs je interner Sitzung ohne unsichere Verdrängung; danach `JOURNAL_FULL` bis zur nächsten automatisch erzeugten Dokument-/App-Sitzung. | Gleichzeitige gleiche/geänderte IDs, No-Op, Timeout vor/nach Commit. |
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

## Tabellen-Review und Entscheidungen (#58)

Quelle: echter lokaler Claude-Code-Lauf für Issue #58; Antigravity zeigte am 18.10.2026 ein Quotenlimit bis 24.10.2026 und konnte keinen Auftrag annehmen. Die tatsächliche Implementierung erfolgte daher durch Codex im ausdrücklich erlaubten Vertretungsmodus. Der offizielle Verhaltensvergleich stützt sich auf [Figma Help: Tables in FigJam](https://help.figma.com/hc/en-us/articles/12583849250199-Tables-in-FigJam).

| ID | Bedenken aus dem Review | Entscheidung und Nachweis |
| --- | --- | --- |
| TB-01 | Der bestehende Texteditor besitzt nur eine Editiersitzung und eignet sich nicht für mehrere Zellinstanzen. | Angenommen. Die Tabelle bleibt ein Element; genau eine Zelle erhält bei Bedarf einen sicheren Texteditor. `Tab`/`Umschalt+Tab`, `Escape` und Strg/Cmd+Enter werden im Zellkontext geprüft. |
| TB-02 | Elementgranulare Commands können parallele Änderungen verschiedener Zellen derselben Tabelle kollidieren lassen. | Bewusst akzeptiert und in `docs/architecture.md` benannt. Atomare, verlustfreie Konflikte sind für Version 1 wichtiger als eine unbelegte Zell-CRDT. |
| TB-03 | Viele `foreignObject`-Instanzen können Rendering und Export uneinheitlich machen. | Angenommen. Lesedarstellung und SVG-Projektion verwenden sichere native Text-/Vektorprimitive; nur die aktive Zelle nutzt ein HTML-Textarea. |
| TB-04 | `Tab` kann den Canvasfokus verlassen und Zellnavigation unzugänglich machen. | Angenommen. Der aktive Zelleditor fängt `Tab` und `Umschalt+Tab` ab; ARIA-Grid, benannte Zellknöpfe und Axe-Prüfung ergänzen den Tastaturpfad. |
| TB-05 | Zusätzliche Tabellenaktionen können die kontextbezogene Leiste überfüllen. | Angenommen. Häufige Textformatierung bleibt direkt sichtbar; Strukturaktionen sind in einem eigenen Popover gebündelt, Randgriffe bieten die häufigsten Einfügeaktionen. |
| TB-06 | Tabellen können Diagram-as-Code, SVG/draw.io, Kopieren, Undo und P2P umgehen. | Angenommen. Ein versioniertes Domainmodell mit abgeleitetem TSV wird von Validierung, Clone/Equality, Commands, Code-Syntax und eingebetteten Exporten getragen; Unit- und UI-Tests bilden die Regression ab. |

## Kommentar- und Aufgabenreview (#59)

Quelle: echter lokaler Claude-Code-Lauf in `docs/reviews/claude-comments-059.md`. Antigravity konnte wegen des dokumentierten Kontingentlimits keinen Auftrag annehmen (`docs/reviews/antigravity-comments-059.md`). Codex implementiert vorübergehend im ausdrücklich freigegebenen Vertretungsmodus.

| ID | Entscheidung / aktueller Stand | Pflichtnachweis |
| --- | --- | --- |
| CL-CMT-01, 07, 13 | Kommentare und Aufgaben sind strukturierte v1-Dokumentdaten und werden in JSON sowie Diagram-as-Code erhalten. Version 1 repliziert beide Sammlungen atomar mit CAS; keine unbelegte CRDT-Konvergenz. | JSON-/Code-Roundtrip, History und P2P-Regression. |
| CL-CMT-02, 03, 04 | Autoren-ID und Anzeigename sind getrennt. Eigene Bearbeitung und Viewer-Sperre gelten in UI und gemeinsamer Authority; daraus wird kein kryptografischer IAM-Nachweis abgeleitet. | Negativer Fremdautor-/Viewer-Test und echter Peerpfad. |
| CL-CMT-05 | Gelöschte Elemente lösen die Bindung und behalten den absoluten Rückfallpunkt. Fehlende Zellen fallen auf das Tabellenelement zurück. | Move/Resize/Delete-/Zellstrukturtests. |
| CL-CMT-06 | Abgeschlossene Thread- und Taskwrites sind reguläre History-Transaktionen. | Undo/Redo-Regression. |
| CL-CMT-08 | Kollaborationspins erscheinen nicht in der sichtbaren SVG-/draw.io-Projektion; der exakte Sketchdraw-Envelope erhält sie. Ein Datenschutzhinweis für Exporte bleibt gesonderte Produktarbeit. | Interop-Roundtrip und sichtbarer Exportvergleich. |
| CL-CMT-09 | Elementkopien duplizieren keine Kommentar-Threads oder Aufgaben. | Clipboard-Regression. |
| CL-CMT-10 | Linkkopie nutzt die bestehende Zwischenablage-Abstraktion und meldet Fehler. | Browser-/Electron-Test. |
| CL-CMT-11, 12 | Feste Mengen-, Text- und Dokumentlimits; ausschließlich Klartext. | Grenz- und XSS-Darstellungstest. |
| CL-CMT-14 | Pins liegen als Bildschirm-Overlay außerhalb SVG und Minimap. Sichtbarkeitsfilterung wird erst bei gemessenem Bedarf ergänzt. | UI-Performanceprofil bei großem Dokument. |
| CL-CMT-15 | Aufgaben sind eine appweite Workspace-Ansicht neben Seiten. Das Mehrseitenmodell #33–#35 bleibt unberührt. | Navigationstest und Schema-Roundtrip. |

## Yjs- und Trystero-Implementierungsgrenzen (#71/#72)

| ID | Bedenken | Entscheidung und Nachweis |
| --- | --- | --- |
| CRDT-01 | Ein gültiges konkurrierendes Reparenting kann nach dem Merge einen Containerzyklus erzeugen. | Die Projektion löst ungültige Parent-/Connector-/Assetreferenzen und entfernt deterministisch die Parent-Kante der lexikografisch größten ID eines Zyklus. Zwei-Peer-Regression mit gleichzeitigen Gegenbewegungen besteht. |
| CRDT-02 | Ein gesamtes Rich-Text-, Kommentar- oder Aufgabenfeld als Map-Skalar würde parallele Eingaben verlieren. | Annotation-Blöcke und -Runs, Element-, Zell-, Kommentar- und Aufgabentexte verwenden verschachtelte Yjs-Typen beziehungsweise `Y.Text`; IDs und Rank-Maps führen unabhängige Einfügungen zusammen. Konvergenztests bestehen. |
| CRDT-03 | Ein Remote-Yjs-Update kann das aktive Dokument vor der Domainprüfung dauerhaft beschädigen. | Größen- und IAM-Prüfung erfolgt vor einer vollständigen Schattenkopie und validierten `SketchDocument`-Projektion. Erst der bestätigte Stand wird aktiv angewendet. Fuzzing und Speicherprofiling bleiben spätere Härtung. |
| AUTO-01 | Trystero-MQTT löst Signaling hinter WSS-Proxys, liefert aber keinen WSS-Datenfallback. | Die UI benennt Signaling und ICE/TURN getrennt; es gibt keinen stillen Relaypfad. Reale PAC-/NTLM-/Kerberos-/TURN-Prüfungen bleiben in #72 offen. |
| AUTO-02 | Ein Vollmesh mit 100 Teilnehmern erzeugt 4.950 Peer-Paare. | Keine 100-Teilnehmer-Zusage. #72 bleibt bis zu 25/50/100-Messungen und einer daraus abgeleiteten begrenzten Topologie offen. |
| AUTO-03 | Eine automatische Einladung für ein fremdes Dokument darf ungespeicherte lokale Arbeit nicht still ersetzen. | Der jetzige UI-Prototyp verlangt dieselbe bereits geöffnete Dokument-ID und lehnt andere Dokumente ab. Ein Lifecycle-gesicherter Initial-Bootstrap mit sichtbarer Save-/Discard-Entscheidung bleibt vor allgemeiner Freigabe offen. |


## Mehrseiten-Kompatibilitätsgrenze (#33–#35)

| ID | Bedenken | Entscheidung und Nachweis |
| --- | --- | --- |
| MP-01 | Der Nutzer benötigt sofort eine funktionierende Plus-Aktion, während das öffentliche Schema v2, MCP, P2P und die mehrseitigen Interop-Verträge aus #33/#34 noch nicht vollständig umgesetzt sind. Eine nur lokale Seitenliste würde Inhalte beim Neustart verlieren; eine vorzeitige Behauptung, Schema v2 sei fertig, wäre ebenfalls falsch. | Der Renderer persistiert vorübergehend validierte inaktive Seitenschnappschüsse in versionierten Kompatibilitätsmetadaten und hält die aktive Seite weiterhin als reguläre v1-Elementliste. Seitenwechsel erfolgen atomar über den vorhandenen `replace`-Command und bleiben damit in History, Save und Authority. Dies erfüllt die aktuelle Plus-/Wechselanforderung, ist aber **kein Abschluss von Schema v2**. #33/#34 bleiben offen, müssen die Metadaten deterministisch migrieren und Diagram-as-Code, MCP, P2P sowie Interop dokumentweit umstellen. Geprüft werden Inhaltstrennung, Save/Reopen, Undo-/Write-Pfad und Browser-UI. |

## Native Integration und Fremdprogramm-Abnahme

- **P2P-Netzwerk, #14:** Der lokale macOS-Host erreicht keine ICE-Verbindung. Derselbe Stand f8c55fb besteht auf dem unveränderten Ubuntu-Runner beide echten Chromium-/Electron-Transporttests (Run 39041998555, Job 117423198082). Kein STUN/TURN/Relay und keine Abschwächung der Sandbox hinzugefügt. Der dritte Produkt-UI-Test fand eine Mehrdeutigkeit zwischen bestätigtem Element und beibehaltenem Entwurf; getrennte semantische Ebenen und explizite Ergebnisprüfung sind erforderlich.
- **Guest-Reihenfolge, #14:** Ein bestätigter Owner-Reply kann vor dem asynchronen Dokumenttransfer eintreffen. Codex hält dann den exakten Request und seinen Entwurf fest und blockiert Speichern bis zum bestätigten Mirror. Unabhängige Entwürfe werden bei der Ergebnisprüfung nicht gelöscht. Rendererregressionen prüfen beide Reihenfolgen.
- **Manuelles Pairing, #14:** Der frühere 30-Sekunden-Timeout unmittelbar nach Offerimport verkürzt den manuellen Antwortaustausch unzulässig. Codex überprüft die Startpunkte für Verbindungs- und Bestätigungstimer; die ursprüngliche fünfminütige Einladung darf dabei nicht verlängert werden.
- **Interop, #12:** Eine echte diagrams.net-Runde erhält Labels und Verbindungsbindungen; ihre Änderung invalidiert erwartungsgemäß das alte eigene Metadaten-Envelope. Die native Group-Darstellung unterdrückt jedoch den Containerrahmen; ein sichtbarer rechteckiger Container wird geprüft.
- **Desktoptest, #15:** Der ursprüngliche Shelltest öffnet an der vollständigen App einen echten nativen Speicherdialog und nimmt fälschlich an, der Renderer beantworte Close nicht selbst. Der Test wird auf ein echtes Dirty-Dokument, kontrolliertes Dialog-Cancel und die sichtbare Verwerfen-/Abbrechen-Entscheidung angepasst. Der vorangegangene Fehlschlag bleibt dokumentiert.


## Bestätigter Folgeabgleich: Plattformintegration

- **Präzisierung zum frühen P2P-Nachweis:** Der erste Electron-Transporttest ließ Playwrights Standard `--no-sandbox` zu und war daher kein OS-Sandboxnachweis. Der zweite Linuxlauf `39042878369` an `654a416` besteht ausdrücklich mit `chromiumSandbox:true`, ohne Abschalter und mit geprüften isolierten Fenstern. Chromium wird separat als Browservergleich erfasst. Lokal besteht nun die Browserverbindung; Electron erreicht auf dem Entwicklerhost weiterhin keine ICE-Kandidatenpaare. Diese Netzwerkgrenze wird nicht durch einen externen Relaydienst überbrückt.
- **P2P-Feedback, #14/#15:** Die zweite native Produktprüfung fand eine tatsächliche Überdeckung des Ergebnisprüfungsbuttons durch die Erfolgsmeldung. Ein gemeinsamer vertikaler Feedbackbereich behebt die Ursache. Der unveränderte Zwei-App-Ablauf sowie neue Regressionen bei 1280 und 480 Pixeln bestehen lokal; kein erzwungener Klick und keine aufgeweichte Mirrorbedingung. Beleg: `docs/reviews/codex-p2p-feedback.md`.
- **Windows-Testlebenszyklus, #15/#24:** Der erste Windowslauf belegte hängenden Prozessabbau und gesperrte Profil-Dateien. Tests und Installer-Smoke verwenden denselben begrenzten Cleanup für ausschließlich den eigenen Prozessbaum; primäre Prüffehler bleiben bei zusätzlichem Cleanupfehler erhalten. Die neue Windows-Nativbestätigung steht aus.
- **Eigenschaftenentwurf, #25:** Bei einem einzelnen Objekt wurde ein abgelehnter Entwurfswert fälschlich als „Verschieden“ dargestellt. Als eigenes Ticket erfasst; die Korrektur darf weder den Entwurf verwerfen noch tatsächliche gemischte Mehrfachauswahlen verstecken.
- **Abgeschlossene lokale Korrekturen:** Pairingfristen beginnen nun an den richtigen manuellen Schritten und verlängern die ursprüngliche Einladung nicht. Der draw.io-Container besitzt eine sichtbare native Darstellung, geprüft mit einer tatsächlichen diagrams.net-Runde. Der Desktoptest prüft jetzt den echten Dirty-Dialog und kontrolliertes natives Save-Cancel. Die zweite CI bestätigt sämtliche Desktopprüfungen auf Ubuntu und macOS; die Drei-Installer-Freigabe bleibt davon getrennt.


## Release-Abnahme und getrennte Folgebefunde

- **Leere CI-Signingwerte, #26:** Der tatsächliche macOS-Installerbau an `a041cea` scheitert, weil Electron Builder26.15.3 `CSC_LINK=""` als vorhandenen Pfad auswertet. Codex nimmt den Befund an: fehlende optionale Werte vor dem Builder entfernen; echte Credentials und gültige leere Zertifikatpasswörter erhalten. Pflichtnachweis: reproduzierende Unitfälle, unabhängiger Review und tatsächlicher DMG-Start mit derselben leeren CI-Umgebung. Regulär zuständig Antigravity, tatsächliche Korrektur durch vorübergehend autorisierten Codex.
- **Defaultkeychain-Notarisierungsprofil, #27:** Der unabhängige Codex-Review belegt im installierten Builder, dass `APPLE_KEYCHAIN_PROFILE` allein genügt; unser Resolver verlangt zusätzlich `APPLE_KEYCHAIN`. Als separater Folgefehler angenommen. Die geplante Ad-hoc-Auslieferung ohne Notarisierung ist davon nicht betroffen; keine Ausweitung des aktuellen Releases. Nächster Schritt für Antigravity: Resolver und drei Konfigurationsregressionen angleichen. Reale Notarisierung braucht später einen nativen Nachweis mit vorhandener Signingkonfiguration.
- **Native Installer an `a041cea`:** Release-Lauf39044870745 bestätigt Windows-NSIS und Linux-DEB einschließlich tatsächlicher extrahierter App und MCP. macOS bleibt durch #26 blockiert; Veröffentlichung korrekt übersprungen. Die vollständige Produkt-CI auf allen drei Betriebssystemen einschließlich Windows-Prozessabbau und sandboxed P2P ist zuvor bestanden. Das ersetzt die ausstehende gemeinsame Drei-Installer-Freigabe nicht.
- **Draft-Wiederaufnahme, #28:** An `c4bdfd6` bestehen alle drei echten Installerprüfungen und die gemeinsame Artefaktvalidierung. Der Publish-Schritt findet sein gerade angelegtes Bot-Draft jedoch über den Tag-Endpunkt nicht wieder (404), obwohl die Releases-Liste es enthält. Codex nimmt eine gezielte paginierte Suche nach exakt dem Tag an; die unveränderliche Release-ID, Bot-Identität, Ownership-Marker und alle Byteprüfungen bleiben Pflicht. Die Wiederaufnahme verwendet unveränderte, bereits nativ geprüfte Installer derselben Produktrevision; daraus folgt keine Erlaubnis, fremde Drafts oder Tags umzuschreiben.

- **Bestätigter Abschluss an `c4bdfd6`:** #26 ist durch den tatsächlichen macOS-CI-Installer bestätigt. Alle drei Installer wurden in [v0.1.1](https://github.com/J-ARTS/de.sketchdraw.io/releases/tag/v0.1.1) veröffentlicht und öffentlich heruntergeladen; SHA-256 und Größen stimmen mit den nativen CI-Nachweisen überein. #28 ist lokal korrigiert und unabhängig geprüft (58 Nodefälle, darin 38 Releasefälle). Die Recovery führte Codex aus; der anschließende Actions-Publish bestätigt `already-published-idempotent`. Der erste lokale Upload überschritt 120 Sekunden; eine Messung zeigte rund 0,65 MB/s. Ausschließlich Asset-Uploads haben nun 600 Sekunden Zeit. #27 bleibt eine getrennte optionale Folgeaufgabe. Belege: `docs/reviews/release-validation.md` und `docs/reviews/release-v0.1.1-verification.json`.
