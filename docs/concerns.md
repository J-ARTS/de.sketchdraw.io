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

## HyperDHT-/Relay-Umsetzung (#149, 11.11.2026)

Quelle: ausdrücklicher Nutzerauftrag und unabhängiges Codex-Architekturreview (`/root/hyperdht_architecture_review`); Umsetzung durch Claude CLI/Sonnet 5.5/high. Die folgenden Punkte sind Anforderungen bzw. offene Prüfgates, keine bereits bestandene Abnahme.

| ID | Fehlerfall / Auswirkung | Entscheidung / Verantwortlicher | Erforderlicher Prüfnachweis |
| --- | --- | --- | --- |
| HD-01 | DHT-Peer-Suche und UDP-Holepunch erreichen Geräte hinter blockiertem UDP nicht; HyperDHT `relayThrough` allein ist kein WSS-Fallback. | Nutzer präzisiert: dezentrale Discovery und freiwillige native Relay-Peers ohne eigenen festen Server. WSS bleibt optionaler unabhängiger Gatewaypfad für UDP-Sperren. Codex Architektur, Claude tatsächliche Umsetzung. Keine Zusage für jede Firewall oder vorhandene öffentliche Relay-Kapazität. | Echter Relay-Datenabgleich bei ausgefallenem direkten Pfad; beide Teilnehmer können UDP-blockiert sein; Timeout/Reconnect/Abbruch. |
| HD-02 | PIN als alleiniger Schlüssel oder PIN-HMAC erlaubt bei mitgeschnittenem Handshake Offline-Raten. | Erst hostauthentisierter E2E-Kanal mit gepinntem Schlüssel, PIN darin prüfen; hostweite Versuchsbegrenzung, Ablauf, frische Verbindungsschlüssel. Keine PIN in URL oder Relay-Zustand. | Falsche PIN, manipuliertes Host-Key-Pinning, Replay, Identitätsrotation gegen Rate-Limit, Relay-Mitschnitt ohne Klartext. |
| HD-03 | Bisheriger Automatic-Gast wird als lokale Authority installiert; Viewer kann lokal schreiben und Agentenzugriff kann fälschlich aktiviert werden. | Separater Bug erfasst, neuer Modus muss Raumrolle/Verbindungszustand und fehlende lokale Gastautorität durchsetzen. Codex prüft Store und MCP, nicht nur Wire-Rolle. | Viewer-UI/Code/Import/Undo sowie MCP-Gastzugriff; Editor, Reconnect und Verlassen. |
| HD-04 | Native HyperDHT-Abhängigkeiten werden in Renderer/Bundle gezogen oder fehlen im Installer. | HyperDHT in Main, begrenzte validierte IPC, externe native Laufzeitmodule korrekt paketieren. | Electron-Build, echte native Verbindung und Paketprüfung; Plattformnachweise getrennt berichten. |
| HD-05 | Upstream meldet ungeprüften Relay-/Probe-Fanout in HyperDHT; ein offener generischer DHT-Proxy verstärkt Ressourcenangriffe. | Begrenzter eigener Relay-Dienst statt ungeprüftem produktivem Einsatz des experimentellen `@hyperswarm/dht-relay`. Upstream-Risiko beobachten; keine Behauptung, ein Anwendungs-Limit behebe alle nativen DHT-Risiken. | Nachrichten-/Handshake-/Socket-/Queue-Budgets, malformed/oversize/idle/close-Tests; Quelle https://github.com/holepunchto/hyperdht/issues/296 . |

### Präzisierung nach Nutzerkorrektur und Community-Relay-Vorschlag

- **HD-06 — Gemeinsamer Helfer:** Globale zufällige Kandidatenlisten können bei Host/Gast disjunkt sein. Hostregistrierung und roomspezifische Discovery müssen zusammenpassen; zwei echte Helfer und Failover im isolierten DHT prüfen. Begrenzte native Anwendungsweiterleitung mit innerem E2E-Kanal ist die gewählte Umsetzung, kein ungeprüfter offener UDX-Proxy.
- **HD-07 — Lebenszyklus der DHT-Ankündigung:** Asynchrone announce/unannounce/Refresh-Operationen können nach Stop oder Registrierungsaustausch fertig werden. Generationenprüfung und Regression mit verzögerter Fertigstellung erforderlich; alte Operationen dürfen keine neue Session entfernen oder eine beendete erneut veröffentlichen. Quelle: unabhängiger Codex-Architekturreview, 11.11.2026.
- **HD-08 — Upstream-Patchstand:** HyperDHT #296 und der dazugehörige PR #300 sind am 11.11.2026 weiterhin offen. Die installierte Version 6.36.0 besitzt im geprüften Serverpfad noch den clientseitig angeforderten ausgehenden Relay-Verbindungsaufbau. Eigene App-Quotas sind keine Behebung dieses darunterliegenden Risikos. [Upstream PR](https://github.com/holepunchto/hyperdht/pull/300).
- Nutzeranhang bestätigt freiwillige Helfer und schlägt `blind-relay`, `relayThrough`, signierte Hostlisten und Einwilligung vor. Beispiele werden gegen installierte APIs geprüft; keine erfundenen öffentlichen Startkandidaten oder automatische Telemetrie. Architekturentscheidung: `docs/reviews/149-decentralized-relay-decision.md`.

- **HD-09 — Präzise Abwehr fremder Relay-Vorgaben:** Der dokumentierte HyperDHT-Firewall-Hook blockiert nun nicht-null `remoteHandshakePayload.relayThrough`, bevor6.36.0 den fremden Schlüssel anwählt. Realer isolierter Negativtest bestätigt0ausgehende Host-Dials, normale Verbindung anschließend erfolgreich. Damit ist genau dieser App-Einstieg abgewehrt, nicht sämtlicher vor dem Hook verarbeiteter Noise-/Handshakezustand oder alle Probe-Pfade aus Upstream#296. Quelle: zusätzlicher Nutzerreview, Codex-Native-Gegenprüfung/R30.
- **HD-10 — Fragmentzähler neben Bytebudget:** Leere verschlüsselte Fortsetzungsrecords ließen beliebig viele Arrayeinträge bei0Nutzbytes zu. Kanonische60-KiB-Fortsetzungen und nichtleere Schlussfragmente, Freigabe beiClose; eigener Angriffsrepro nun beim erstenRecordabgewiesen,8MiBübertragung weiterhinbestanden. Quelle: Codex-Endreview/R29.


## HD-11 — Fable 5.2: Größen, Rückstau und Reconnect (#149/#151)

Quelle: tatsächlicher Claude-Code-Aufruf `claude-fable-5-2 --effort high`, Sitzung `5db4e51b-d87f-4bd2-a71a-44ca84903e8c`; Originalbericht und Gegenprüfung in `docs/reviews/claude-149-fable-sparring.md`.

Bestätigte Befunde: große gültige Yjs-Zustände überschritten den normalen 4-MiB-Updatekanal; Sendefehler wurden verschluckt. Relay-Kontrollframes trennten verbundene Teilnehmer schon bei 64 KiB Rückstau, und ein Gesamtpufferbudget fehlte. Die Direktsuche endete voreilig nach vier Sekunden. PIN-Sperren beendeten auch den Reconnect bereits authentifizierter Gäste; kurze erfolgreiche Authentifizierungen setzten das Fehlerbudget unbegrenzt zurück.

Entscheidung: große Dokumente einschließlich Bildern, Seiten und Notizen gemäß ausdrücklicher Nutzeranforderung über einen separaten, begrenzten Yjs-Transfer unterstützen. Normale Updates behalten ihre Schutzgrenze. Relay-Kontrollen nutzen nach Join das normale Zielbudget und zusätzlich ein gemeinsames 64-MiB-Adapterbudget; dies ist keine RSS-/Kernel-/UDX-Speicherzusage. Direktsuche läuft bis zur gemeinsamen Frist; Reconnect ist zeitlich und nach Versuchen begrenzt. PIN-Erneuerung und endgültige Sperren werden nicht umgangen. Ein früher Relay-Link wird während noch ausstehendem Direktstart nur ausdrücklich freigegeben.

Root/Codex korrigierte zusätzlich drei unabhängig reproduzierte Fehler im neuen Transfer: Hash-Pufferreservierungen erst nach Abschluss des Hashens freigeben; Dokument-ID auch nach Merge in den Schattenzustand prüfen; blockierte Send-Vorgänge abbrechbar halten. Originalreproduktionen sind nach Korrektur bestanden. Realer Bilder-/Reconnect-Nachweis über lokales Relay und natives HyperDHT bestanden; finale Gesamtabnahme: 751 Unit-, 10 Browser- und 7 Electron-Tests bestanden. Details und Paket-Hashes in `docs/reviews/149-local-validation.json`. Keine Internet-NAT- oder Flottenfreigabe.


## HD-12 — Verbleibende Helfersuche und Eignung (#152)

Fable nennt Suchlast ohne Backoff, Ankündigung ohne belegte Eignung und fehlenden Nutzdaten-Selbsttest. Codex bestätigt im aktuellen Quelltext den Drei-Sekunden-Takt bei weniger als zwei Helfern und die Ankündigung nach Listen-Erfolg. Separater Folgeauftrag [#152](https://github.com/J-ARTS/de.sketchdraw.io/issues/152): begrenzter Backoff/Jitter, getrennte Eignungszustände und Prüfung still verwerfender Helfer. Nicht im aktuellen Großbild-Fix umgesetzt. Öffentliche Discovery/Bootstrap/Sybil- und Auth-Slot-Grenzen bleiben dokumentiert; reale Netzabnahme in #72. Verantwortlich: Codex Architektur/Testing, reguläre Logic/Interface-Implementierung Antigravity.


## IO-153 — Interoperabilität und Bestandsregressionen (11.11.2026)

Quelle: Nutzerauftrag #153 und unabhängiger Codex-Bestandsreview. Bestehende SVG-/draw.io-Adapter aus #12 werden erhalten, Mermaid wird als ausdrücklich begrenzter Flowchart-Adapter ergänzt. Andere Diagrammtypen, Styles und aktive Inhalte werden abgewiesen statt still ausgelassen. Portables Mermaid bewahrt keine Canvas-Geometrie, Bilder oder vollständige Dokumentsemantik; Verlustdiagnosen und optionale überprüfte Dokumentmetadaten unterscheiden beide Pfade.

- **IO-154:** Eigene draw.io-Metadaten waren nur auf der ersten Seite auffindbar; bei Auswahl einer späteren Seite gingen IDs/Zusatzdaten verloren. Fix liest den ersten Envelope, vergleicht weiterhin sämtliche sichtbaren Seiten vor Wiederherstellung und verengt erst danach auf die Auswahl. Regressionen für bearbeitete gewählte und nicht gewählte Seiten. [#154](https://github.com/J-ARTS/de.sketchdraw.io/issues/154).
- **IO-155:** Aus Zeilen-/Spalten-Maxima wurde vor Prüfung eine beliebig größere Zellmatrix erzeugt. Textlimit und 500-Zellen-Produktbudget werden jetzt vor `createTableDocument` geprüft; eine kurze dünn besetzte Eingabe reproduzierte den Fehler. [#155](https://github.com/J-ARTS/de.sketchdraw.io/issues/155).
- **IO-156:** Tabellenimport nahm `stroke` als Textfarbe trotz explizitem `fontColor`. Jetzt getrennte Schriftfarbe mit bisherigem Fallback. [#156](https://github.com/J-ARTS/de.sketchdraw.io/issues/156).

Reguläre Verantwortlichkeit: Antigravity Logic/Interface; tatsächliche Implementierung Codex-Vertretung, Gesamtprüfung Codex. Fable5.2/high prüft den konkreten Änderungsstand separat, noch ohne abschließendes Ergebnis. Keine vollständige Mermaid- oder draw.io-Kompatibilität behauptet; eigene Roundtrips sind kein Nachweis aller Fremdprogramme.

### IO-153-F — Tatsächliches Fable5.2/high-Sparring

Quelle: CLI-Sitzung `a2327c2e-97f8-479d-b658-60aea0a73996`, Originalbericht `docs/reviews/claude-153-fable-sparring.md`. Review ausschließlich lesend, keine Fable-Testläufe. Codex übernimmt bestätigte Fälle: adversarielle Fence-/HTML-Textprüfung linear begrenzen (F1); echte Mermaid12.3-Parsefehler für leere Labels und tatsächliche Entity-Textverfälschung bei `style:`/URL-Text korrigieren (F2); Circle-/Cross-/Long-Edge-Syntax darf keine Knoten verschlucken (F3); CRLF darf eigene Metadaten nicht ungültig machen (F4); verifizierte Seite und vollständige Wiederherstellung im Import sichtbar machen (F5); große eingebettete Dateien nicht ungefragt im Textfeld vervielfachen (F6).

F7 ist als [#157](https://github.com/J-ARTS/de.sketchdraw.io/issues/157) abgegrenzt: fehlende draw.io-Schriftfarbe muss unabhängig von der Kontur bleiben. Standardfarbsemantik anhand [draw.io Styles](https://github.com/jgraph/drawio/wiki/Styles) geprüft; keine vollständige Übernahme fremder Editor-Themes zugesagt.

F2-Hypothesen zu leeren Dokumenten und `endpoint`-Präfixen wurden mit tatsächlichem Mermaid12.3-Parser widerlegt. Acht Referenzfälle lagen bereits vor Fables Bericht vor; die pauschale Aussage „kein echter Parserlauf“ betrifft dessen gelesene Dateien, nicht den gesamten tatsächlichen Prüfumfang. Zusätzliche konkrete F2-Repros stehen in `docs/reviews/fixtures/153-mermaid/fable-f2-before.json`. Layoutfehler zwischen Container und Kind sind nur ungeprüfte Rendererhypothese, kein bestätigter Bug.

Verantwortlich: Codex Gesamtprüfung und temporäre Implementierungsvertretung; getrennte Backend-/Frontend-Dateibesitzer dokumentiert in #153. Korrekturen und erneute Endabnahme laufen.

Abschluss der lokalen IO-153-Gegenprüfung: F1–F7 in den bestätigten Teilen korrigiert und durch Tests abgesichert; 830 Unit-, 13 UI-, 7 Electron-Tests sowie19 tatsächliche Mermaid12.3-Parserfälle bestanden. Nicht bestätigte Hypothesen und verbleibende Layout-/Plattformgrenzen sind im Originalreview mit separater Codex-Disposition erhalten. #153–#157 bleiben bis zur Integration offen. Quellhashes/Befehle: `docs/reviews/153-local-validation.json`.

## Einheitliche Dropdowns (#158, 11.11.2026)

- **UI-158-01 — Menü außerhalb kurzer Ansichten:** Unabhängiger Codex-Review (`/root/dropdown_collaboration`) meldet die erzwungene Mindesthöhe von 120 px in `use-anchored-popover.ts`. Root bestätigt die Unterkante 264,98 px bei 240 px Fensterhöhe. Entscheidung: tatsächlichen verfügbaren Platz begrenzen, Optionen innerhalb scrollen. Verantwortlich Codex Prüfung/Korrektur, Claude Code zentrale UI-Implementierung. Reproduzierender Playwright-Test besteht nach Korrektur; Folge-Review ohne weiteren Befund.
- **UI-158-02 — Dynamische Vorschläge und Sperren:** Root reproduziert ungefiltertes Wiederöffnen bei keinem Namenstreffer und einen gesperrten aktiven Eintrag nach Änderung der Optionsliste. Filter beim Schließen erhalten, Änderungen an Optionen beobachten und nur aktivierbare Einträge als aktiven ARIA-Nachfolger referenzieren. Beide Regressionen bestehen. Belege: `docs/reviews/158-dropdown-review.md`, `tests/ui/custom-dropdowns.spec.ts`.


## Plugin-Konfiguration und Projektgrenzen (#160, 11.11.2026)

Quelle: unabhängiger Codex-Audit `/root/plugin_configuration_audit`; tatsächliches Fable5.2/high-Sparring wird separat abgelegt.

- **PL-160-01 — Veralteter Projektkontext:** Nach Neu/Import/Gast konnte der zuvor geöffnete Ordner mit aktiver Jira-Konfiguration bestehen bleiben; nach Speichern fehlte im Renderer die Aktualisierung. Entscheidung: expliziter lokaler Dokumentkontext bzw. Freigabe per null, sofortiges Leeren beim Wechsel und Schutz vor verspäteten Antworten. Verantwortlich Codex Architektur/Backend-Vertretung/Testing. Laufzeitnachweise folgen.
- **PL-160-02 — Nichtöffentliche Git-Eigenschaften:** `refreshRuntime` verteilte die gespeicherte Git-Konfiguration einschließlich verschlüsseltem Token in einen öffentlichen Snapshot. Der TypeScript-Typ entfernt keine Felder. Entscheidung: explizite öffentliche Eigenschaften und frischer Runtime-Status beim Ordnerwechsel; Ciphertext und Klartext dürfen nie im Snapshot erscheinen. Kein Nachweis einer Entschlüsselung oder externen Offenlegung behauptet.
- **PL-160-03 — Konfiguration schlecht erreichbar:** Nicht installierte Defaults, fehlender Speichern-Einstieg, nicht per Pfeiltasten erreichbare Tabs und Snapshot-bedingter Entwurfsverlust. Entscheidung: vorinstallierte deaktivierte Plugins, direkter Konfigurationseinstieg, unabhängige Entwürfe, sichtbare Rückmeldungen und überprüfte Tastaturführung. Verantwortlich Claude Code UI, Codex Gesamtprüfung.
- **PL-160-04 — Fehlgeschlagene Speicherung aktiviert Einstellungen:** Unabhängiger Review `/root/plugin_backend_review` reproduziert EISDIR durch ein Verzeichnis am Konfigurationspfad: Speichern scheitert, `listJiraIssues` verwendet aber bereits die neue Konfiguration. Entscheidung: Konfigurationsänderungen erst nach erfolgreicher atomarer Persistenz aktivieren, Regression mit erzwungenem Schreibfehler. Quelle und Gegenprüfung im #160-Review; nicht als behoben betrachten, bevor die Regression besteht.
- **PL-160-05 — Vue-Proxy an Electron:** Fable H1 als Hypothese gemeldet; Codex reproduziert unabhängig mit tatsächlichem Electron44.9, Sandbox und Context Isolation: Plain-Objekt funktioniert, Proxy wirft `An object could not be cloned.` (`docs/reviews/160-electron-proxy-probe.json`). Entscheidung: explizite Plain-DTOs im Store vor beiden Konfigurationsaufrufen. Die neue reactive/structuredClone-Regression besteht; vollständiger nativer Produktlauf folgt.

PL-160-04 unabhängig nach Korrektur bestätigt: gleicher EISDIR-Fall erzeugt keinen Remote-Request mehr (zuvor 1, nun 0); Konfiguration wird erst nach erfolgreicher Persistenz aktiviert. Unabhängiger Backend-Review: 79 fokussierte Tests, keine verbleibenden materiellen Befunde. Der vollständige Root-Unit-Lauf ohne die noch parallel bearbeitete Übersetzungssuite besteht mit 842 Tests. UI-/Electron-Abnahme steht noch aus. Unbekannte/beschädigte Konfigdateien bleiben als Folgefehler [#161](https://github.com/J-ARTS/de.sketchdraw.io/issues/161) abgegrenzt.


### PL-160 final local review

Actual Fable5.2/high read-only review completed; UI implementation attempts produced no edits and were interrupted. Codex root implemented the UI, Codex delegated agents implemented backend/store and test changes. Original report and exact execution metadata are in `docs/reviews/160-fable-sparring.*` and the interrupted-run JSON files.

- **PL-160-06 — Disabled fieldset focus:** independent Codex UI review found inherited disabled controls still in focus traversal. `focusableWithin` now checks native `:disabled`; a reverse-Tab browser regression passes.
- **PL-160-07 — Pending old project:** local pending flags survived project changes and old finally blocks could clear newer operations. Request ownership and context/dialog invalidation now isolate them; deferred A/B response regression passes.
- **PL-160-08 — Draft validation presented as cancellation:** a failed DSL validation did not set persistence lastError. Save CTA now displays the newly emitted validation error; actual code-editor UI regression passes without opening the file dialog.

PL-160-01 through PL-160-08 are locally addressed, with independent post-fix review. Both configurations persist through the real built Electron UI/preload/main path; folder reuse and separation pass. Final evidence: `docs/reviews/160-local-validation.json`. No live credentials, remote-service acceptance, or main integration claimed. #160 remains review until integration; #161 remains planned.


## MCP-Praxistest #176 — Entscheidungen vom 13.11.2026

Quelle: Issue #176, `docs/reviews/mcp-usability-2026-11-13-claude.md`, Implementierung `8df3006`; unabhängige Abnahme in der Ticketprüfung vom 13.11.2026. Reguläre Verantwortung: Antigravity (Schnittstellen), Codex (Architektur/Testing), Claude Code (Skill/Ergonomie nach Nutzerauftrag). Nachfolgende Entscheidungen sind kein Ersatz für den separat protokollierten Testlauf.

| Befund | Entscheidung und verbleibende Grenze | Erforderlicher Nachweis |
| --- | --- | --- |
| MCP-176-01: Ergebnisse nur strukturiert | JSON zusätzlich im Textblock; Clients erhalten identische Nutzdaten. `outputSchema` bleibt eine optionale spätere Erweiterung. | SDK-Test liest nur `tools/list` und Textantworten. |
| MCP-176-02: unentdeckbare Befehle | Beschriebene Befehlsunion und konkrete Validierungsdetails. Wiederholungs-IDs bleiben auch nach Ablehnung verbraucht; korrigierte Nutzlast verwendet neue ID. Der zweite pure Validierungsdurchlauf darf weder mutieren noch Zugriffsschutz umgehen. | Schema-, Ablehnungs- und unveränderter-Dokumentzustand-Tests. |
| MCP-176-03: gleiche Beschreibungen | Eigene Beschreibungen und Server-Anweisungen liefern den Arbeitsablauf ohne Skill. | Tool-Discovery im gebauten Adapter. |
| MCP-176-04: Dokumentwechsel | Schreibaufrufe benötigen immer die ausdrücklich angegebene `documentId` und Revision. Das verhindert stilles Mitnehmen auch hinter wartenden Lesern und nach Adapter-Neustart. Parallele Rotationen ersetzen nur die konkret fehlgeschlagene Verbindung. Unbekanntes Schreibergebnis bleibt `OUTCOME_UNKNOWN`. | Echter Adapter-/Host-Test über Dokumentrotation und gezielte Requester-Regressionen. |
| MCP-176-05: Parallelität | Zwei aktive Requests, begrenzte Warteschlange mit 64 Einträgen; Überlast bleibt ein sichtbarer `BUSY`-Fehler. | Parallele Aufrufe sowie Queue-Grenze und Freigabe bei Fehler. |
| MCP-176-06: Verbindungsgeometrie | Befehls- und Codeweg ergänzen seit `b524af8` Geometrie aus gültigen Endpunkten über denselben Domain-Helfer. Kanonisch ausgegebener Diagrammcode bleibt vollständig explizit. Dies ersetzt die frühere Beschränkung auf den Befehlsweg. Abweichende Standardstile bleiben dokumentiert; explizite Stilwerte werden erhalten. | Geometrie-/Seiten-/Default- und Code-Roundtriptests. |
| MCP-176-07: Undo fremder Änderungen | Die frühere lokale Entscheidung zum getrennten Nutzerverlauf wird durch die parallel veröffentlichte #176-Umsetzung `b524af8` ersetzt: ausschließlich vertrauenswürdig gebundene lokale Agenten benennen den menschlichen Verlaufsbesitzer. Menschliches Undo/Redo erfasst damit ihre Änderungen; neue Agentenänderungen leeren den menschlichen Redo-Stapel. Peer-Bindungen dürfen keinen fremden Verlaufsbesitzer nennen. Identität und Grant bleiben unverändert; kein Agenten-Undo-Tool. | Authority-Regressionen für gemeinsames Undo/Redo, Redo-Invalidierung und abgelehnte Peer-Übernahme; echter Electron-Agententest mit Cmd/Strg+Z. Skill und Integrationshilfe nennen den aktuellen Vertrag. |
| MCP-176-08: große Antworten | Für große Dokumente zuerst `analyze_document`/begrenztes `find_elements`, Volltext nur bei Bedarf, Assetbytes opt-in. Clients, die Text und `structuredContent` beide an das Modell reichen, tragen doppelte Kontextkosten; die doppelte Antwort bleibt für Clients ohne strukturierte Ausgabe erforderlich. Seiten-/Feldfilter werden nicht als vorhanden ausgegeben und sind keine Voraussetzung dieser Ergonomieabnahme. | Größen-/Limitprüfungen und dokumentierter Arbeitsablauf. |
| MCP-176-09: Skill-Auslieferung | Skill als lesbare Ressource mit der App ausliefern und Kopierpfade dokumentieren. Keine ungefragte Änderung fremder Client-Konfiguration. Ein Konfigurations-Kopierknopf ist eine spätere UX-Verbesserung. | Paketkonfiguration und tatsächlich erzeugtes Verzeichnispaket auf Skill-Datei und Inhaltsgleichheit prüfen. |

## Ticket-Sparring mit Fable 5.2 vom 13.11.2026

Tatsächliche unabhängige Quellreviews: Claude Code 2.1.323 / `claude-fable-5-2` / high. Die Originalberichte und gemessenen CLI-Werte stehen in `docs/reviews/2026-11-13-*-fable.{md,json}`. Codex reproduziert, implementiert und testet; Fable hat keine Tests ausgeführt. Der Ticketstatus bleibt in GitHub maßgeblich. Nachreviews und Gesamtintegration sind in den jeweiligen Abnahmeberichten getrennt ausgewiesen.

| Einwand / Quelle | Entscheidung, Verantwortung und Nachweis |
| --- | --- |
| MCP-F1/F2/F3/F7, #176: wartende oder erste Schreibaufrufe nach Neustart können das falsche Dokument treffen; konkurrierende Neuverbindungen/Queuefreigaben stören sich. | Codex: verpflichtende Dokument-ID, Austausch nur der konkret fehlgeschlagenen Verbindung und reservierte Queueplätze. Echter SDK-/Host-Rotationstest mit acht parallelen Lesern und alten/ungebundenen Schreibern; gesonderte Ablehnungs-/Schema-/Limiterregressionen. |
| MCP-F5/F6, #176: Zustandswechsel und veraltete Revision liefern irreführende Validierungsfehler. | Codex: `BUSY` mit Wiederholungsanweisung; Revision vor Befehlsvervollständigung prüfen. Close-Barriere und veralteter Connector regressionsgeprüft. Die Endpunkte werden durch `syncConnectorEndpoints` korrekt nachgeführt; eine später bestätigte abgewandte Ankerwahl bei Move+Add ist durch Fortschreiben der Batch-Geometrie korrigiert. Ein weiterer echter SDK-Test deckt parallelen Erstaufbau mit veralteter Umgebung ab. |
| Interop-F1/F3, #156/#155: zulässige Fremdfarben verletzen engen Zellvertrag; Padding überschreitet Textbudget nach Allokation. | Codex: Farben unmittelbar am Zellvertrag normalisieren, Annäherungen diagnostizieren, vollständiges Labelbudget vor Factory prüfen. Vorher rote, danach grüne Regressionen; siehe Interop-Abnahme. |
| Interop-F2, #180: portabler Export verwechselt Tabellenzellfarbe mit Außenkontur. | Codex: neue `drawio-v2`-Projektion, alte v1-Dateien ausschließlich gegen unveränderte v1-Projektion prüfen. Beide Versionen sowie manipulierte Mehrseiten-Dateien getestet; kein generischer Metadatenfallback. |
| Plugin-P1/P2/P3, #161/#168/#181: unzureichende Legacy-Prüfung, veraltete Instanzdatei und asynchroner Profilwechsel. | Codex: gemeinsame semantische Grenzen, optimistischer Dateistandvergleich und erneute aktuelle Renderer-Abfrage. Gültige Legacy-Übernahme bleibt gemäß #168 erhalten. Kein atomarer Mehrprozessvergleich versprochen; deterministische Zweitinstanz-/Dateirace-/Rename-Fehler-/Renderer-Regressionen. |
| P2P-D1/D2, #152: feste Suchfrequenz und ungetestete Registrierung werden überbewertet. | Codex: begrenzter Backoff mit Jitter und Mindestabstand, Quarantäne nur bei belegtem Weiterleitungsfehler. Keine zusätzliche registrierungsintensive Selbstprobe; authentisierter tatsächlicher Gastverkehr und Heartbeat prüfen den Pfad. Externe NAT-/Proxy-Reichweite bleibt unbewiesen. |
| P2P-E1, #179: ein fehlerhafter Gast beendet die Host-Sitzung. | Codex: authentisierte Peer-Generation, begrenzte getrennte Sendewarteschlangen und gezielte Fehler-/Kapazitätsbehandlung. Regression mit echtem verschlüsseltem Relay und zwei Gästen; gültiger Gast und Host bleiben nutzbar. |
| P2P-E7, #182: gemeinsames Relaybudget bestraft den nächsten unbeteiligten Anschluss. | Unabhängig mit Standardbudgets reproduziert. Codex prüft Weiterleitungsziel vor Nutzdatenbudget und begrenzt Überlast ohne willkürlichen Sessionabbruch; eigener Überlast-/Cleanup-Test erforderlich. |
| Graphify, #145/#183: Ledger-Ghost-Dedupe und fehlende Vue-SFC-Symbole werden in einer Knotenzahl vermischt. | #145 isoliert Quellrebuild und eigene Ledgerprojektion, prüft tatsächliche IDs und schützt vor Race/Verlust. Die historische 5201→5174-Differenz ist zerlegt. Der externe Vue-Extraktorfehler wird getrennt in #183 verfolgt, nicht als durch den Wrapper behoben ausgegeben. |

Unabhängiger Codex-Nachreview von `b524af8` (#176): Lokales menschliches Undo/Redo und Peer-Abgrenzung abgenommen. Bestätigter P2: Gemeinsame Connector-Routenberechnung darf explizit fehlerhafte `points`, `anchor` oder `connectorRouting` nicht still ersetzen. Zehn Ablehnungsregressionen waren vorher rot, nach Beschränkung auf tatsächlich ausgelassene Felder grün. Bericht: `docs/reviews/2026-11-13-mcp-b524af8-codex.md`; Gesamtstand `c2988e1`.


## Confluence Live-Doc-Abnahme (#208 / #209, 15.11.2026)

Quelle: Codex-Subagent `/root/plugins_audit`, Root-Quellabgleich auf `96c0039`; kein Claude-/Fable-Beitrag in diesem Teilauftrag.

- **CF-208-01 — Verlustbehafteter vollständiger Export:** Lokaler Codec-Probe bestätigt Verlust von Fettformatierung, Linkzielen, Nummerierung und Tabellenstruktur. Der vollständige Seitenbody wird beim Senden ersetzt. Entscheidung: separate Korrektur #209; Live-Abnahme zunächst nur am vom Nutzer bestimmten leeren Ziel und ausschließlich mit bewusst erzeugten Referenzinhalten. Verantwortlich Antigravity Logik, Claude Code UI, Codex Tests. Nachweis offen: Erhalt bzw. wirksamer Verlustschutz und isolierter Live-Roundtrip.
- **CF-208-02 — Live-Doc-Version ist kein vollständiger Inhaltsvergleich:** Laut [Atlassian](https://community.developer.atlassian.com/t/please-test-update-your-confluence-cloud-apps-to-function-in-live-docs-by-may-30-2025/89849) kann Inhalt innerhalb einer Version weiter verändert werden. Der aktuelle Pluginvertrag bewahrt nur die Seitenversion und sendet den vollständigen Body. Entscheidung: Pages v2/current nicht pauschal durch draft ersetzen; Subtyp/Status und Importgrundlage als künftigen Schutzvertrag prüfen. Ein zusätzlicher Vorabvergleich kann sichtbare Änderungen erkennen, garantiert aber keine atomare Konkurrenzkontrolle. Verantwortlich Codex Architektur/Testing, Antigravity Integration. Nachweis offen: kontrollierte Paralleländerung an nativen Live Docs, inklusive gleicher Version; keine tatsächliche Tenant-Datenüberschreibung beobachtet. [Update-Vertrag](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-page/#api-pages-id-put), [bekannte draft-Live-Doc-Probleme](https://jira.atlassian.com/browse/CONFCLOUD-83848).

### CF-210 — Vorläufige Gegenprüfung der laufenden Fable-Implementierung

Quelle: unabhängiger Codex-Prüfer `/root/plugins_audit`; genaue Quellhashes und reproduzierte Proben in `docs/reviews/210-confluence-auto-sync/codex-early-domain-review.md`. Fable schreibt noch; keine endgültige Freigabe.

- **CF-210-01 (P1):** Gleichnamige Anhänge fremder Confluence-Seiten werden als eigene Bilder erkannt. Das kann fremde Bilder entfernen oder eine nicht vorhandene lokale Einbettung als vollständig melden. Entscheidung: Containerreferenz berücksichtigen, Fremdreferenzen erhalten. Fable korrigiert; Codex verlangt beide Regressionen und Nachreview.
- **CF-210-02 (P2):** XML-Zeichenreferenzen im Dateinamen verursachen Duplikate oder ersetzen ein bestehendes Bild unter Verlust seiner Platzierung/Breite. Entscheidung: sichere Dekodierung für den Identitätsvergleich, bei Unsicherheit keine Umschreibung. Fable korrigiert; Codex prüft unveränderte Original-Markup-Ausgabe.

- **CF-210-03 (P1):** Legacy-Senden liest Tenant A und schreibt nach zwischenzeitlichem Wechsel an B; operationweiter Kontextschutz erforderlich. **CF-210-04 (P2):** Fehlender Body-Hash umgeht den Schutz gegen gleichversionige Live-Doc-Änderungen; ältere Annotationen müssen vor Schreiben neu geladen werden.
- **CF-210-05 (P1):** Fremde gleichnamige Anhänge und fremde Folgeversionen werden überschrieben. Anhang-ID und bestätigte Eigentums-/Versionsbasis persistieren, Konflikte sichtbar stoppen. Keine atomare CAS-Garantie aus bloßem Vorabvergleich ableiten.
- **CF-210-06 (P2):** Retry-After wird verworfen; Serverfrist durchgehend erzwingen. **CF-210-07 (P2):** Bei verlorenem Uploadergebnis und fehlendem Digest entsteht eine zweite Version; unbekannten Ausgang abgleichen oder ausdrücklich pausieren, nicht blind wiederholen.
- **CF-210-08 (P2):** Deaktivieren/Reaktivieren und direktes A→B→A lassen alte Jobs wieder gültig werden; unwiderrufliche Kontextepoche erforderlich. **CF-210-09 (Quellbefund P2):** Renderer-/Fensterende invalidiert Plugin-Jobs noch nicht; native Laufzeitregression erforderlich.

CF-210-03 bis -08 sind mit synthetischen PluginService-Mockantworten reproduziert; -09 ist bislang Quellreview. Belege/Hashes: `docs/reviews/210-confluence-auto-sync/codex-early-backend-review.md` und `backend-review-probes.json`. Verantwortlich Fable-Korrekturrunde; Codex prüft unabhängig nach. Keine Tenantüberschreibung beobachtet.

### Tatsächliche Fable-Bedenken B1–B12 (#210)

Quelle: Claude Code 2.1.323 / `claude-fable-5-2` / high, Sitzung `1e3c6764-0512-4678-a4f5-36c774ecb57b`, Original `docs/reviews/210-confluence-auto-sync/fable-implementation.md`. Dies sind explizite offene Grenzen/Entscheidungen, keine bestätigte Live-Freigabe.

| Quelle | Entscheidung / erforderlicher Nachweis |
| --- | --- |
| B1/B3: offene Live-Doc-Ansicht kann eine alte Medienversion halten; eingefügtes Storage-Markup könnte normalisiert werden. | Tatsächliches Ziel 164037 mit lokalem und Git-Update prüfen, ohne manuelles Senden/Reload. Uploadbestätigung genügt nicht; nötige Folgekorrektur durch Fable. |
| B2: Eingabe zwischen letztem Body-Vergleich und Page PUT. | Ruhefenster/Vollvergleich mindern das Risiko, liefern keine atomare Sperre. Fremdinhalt beim Einrichten und bei Seitenänderung prüfen; verbleibende API-Grenze offen benennen. Keine absolute Konkurrenzgarantie behaupten. |
| B4: fehlender Digest in Attachment-Metadaten. | Fables Vorschlag einer zusätzlichen Version ist für unbekannten Ausgang nicht ausreichend: CF-210-07 verlangt Abgleich oder sichtbaren Stopp; nicht blind wiederholen. |
| B5: bestätigte lokale Änderungen werden bereits vor Dateispeicherung veröffentlicht. | Vom Nutzerwunsch nach Aktualisierung bei lokalen Änderungen gedeckt. Entwürfe/Konflikte separat schützen; Betriebsbedingung in UI und Abnahme prüfen. |
| B6: gelöschte Diagrammseite entfernt Einbettung, belässt Anhang. | Angemessene begrenzte Änderung; keine automatische Anhangslöschung. Eigentumsprüfung CF-210-01/-05 bleibt zwingend. |
| B7: Schrift- und Rasterunterschiede, maximale Kante 4096 Pixel. | Reales Browser-Rastern plus visuelle AWS-Referenzabnahme, keine pixelgleiche Canvas-Darstellung behaupten. |
| B8: verschobene/kopierte Datei muss neu verknüpft werden. | Bewusste lokale Autoritätsbindung; Save As/Kopie darf keine zweite unbemerkte Publikationsinstanz erzeugen. |
| B9: strenger Schutz blockiert reichhaltige Legacy-Seiten. | Geeigneter vorläufiger Schutz; #209 bleibt bis vollständigem Codec-/UI-/Live-Nachweis offen. Alte Annotation ohne Basis-Hash muss neu laden (CF-210-04). |
| B10: zwei App-Instanzen können Profil-Dateikonflikt auslösen. | Bestehenden Schutz gegen externe Profiländerungen erhalten. Nicht als Mehrprozess-CAS ausgeben; keine zweite Produktinstanz mit demselben Profil parallel zur Live-Abnahme starten. |
| B11: vollständiger sichtbarer Dokumentfingerabdruck je Snapshot. | Noch keine Leistungsregression gemessen; bei auffälligen großen Dokumenten gezielt messen, keine unbelegten Leistungsversprechen. |
| B12: Status nur im Plugin-Dialog sichtbar. | Für aktuelle Abnahme zulässig; dauerhafte Sichtbarkeit im Hauptfenster bleibt mögliche Folgeverbesserung, keine zusätzliche automatische Benachrichtigungsflut. |


### CF-210 Nachprüfung der ersten Korrekturrunde (2026-11-15)

- CF-210-01/-02: unabhängig bestätigt korrigiert am Domain-SHA256 `58e917bde80ae8b5d5fbde201b13b091687c6f7663aba5499827b0f17c48375a`; neun reine Domain-Gegenproben bestanden (`docs/reviews/210-confluence-auto-sync/domain-correction-recheck.json`). Keine Aussage über native oder Tenant-Abnahme.
- CF-210-03 bis -08: unabhängige synthetische Backend-Proben am Snapshot `c539133102c2bb45e1518414606fa28123e000a54adf429ab877b0f6914b226a` bestätigen die jeweiligen Schutzpfade. `releaseRenderer()` invalidiert aktive und wartende Jobs; echte native Fensterlebensdauer bleibt zu prüfen. Fable führt parallel abschließende Tests aus; finale Quellgleichheit vor Freigabe verifizieren.
- **CF-210-10 (P1, neuer Nachreviewbefund):** Ein bereits wartender Auftrag trifft nach Kontextwechsel sofort auf `assertLiveJob`; seine noch leeren lokalen `published`/`pending`-Maps werden im `catch` trotzdem durch `remember()` gespeichert. Das löscht bestätigte Attachment-Zuordnungen. Nachfolgende Veröffentlichung kann eine fremde Sketchdraw-Version als unbekannten eigenen Anhang übernehmen und überschreiben. Synthetischer Ablauf: bestätigte v1 → aktiver verzögerter + wartender Auftrag → Konfiguration ändern → beide abgebrochen → Ownership gelöscht → fremde v20 wird zu v21 überschrieben. Quelle: unabhängige Codex-Probe unter `/tmp/sketchdraw-210-correction-review/`, oben genannter Backend-Snapshot. Entscheidung: abgebrochene, nie initialisierte Aufträge dürfen keine Linkzustände speichern; bestätigte und unklare Uploadstände anderer Aufträge erhalten. Verantwortlich nächste tatsächliche Fable-Korrektur; Regression für Queueabbruch und nachfolgenden Fremdversionskonflikt erforderlich. Noch keine abschließende Korrektur.

- **CF-210-11 (P2, neuer Nachreviewbefund):** Der visuelle Fingerabdruck berücksichtigt Component-Set-Icons nicht und Bilddaten nur über die Länge. Zwei gültige lokale Code-Ersetzungen (verwendetes SVG-Icon Rot→Blau und verwendetes PNG mit gleich langer DataURL) ändern den echten SVG-Export, lösen aber keine automatische Veröffentlichung aus; erst manuelles Synchronisieren aktualisiert. Echter Store/Codeparser/SVG, Desktop/Raster synthetisch; kein behaupteter Git-spezifischer Fehler. Beleg: `docs/reviews/210-confluence-auto-sync/correction-fingerprint-probes.json`, Store-SHA256 `7674802e0439fbc6b4c1d6afcc2adffbe5973c65d694413d7f11e70ee51d84cd`. Entscheidung: alle sichtbaren Exportdaten bzw. belastbare Inhaltsidentität erfassen; Task-/Kommentaränderungen weiterhin nicht unnötig übertragen. Verantwortlich nächste Fable-Korrektur mit beiden automatischen Regressionen.
- CF-210-10 bleibt nach zusätzlicher Fable-Abbruchkorrektur am Backend-SHA256 `f35b01385dcb4dba3cc2fc5c7bee95a1ec91cac6db2fdca5bc2aa685ea04ef51` bestätigt, auch mit AbortSignal beachtendem Fake. Der tatsächliche Fetch-Abbruch selbst ist zusätzlich bestätigt (`correction-abort-probes.json`). Vollständiger unabhängiger Bericht: `codex-correction-review.md`.

### CF-210-10 / CF-210-11: unabhängiger Korrektur-Nachweis (2026-11-15 22:40 UTC)

Codex `/root/live_correction_review` bestätigt beide Korrekturen auf Backend-SHA `8b509dd9b25839f682eb52af14413f91f50061ad851737cf16abee80afad3380` und Store-SHA `4dbba88658312bd9257fbc26a8dfa3da5fece3fe40776f21b47a4acc9f05b19a`. Zwölf Backendproben einschließlich erhaltener Anhangszuordnung/fremder Version20, zwei Abort-Proben und beide automatischen Icon-/Bilddatenveröffentlichungen bestanden. Vorherige fehlschlagende Belege erhalten. Bericht: `docs/reviews/210-confluence-auto-sync/codex-final-correction-review.md`; Hashes und strukturierte Resultate nebenan. Fable-Prozess noch aktiv; Endstand-Hashvergleich erforderlich. Native/Tenant-Abnahme dadurch nicht ersetzt.

### #210 Design-System-Integration und Prüfherkunft (2026-11-15)
- **UI-210-INTEGRATION-01 (P2):** Unabhängiger Codex-Nachreview findet feste Designwerte im neuen Live-CSS-Block. AGENTS.md verlangt gemeinsame Tokens. Entscheidung: tatsächlicher Fable-Lauf korrigiert nur neuen Block/tokens.css; bestehende Legacy-Styles und Logik erhalten. Nachweis: `docs/reviews/210-confluence-auto-sync/final-integration-review.md`; gezielte Story-/Designsystemprüfung und terminaler Hashvergleich ausstehend.
- **Fable-Integrationsbericht, fremder UI-Server5173:** Standard-Playwright-Konfiguration kann einen fremden Arbeitsbaum still wiederverwenden. Der erste29-Testlauf zählt nicht. Tatsächlich gültige29+56UI-Prüfungen laufen mit eigenem Server5183/reuseExistingServerfalse, neun Storyproben mit eigenen synthetischen Dateien. Root hält die Testherkunft fest. Keine Behauptung, der fremde Server sei beendet.
- **Native Eingabeunterbrechung:** Der integrierte Haupttest besteht einschließlich Git/Neustart; der zweite Schließtest wird schon beim Zeichnen durch buttons0/lostpointercapture an fremden Koordinaten unterbrochen. Keine CUA während dieses Laufs, Ursache daher offen. Gezielter exklusiver Nachlauf statt geschwächter Form-/Upload-Assertions.
- **Graph-Refresh #183:** Guard verweigert20fehlende Nicht-Ledger-Knoten; erste zehn Vue-Funktionen im Quelltext weiterhin vorhanden. Bestehendes Extraktionsissue183 fortgeführt; kein erzwungener Knotenverlust und kein Rückfall von behobenem Wrapperissue145 behauptet. Ledger-Projektion separat prüfen.

### #210 endgültiger lokaler Nachweis (2026-11-15 23:17 UTC)
- UI-210-INTEGRATION-01 unabhängig behoben bestätigt; finaler PluginSettings-SHA256 a4256e5c8312179fdd84309024d38b3a73a61e633ecf8302d358e608f0dee4d1. Nur neuer Live-CSS-Block verändert;13Reviewdateien und11Coredateien terminal abgeglichen.
- Native Endstandprüfung2/2 bestanden ohne Quelländerung oder parallele UI-Arbeit. Captureverlust aus Vorlauf bleibt als historische Eingabeunterbrechung dokumentiert; endgültiger Lifecycle-Nachweis10.301s bestanden. Native Hauptfall83.114s. Belege integration-native-final-*.json.
- B1/B3 echte geöffnete LiveDoc-Medienaktualisierung weiterhin offen; keine Tenant-Veröffentlichung. Alter App-Prozess kann durch CUA nicht beendet werden, manueller Beenden-Schritt ausstehend. #208/#210 deshalb offen/blockiert.
- Fables fremde Dev-Server-Bedenken separat in #214 aufgenommen; derzeit keine Implementierung dieses Folgeissues.

- Integrationsarbeitsbaum-Graphrefresh gesondert geprüft: Guard verweigert222fehlende alte IDs, darunter App.vue-Symbole nach upstream-Verlagerung nach WorkspacePage.vue (#211). Das ist zusätzlich zur ursprünglichen20Symbol-Extraktionslücke #183 zu bewerten, keine pauschale Zuordnung aller222zu#183. Bisheriger Graph bleibt erhalten; Kandidat nicht erzwungen. Beleg integration-graph-refresh-blocked.log.


### CF-217-01 — Alter Cache stoppt neue Datei-/Git-Authority (16.11.2026)

Quelle: unabhängiger Codex-Reproducer mit realen Produktfunktionen und ausschließlich synthetischem fake-indexeddb; docs/reviews/217-mcp-git-authority/review.md, controlled-result.json und controlled-manifest.json. Root-Livehinweis: tenant-authority-diverged-before-restart.png. Zugehöriges Issue217, Ursprung208/210.

- **Befund (P1, isoliert bestätigt):** Nach Datei-/Git-Installation mit gleicher Dokument-ID wird der alte CRDT-Cache asynchron außerhalb der Authority eingespielt. Er kann maßgebliche neue Dateiinhalte überschreiben; Authority beendet sich mit AUTHORITY_DIVERGED. Store zeigt weiterhin neuen Inhalt und saved. Echtes Agent-Binding und Save scheitern; echter CloseHandshakeCoordinator erhält cancel. Die frühere alleinige CUA-Erklärung des nicht beendeten Prozesses genügt nicht. Tatsächlicher Neustart ist weiterhin nicht belegt.
- **Entscheidung:** Datei-/Git-Zustand hat Vorrang; veraltete Hydrierung bei normaler Installation verhindern. Bloß authority.applyExternalUpdate einzusetzen genügt nicht, weil damit Cache-Rückfall erlaubt bliebe. Explizite Wiederherstellung durch createPersistedCrdtController erhalten. Keine Umgehung von Authority-, Grant-, P2P-Gast- oder Quit-Sicherheitsgrenzen. Späte alte Generationen dürfen keine neue Session beeinflussen.
- **Verantwortung:** Claude Code/Fable5.2 implementiert auf ausdrücklichen Nutzerauftrag; Codex Architektur/Testing und native/live Abnahme. Lauf42982/session64f445c3-ea0d-4cab-9925-03e9d2364df9 ist aktiv, keine Freigabe.
- **Erforderlicher Nachweis:** Same-ID älterer Cache + neue Datei/Git-Inhalte bleiben nach asynchroner Verarbeitung exakt erhalten; neue Agent-Lese-/Schreibverbindung, altes Binding ungültig, normaler Save und Quit. Schneller Switch/Dispose, späte Cachearbeit und explizite Recovery zusätzlich prüfen. Root bestätigt danach echten Prozesswechsel/Neustart und persistierte Live-Verknüpfung.
- **Beweisgrenze:** Erstlauf Exit2 bleibt erhalten (Store reproduziert, Low-Level gesund); kontrollierte synthetische Cache-Reihenfolge auf identischem Produktpräfix Exit0. Keine exakte native Registrierungs-IPC-Stufe aus Mocks behaupten; keine Benutzer-Caches, Runtime-Inhalte oder Zugangsdaten gelesen.


### CF-217-02 — Zweiter Cachehalter unterbricht die Recovery des ersten (16.11.2026)

Quelle: unabhängiger Codex-Lauf `/root/live_correction_review`, delegiert in #217 Kommentar 6912104646; `docs/reviews/217-mcp-git-authority/concurrency-review.md`, `concurrency-result.json` und `concurrency-source-manifest.json`. Root bestätigte das Ergebnis. Die Prüfung gilt für den archivierten Zwischenstand mit Persistence-SHA256 `727cd5490975d45d8d25e2581290cff0555b19d00e17850256c5d7035c4242fd`; kein Tenant- oder nativer Mehrfensternachweis.

- **Befund (P2, isoliert bestätigt):** Zwei aktive Persistenzhandles verwenden denselben Schlüssel. Das zweite Attach löscht die Datenbank und schließt dadurch die Verbindung des ersten. Dessen folgende gültige Änderung wird in der gesunden Authority committed, löst aber bei der Persistierung `InvalidStateError` aus. Die explizite Recovery enthält diese Änderung nicht. Exit 0 bestätigt die Fehlerreproduktion, keine Korrekturfreigabe.
- **Entscheidung:** Cachebesitz bzw. Generationen so regeln, dass ein zweites Attach kein still gebrochenes Persistenzversprechen für einen aktiven Halter hinterlässt. Die Einweggrenze bleibt bestehen: alter Cache darf nicht zurück in eine maßgebliche Datei-/Git-Authority gelangen. Authority-, Gast- und Quit-Sicherheitsprüfungen erhalten.
- **Verantwortung und Stand:** Hauptlauf Claude Code CLI 2.1.323 / `claude-fable-5-2` / high endete erfolgreich am 16.11.2026 um 09:10:03 UTC; die Produktabnahme bleibt wegen dieses unabhängigen Befunds offen. Fable-Korrekturlauf exec 26260 läuft seit 09:12:36 UTC in derselben Session. Codex verantwortet Nachreview und native/live Abnahme; der Codex-Befund ist kein Fable-Ergebnis.
- **Erforderlicher Nachweis:** Zwei weiterhin aktive Halter desselben Schlüssels, gültige Änderung des ersten nach Attach des zweiten und nachvollziehbares Recovery-Ergebnis ohne InvalidStateError oder stillen Verlust. Anschließend gezielte Cache-/Authority-Regressionsprüfung sowie native MCP-, Save-, reguläre Quit- und Neustartprüfung durch Root.
- **Historie und Grenzen:** CF-217-01 bleibt als ursprünglicher Befund erhalten. Der erste Fable-Lauf meldet 427 + 69 betroffene Unit-Prüfungen, Typecheck und Build bestanden; der native Test ist lediglich vorbereitet. Kein tatsächlicher Neustart belegt: alter PID 99302 läuft mit AUTHORITY_DIVERGED, CUA-Auswahl in der Aktivitätsanzeige meldet `noWindowsAvailable`. Kein zweiter Prozess mit demselben Profil starten.


### CF-217-02 — Korrekturbericht vom 16.11.2026, 09:20 UTC

- Tatsächlicher Fable-Korrekturlauf terminal erfolgreich; `docs/reviews/217-mcp-git-authority/fable-concurrency.md` meldet den Befund behoben. Attach löscht keine Datenbank mehr; atomare Transaktionen schreiben ausschließlich aus dem Controller. Recovery enthält den vollständigen Stand des letzten Schreibers. Die alte Spiegelkopie entfällt.
- Fable-Nachweis: 30/30 gezielte Tests viermal, 433/433 betroffene Unit-Prüfungen, Typecheck und Build bestanden; keine native Ausführung durch Fable. Prüfstand Persistence-SHA256 `581dd836497f1cd31b8454932cdbf901bffeb990742fad32585f4b4c708c23dd`. Root startet die unabhängige native Abnahme (exec 11937); gestartet ist nicht bestanden. Unabhängiger Review und natives Ergebnis stehen aus, deshalb keine abschließende Freigabe des Concerns.
- Grenzen bleiben ausdrücklich: nur ein Stand im Cache; bei wechselnden Haltern vollständige Neuschreibung, an y-indexeddb 9.0.12 gekoppeltes Speicherlayout, Transaktions-/versionchange-Verhalten in Chromium noch abzunehmen. Reale App-Beendigung/Neustart, Tenant-Konfliktnachweis und Zielbranchintegration weiterhin offen. Hauptlauf- und Repro-Historie bleibt erhalten.


### CF-217-02 — Unabhängig bestätigte Korrektur, 16.11.2026

Codex bestätigt den begrenzten Konkurrenzfall auf dem Freeze vom 09:21:02 UTC: zwei aktive Halter bleiben fehlerfrei, beide Authorities gesund, der Edit des ersten nach dem zweiten Attach erscheint in der expliziten Recovery. `docs/reviews/217-mcp-git-authority/codex-concurrency-final-review.md` und zugehörige Probe-/Hashartefakte. Dieser konkrete Concern ist im isolierten Prüfumfang behoben; native Quit- und echte Neustartabnahme werden dadurch nicht ersetzt.

### CF-218-01 — macOS beendet die Anwendung regulär nicht (16.11.2026)

Quelle: Root-Nativabnahme `docs/reviews/217-mcp-git-authority/native-final-report.json`, Stufe `normal quit`, und zusätzlicher unveränderter Test `docs/reviews/218-macos-quit/217-quit-diagnostic.json`. Neues Issue [#218](https://github.com/J-ARTS/de.sketchdraw.io/issues/218), Ursprung #217/#210/#208.

- **Befund:** Nach erfolgreichem Datei-/Git-Austausch, neuer MCP-Verbindung, Schreiben und Speichern beendet sich die macOS-Anwendung auf reguläre Quit-Anfrage nicht. Der #217-Neustartabschnitt ist deshalb nicht erreicht. Root untersucht die fehlende explizite Quit-Absicht und den vorzeitigen `before-quit`-Cleanup als Implementierungsursachen; laufende Leerfensterdiagnose nicht als abgeschlossen ausgeben.
- **Entscheidung:** Quit-Absicht, Renderer-Freigabe und endgültiges Aufräumen geordnet prüfen. Dokument-/Authority- und Unsaved-/Cancel-Schutz erhalten; kein erzwungener Prozessabbruch als regulärer Quit-Nachweis.
- **Verantwortung:** Root Codex diagnostiziert, prüft Architektur und führt native Tests aus. Tatsächliche Fable-Implementierung ist geplant; erst nach bestätigtem Start als laufend erfassen. UI-/Tenant-Aktionen bleiben exklusiv bei Root.
- **Nachweis:** Regulärer Quit eines vorher laufenden Prozesses endet mit Exit 0 ohne Signal; anschließend Neustart und funktionsfähige MCP-/Datei-/Git-Verbindung. Unsaved-/Cancel-Pfade dürfen keine Dienste vorzeitig verlieren.
- **Beweisgrenzen:** Der Folgeversuch `218-quit-diagnostic.json` scheitert bereits beim Zeichnen, daher kein Quit-Nachweis. Der vorherige Versuch behielt wegen Python-KeyError den alten Test bei. #210 besteht zwei native Fälle; dies ist kein erfolgreicher #217-Quit. 512 Quell-/Testdateien im ursprünglichen nativen Freeze unverändert; kein tatsächlicher Nutzer-App-Neustart bestätigt.


### CF-218-01 — Gespeicherte Leerfensterprobe bestätigt; Korrektur läuft

Root reproduzierte am 16.11.2026 um 09:33 UTC den Fehler auch mit einer wirklich gespeicherten leeren App: nach regulärem Quit kein Fenster mehr, aber Prozess-Exit und Signal weiterhin null. Belege `docs/reviews/218-native-quit/native-saved-before-{report,diagnostic}.json`. Die frühere Leerfensterprobe scheiterte vor Quit an einer falschen saved-Erwartung für unsaved-new und zählt nicht als Quit-Beweis. Tatsächlicher Fable-Lauf exec 25024 läuft seit 09:33:52 UTC; keine terminale Korrektur oder Abnahme. Unabhängiger Review und native komplette Quit-/Neustartprüfung bleiben erforderlich.


### CF-218-01 — Fable-Korrektur terminal, unabhängige Gesamtprüfung offen

Fable beendete die Korrektur am 16.11.2026 um 09:49:29 UTC erfolgreich. Laut Bericht hält die Anwendung die Quit-Absicht bis zur bestätigten Schließantwort, löscht sie bei Ablehnung und räumt Dienste erst in `will-quit` auf. Wiederholte Close-Anfragen erhalten die laufende Anfrage. 43 Unit-Prüfungen, Typecheck und Build sowie sechs abschließende isolierte native #218-Prüfungen bestanden. Belege `docs/reviews/218-native-quit/fable-implementation.md` und `fable-native-final-report.json`.

Roots komplette native Prüfung mit sechs Tests (exec 71449) und der unabhängige finale Read-only-Review laufen beim Übergabestand noch. Keine abschließende Concern-Freigabe, kein echter App-/Tenant-Neustart und keine Zielbranchintegration aus dem Fable-Ergebnis ableiten. Frühere Fehlproben und aktuelle Plattformgrenzen bleiben erhalten.


### CF-217-01 / CF-218-01 — Native Gesamtprüfung und begrenzter Review abgeschlossen

Root bestätigt am 16.11.2026 um 09:52:16 UTC den terminalen nativen Gesamtlauf mit 6/6 und Exit 0. Datei-/Git-Wechsel behalten funktionsfähige MCP-Grants; Lesen, Schreiben, Speichern, reguläres Beenden, Neustart und erneute Dateibearbeitung funktionieren im isolierten macOS-Fixture. Quit-Abbruch erhält Plugins, Wiederholungen behalten eine offene Frage, endgültiges Speichern beendet ohne Signal. Unabhängiger finaler Review: kein offener materieller Lifecycle-Befund. Die konkreten Codekorrekturen sind in diesem Umfang bestätigt; echter Nutzer-App-/Tenant-Neustart und Zielbranchintegration bleiben offen.

### CF-218-02 — Backend-Test erwartete alte Close-ID-Rotation (behoben)

Der unabhängige Review fand im vorhandenen Backend-Test einen P2-Vertragskonflikt: Wiederholung ohne Antwort erwartete eine neue Nachricht/ID, obwohl eine offene Anfrage jetzt erhalten bleibt. Root änderte nur den Test: gleiche ID bei Wiederholung, danach Cancel und neue ID bei nächster Anfrage, alte Antwort weiterhin zurückgewiesen. Vollständige Backend-Suite 4/4 bestanden, 13,279 Sekunden. Belege `docs/reviews/218-native-quit/codex-final-review.md` und `backend-report.json`. Das ist eine Root-Codex-Testkorrektur, keine Fable-Implementierung und kein abgeschwächter Sicherheitstest. Im Quellreview wird dieser Testbefund ebenfalls als CF-218-01 bezeichnet; diese lokale getrennte Kennung vermeidet Verwechslung mit dem ursprünglichen Quit-Bug.

### Graph-Refresh nach #217/#218 — Bestandsschutz weiterhin aktiv

Genau ein geschützter Refresh im Integrationsarbeitsbaum verweigert 222 fehlende Nicht-Ledger-Knoten, unter anderem alte `src/renderer/App.vue`-Symbole. Der bestehende Graph bleibt bytegleich; kein Force, kein manueller Knotenverlust. Beleg `docs/reviews/218-native-quit/graph-refresh-result.json`. Die frühere Differenz nach App.vue-/WorkspacePage-Verlagerung bleibt getrennt von der ursprünglichen Vue-Extraktionslücke #183; nicht pauschal alle 222 Knoten als legitime Löschungen oder als #183 freigeben. Ledgerprojektion wird separat geprüft.


### #210/#217/#218 — Vollständige Fable-Abstimmung und genaue Live-Zuordnung

Frischer tatsächlicher Fable-5.2-Review aller ausstehenden Codeänderungen läuft seit 16.11.2026 11:49:32 UTC; 33 Integrationsdateien und 22 Originaldateien, 35 unterschiedliche Pfade, 16 identische gemeinsame Fassungen. Noch keine terminale Freigabe. Originalcode enthält weiterhin ältere Cache-/Quit-Fassungen; kopierte Prüfberichte gelten für ihren dokumentierten Integrationsstand.

Der neue Live-MCP-Beleg um 11:51:32 UTC ist über Unix-Socket-Peer-Metadaten eindeutig dem gepackten Prozess PID 33132 zugeordnet. Die frühere 11:44-Antwort bleibt ohne diese rückwirkende Zuordnung. Die alte App PID 99302 wurde beendet; erfolgreicher Analyze belegt Dokumentzugriff nach Neustart, nicht bereits persistierte Atlassian-Verknüpfung, erneute Tenant-Publikation oder reguläres Quit im Nutzerprofil. Diese Abnahmen bleiben offen. Keine Secrets-/Runtime-Inhalte zur Zuordnung gelesen.


### FABLE-FULL-210 — Gesamtreview mit offenen Befunden und begrenzter Abdeckung

Quelle: tatsächlicher frischer Claude-Code-/Fable-5.2-Review, Session `5aa92638-1d2c-4ecc-b644-a106b55ff379`, `docs/reviews/210-confluence-auto-sync/full-fable-review/fable-review.md`. Terminal CLI success ist keine vollständige Akzeptanz. Rein statisch, keine eigenen Tests oder Builds. Original-Diff und Graphabfrage wurden vom Harness verweigert; mehrere Test-/Originaldateien bleiben teilweise oder nicht zeilenweise geprüft.

- **B1/P2, #210:** Konfigurationsspeicherung kann laut Review parallel fortgeschriebenen Anhangsstand zurücksetzen. Root prüft unabhängig, anschließend gegebenenfalls Fable-Korrektur und Konkurrenzregression.
- **B2/P2, #210:** Schreibpfad kann laut Review nicht mehr lesbaren Profilzustand persistieren (zu viele historische Seiten bzw. ungültiger Dokumentpfad). Unabhängige Prüfung und Schreib-/Lesevertragsregression offen.
- **B3, #217:** Explizite Recovery-Anbindung oder bewusste Cache-Reduktion/-Dokumentation als Produkt-/Architekturentscheidung festhalten. Kein stillschweigender Ausbau aus dem Review.
- **B4/B5/B7, #210:** Unsichere Seite vor Upload ablehnen; Fehler-Haltezeit auch bei Bearbeitung während eines Laufs beachten; Bildgröße verständlich melden.
- **B6, vorbestehend:** Renderer-Absturz verhindert reguläres Schließen; separat nachverfolgen, keine erfundene Issue-Nummer oder automatische Scope-Ausweitung.

Tatsächlicher Folge-Korrekturlauf und Abdeckungsreview werden erst nach Root-Prüfung gestartet. Bisherige native Prüfungen bleiben ihrem Code-Freeze zugeordnet; sie ersetzen die neuen offenen Befunde nicht.


### FABLE-FULL-210 — Root-Bestätigung, begrenzte Korrektur und getrennte Folgeissues

B1 und B2 wurden von Root unabhängig bestätigt; tatsächlicher Fable-Korrekturlauf exec 74582 läuft seit 16.11.2026 12:05:43 UTC. Scope: B1/B2/B4/B5/B7 und vollständiger Abdeckungsreview. Keine terminale Korrekturabnahme. Quelle `docs/reviews/210-confluence-auto-sync/full-fable-review/correction-prompt.md`, Registrierung #210 Kommentar 6915919024.

Für B2 wird blindes Löschen historischer Anhangs-Ownership abgelehnt: IDs und Versionen sichern den Konfliktschutz bei zurückkehrenden Diagrammseiten. Stattdessen gleiche Schreib-/Lesevalidierung und Kapazitätsprüfung vor entfernten Mutationen; Ownership- und Pending-Belege erhalten. Geforderte Regressionen noch ausstehend.

B3 ist als geplante Produktlücke in [#219](https://github.com/J-ARTS/de.sketchdraw.io/issues/219) separat erfasst; #217 behauptet keine Recovery-Oberfläche. B6 ist als vorbestehender Crash-/Close-Fall in [#220](https://github.com/J-ARTS/de.sketchdraw.io/issues/220) geplant; keine native Reproduktion oder Implementierung in diesem Korrekturlauf.


Unabhängige statische Bestätigung von B1/B2/B4/B5/B7 durch Root und `live_correction_review` archiviert: `docs/reviews/210-confluence-auto-sync/full-fable-review/codex-findings-review.md`. Keine neue Testausführung in diesem Review. Exakte Folgetitel: #219 „CRDT-Recovery nach Authority-Korrektur ausdrücklich anbieten und vom Datei-/Git-Stand trennen“; #220 „Abgestürzter Renderer kann reguläres Schließen und Beenden dauerhaft verhindern“. Beide bleiben geplant.


### FABLE-FULL-210 — Korrekturen gemeldet, Teilupload-Journalalias weiter offen

Checkpoint 2026-11-16T12:21:55.350472+00:00; Quelle: tatsächlicher Fable-Korrekturlauf `full-fable-review/fable-correction.md` und Roots anschließende unabhängige statische Bewertung. B1/B2/B4/B5/B7 sind laut Fable korrigiert und mit 137/137 gezielten Unit-Tests, Typecheck und Build belegt; unabhängige Abnahme und frische native Prüfung bleiben ausstehend. Alle 33 Integrations- und 22 Originaländerungseinträge laut Fable gelesen; unveränderte Reste teils nicht vollständig gelesen. Originalcode bleibt unverändert und enthält die alten Befunde.

**B8, #210 — Alias im Teilupload-Journal:** Root bestätigt den Fehlerfall statisch; isolierte Reproduktion läuft, tatsächliche Fable-Korrektur wird erst nach gesonderter Startmeldung erfasst. Risiko: der Besitz-/Fortschrittsnachweis eines begonnenen Teiluploads ist nicht zuverlässig vom Konfigurationszustand getrennt. Konkreter Reproduktionsnachweis und geeignete Journal-Snapshot-Korrektur bleiben offen; keine erfundenen Prüfresultate. Historische Ownership nicht pauschal entfernen. Zuständigkeit: Claude Code für Korrektur nach Root-Freigabe, Codex für unabhängige Prüfung.

**Live-Abnahme:** Jira-Verknüpfung „Architektur“ / 164037 nach Neustart sichtbar, keine Neuverknüpfung; frische lokale Titeländerung dem Paketprozess PID 33132 zugeordnet. Weiterhin alte UI-Synchronisationszeit 09:20, daher noch kein Nachweis erneuter Tenant-Übertragung. Beleg `docs/reviews/218-native-quit/tenant-restart-edit.json`. #219 Recovery und #220 Renderer-Crash-Schließen bleiben separat geplant. Graphprojektion weiterhin ausdrücklich ausstehend; kein Quellgraphrefresh.


### FABLE-FULL-210 B8 — Unabhängig reproduziert, tatsächliche Korrektur läuft

Checkpoint 2026-11-16T12:23:41.419676+00:00. Codex-Probe `docs/reviews/210-confluence-auto-sync/full-fable-review/codex-b8-alias-probe-result.json` bestätigt den Fehler am Service-SHA `87caa6ee618fa3cfcd8d0e215d9a96474d5f2fb161a57e9e2da05d0699f686dc`: nach bestätigtem Ersatz von Bild 1 und abgelehntem Ersatz von Bild 2 bleibt die Platte bei altem published-Stand und beiden pending; Speicher enthält den bestätigten Fortschritt. Neustart ohne entfernten Digest blockiert Bild 1 fälschlich. Kein Netzwerk, keine parallelen Einstellungen, kein Produkt-PASS.

Tatsächlicher Fable-B8-Lauf exec 33672 seit `2026-11-16T12:21:47.168043+00:00`, gleiche Session, Scope Service und passende Unit-Spec. Parserkopie übernehmen bzw. Snapshots trennen; Ownership-/Unknown-Upload-Schutz und Historie erhalten. Unabhängiger Nachreview und frische native Abnahme bleiben offen. Verursachungs-/Reproduktionsbeitrag ist Codex zugeordnet, nicht Fable.

Spätere echte Live-Beobachtung schließt die frühere Tenant-Lücke für das alte #218-Paket: automatischer Upload nach Neustart, UI 13:17 MEZ und neue Chrome-Überschrift bestätigt. Root meldet reguläres Speichern und Beenden ohne Force-Quit; finaler Quit-Beleg folgt. Das ist keine Abnahme neuer Korrekturquellen. Graphprojektion bleibt aufgeschoben.


B8-/Live-Nachweisergänzung 2026-11-16T12:24:46.759454+00:00: kanonischer unabhängiger Reproduktionsbericht `docs/reviews/210-confluence-auto-sync/full-fable-review/b8-independent-before/review.md` mit Ergebnis/Manifest/Harness archiviert; Erkenntnis unverändert, Korrekturlauf aktiv. Tatsächliches reguläres Beenden des alten #218-Pakets im Nutzerprofil nun durch `docs/reviews/218-native-quit/tenant-normal-quit.json` belegt: Cmd+S, Cmd+Q, PID 33132 abwesend ohne Force-Quit. Prozessabfrage Exit 1 ist kein App-Exit-Code. Frische Korrekturquellen weiterhin unabgenommen; Graphprojektion bleibt aufgeschoben.


### FABLE-FULL-210 B8 — Korrektur gemeldet, unabhängige Abnahme ausstehend

Checkpoint 2026-11-16T12:26:02.616087+00:00. Tatsächlicher Fable-Bericht `docs/reviews/210-confluence-auto-sync/full-fable-review/fable-b8.md`: normalisierte Parserkopie in den Profilzustand übernommen; veränderliche Jobmaps entkoppelt. Gezielte Regressionen vor Fix 2/2 rot, danach 139/139 Tests grün. Fund/Reproduktion weiterhin Codex zugeordnet. Finaler Service-SHA laut Root `91b4310efad6c074dcc9cd29565395005eb5fe169f20ae60b356ff360a59a2c4`.

Status **behoben laut Fable; unabhängiger Review läuft**. Typecheck/Build/native nach B8 noch ausstehend bei Root. Reale Tenant-Neustartbelege stammen aus dem älteren Paket und gelten nicht als jetzige Source-Abnahme. #219/#220 und die gesonderte #217-Registrierungsbeobachtung unverändert; finale Graphprojektion bleibt aufgeschoben.


### FABLE-FULL-210 — Sechs Korrekturen unabhängig abgenommen, Abdeckung geklärt

Checkpoint 2026-11-16T12:33:56.378257+00:00: `codex-correction-review.md` und `b8-independent-after/review.md` bestätigen B1/B2/B4/B5/B7/B8 im begrenzten finalen Quellstand; B8 vor/nach unabhängig reproduziert/geprüft. Fables `fable-final-review.md` korrigiert frühere Volllektüre-/Übersetzungs-/Hashangaben und bestätigt sämtliche Änderungshunks33+22, mit17ganz/16Hunk-Dateien in der Integration und offengelegter geerbter Originalabdeckung. Root AST64/64identisch, aktuell12gemeinsameHashfassungen. Ältere Berichte bleiben historisch erhalten.

Direkter Root-Typecheck und Build Exit0 schließen die früher nicht separat gesicherte Typecheck-Pipeline ab. Native5/6initial plus1/1Einzelwiederholung,447Quellen unverändert; kein6/6Erstlauf behauptet. Finales Paket bestätigt bestehenden Link und automatischen Upload13:30in derPluginUI; leerer Chrome-Screenshot und leere Prozessliste sind keine neuen Browser-/PID-/Quitnachweise.

Offen bleiben Zielbranchintegration, #217-Registrierungsfehlersichtbarkeit sowie separat #219Recovery/#220RendererCrash; Layout-Seiten und Zwei-Geräte-Konflikt nicht neu akzeptiert. Original enthält ältere Produktfassungen. Root autorisiert einmaligen geschützten Quellgraphversuch und anschließende serielle Ledgerprojektion; Guard-Ergebnis noch offen, kein Force.


### FABLE-FULL-210 — Settings-Konkurrenz als #221 separat geplant

Checkpoint 2026-11-16T12:37:01.105814+00:00. Exaktes Folgeticket [#221 „Gleichzeitige Plugin-Einstellungsänderungen können unabhängige Werte überschreiben“](https://github.com/J-ARTS/de.sketchdraw.io/issues/221) von Root nach Duplikatsuche bestätigt. Vorbestehende statische Beobachtung aus Fables Korrekturbericht: unabhängige Einstellungen können denselben alten Snapshot verwenden. Reproduktion/Behebung ausstehend; keine Scope-Erweiterung der sechs korrigierten Befunde. B1-Schutz der Live-Links ist hiervon abgegrenzt.

Neuer einmaliger Quellrefresh mit Schutz verweigert weiterhin 222 fehlende Nicht-Ledger-Knoten; Bestand bytegleich, kein Force. Quellgraph nicht aktualisiert, Ledgerprojektion folgt separat. Finales App-Paket über `/private/tmp` korrekt PID 55685 zugeordnet; frühere leere Prozessanzeige als Zwischenstand klargestellt, kein neuer Quit-Nachweis.


Finale Übergabe 2026-11-16T12:39:37.583018+00:00: Root bestätigt #208/#210/#218 offen auf Review, #217 offen In Arbeit. Siehe `docs/reviews/210-confluence-auto-sync/full-fable-review/final-acceptance.md` und dortige GitHub-Kommentarlinks. #208 Layout-/externe Konfliktabnahme, #217 Registrierungsfehlersichtbarkeit und Zielbranchintegration bleiben offen. #219/#220/#221 separat geplant. Keine erneute Quellgraphaktualisierung; finale Ledgerprojektion und Prüfung folgen seriell nach diesem Statusabgleich.
