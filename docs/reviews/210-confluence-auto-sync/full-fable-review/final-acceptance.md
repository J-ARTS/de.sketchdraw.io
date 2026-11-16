# Abschluss des Fable-Sparrings und der Live-Abnahme

Stand: 16.11.2026, 12:39 UTC. Koordination und unabhängige Abnahme: OpenAI Codex. Tatsächlicher externer Reviewpartner und Korrekturimplementierer: Claude Code CLI 2.1.323, `claude-fable-5-2`, effort high, Session `5aa92638-1d2c-4ecc-b644-a106b55ff379`.

## Ergebnis und geprüfter Umfang

Alle Änderungshunks der 33 Code-/Testeinträge im Integrationsworktree und der 22 Einträge im ursprünglichen Checkout wurden mit Fable abgestimmt. Identische Inhalte wurden über Hashes zugeordnet; dies sind keine 55 voneinander unabhängigen Dateien. Im Integrationsstand wurden 17 Dateien ganz und 16 anhand ihrer Änderungshunks gelesen. Unveränderte Bereiche dieser 16 Dateien sind nicht als geprüft ausgewiesen. Der ältere Originalcheckout blieb unverändert und enthält die neuen Korrekturen nicht.

Fables abschließender Bericht korrigiert frühere zu weitgehende Aussagen zur Ganzlektüre und zum Übersetzungsnachweis. Der AST-Vergleich der 64 bestehenden Übersetzungen stammt von Codex; Fable las anschließend alle Vergleichseinträge und den betroffenen Quellabschnitt. Siehe `fable-final-review.md`, `source-manifest-final.json` und `original-translations-comparison.json`.

Sechs Befunde sind im Integrationsworktree behoben und nachgeprüft:

- B1: Konfigurationsänderungen erhalten die aktuell gespeicherte Live-Link-Historie.
- B2: Gespeicherte Links durchlaufen dieselbe Validierung wie gelesene Links; Publikation berücksichtigt die Kapazität für bestätigte und ausstehende Uploads. Keine automatische Historienlöschung.
- B4: Unsichere oder übergroße Confluence-Seiteninhalte werden vor dem Upload abgewiesen; spätere Konfliktprüfungen bleiben erhalten.
- B5: Änderungen während einer fehlgeschlagenen Publikation umgehen die Fehlerwartezeit nicht. Explizites Synchronisieren darf diese Wartezeit, aber niemals Retry-After umgehen.
- B7: PNGs über 10 MiB erhalten eine konkrete lokalisierte Fehlermeldung mit Seitennamen und Grenze.
- B8: Persistierte Linkzustände sind von veränderlichen Upload-Zuständen getrennt. Ein bereits bestätigter erster Upload bleibt bei einem Fehler des zweiten Uploads auf Datenträger bestätigt.

Die unabhängige B8-Probe schlug vor der Korrektur fehl und bestand danach. Ein tatsächlich unklarer zweiter Upload bleibt weiterhin geschützt. Belege: `codex-correction-review.md`, `b8-independent-before/`, `b8-independent-after/` und Fables Korrekturberichte.

## Prüfungen

- Fable: 139 von 139 fokussierten Unit-Tests in sieben Dateien bestanden; zwei neue B8-Regressionen waren vor der Korrektur rot.
- Codex Root: eigenständige Typprüfung und Build jeweils Exit 0 am finalen Stand.
- Native Electron-Prüfung: Gesamtlauf 5 von 6 bestanden. Der erste Test wurde beim initialen Zeichnen durch einen Pointer-Capture-Verlust unterbrochen, bevor Confluence/Git eingerichtet waren. Seine gezielte Wiederholung bestand vollständig, ohne Quell-/Teständerung oder abgeschwächte Prüfung. Alle sechs Szenarien haben damit einen bestandenen Nachweis über 5+1 Läufe; es gab keinen einzelnen fehlerfreien 6/6-Gesamtlauf am finalen Stand.
- Alle 447 erfassten Quell-/Testdateien blieben während der Root-Prüfungen unverändert.
- Finales lokales macOS-arm64-Paket erfolgreich gebaut und geöffnet. Keine Veröffentlichung oder Windows-/Linux-Abnahme.

Belege: `root-final-verification.json`, `root-final-native-summary.json`, `root-final-native-repeat-run.json`, `root-final-source-before.json`, `root-final-source-after.json` und `final-package-result.json`.

## Tatsächliche Live-Abnahme

Ziel war ausschließlich das vorhandene Confluence Live Doc [Architektur, Seite 164037](https://j-art.atlassian.net/wiki/spaces/~5b63fda9e288ee2d9b4bc60a/pages/164037/Architektur), bedient über SketchDraws Atlassian-Plugin. Die AWS-Bedrock-/AgentCore-Referenz hat zwei Diagrammseiten. Kein AWS-Deployment und keine Ersatzseite wurden angelegt.

Vorherige Belege bestätigen automatische lokale Änderungen und automatische Übernahme des lokalen Git-Testcommits `6aa1e14df8f67115e9fe577ca0613f5cde676fa7` mit geänderten Bildern beider Seiten im geöffneten Live Doc. Es wurde kein öffentlicher Git-Push ausgeführt.

Im gepackten #218-Build, ASAR `de7f5688991f3c058bd01464ba1731ef4411cc13709ad892ab59142f74fc9998`, blieb die Verknüpfung nach Neustart erhalten. Ein neuer offizieller MCP-Lese-/Schreibzugriff wurde über Prozess-/Socketmetadaten eindeutig diesem Prozess zugeordnet. Der Titelwechsel erschien automatisch im vorhandenen Live Doc und ist im Browserbild dokumentiert. Anschließend funktionierten Cmd+S und Cmd+Q; Prozess 33132 endete ohne Signal oder Force-Quit. Siehe `docs/reviews/218-native-quit/tenant-restart-edit.json`, `tenant-restart-live-observation.json`, `tenant-restart-live-page1.png` und `tenant-normal-quit.json`.

Der finale Build einschließlich der sechs Korrekturen ist geöffnet: `/private/tmp/sketchdraw-210-fable-final-build/mac-arm64/Sketchdraw.app`, beobachteter Prozess 55685, ASAR `11fd4f322bbcc02cfd802c70b8e8967cfe01ae402425addc6f4ec247ef7f372c`. Der Titel wurde auf „AWS Bedrock & AgentCore · Live-Architektur“ zurückgesetzt und gespeichert. Die tatsächliche Plugin-UI zeigt die bestehende Verknüpfung sowie erfolgreiche automatische Übertragung um 13:30 MEZ, ohne erneutes Verknüpfen oder manuelles Synchronisieren. Die Chrome-Aufnahme dieses letzten Schritts war weiß; für diesen finalen Build wird keine zusätzliche Browserbild- oder tatsächliche Quit-Abnahme behauptet. Beleg: `final-live-observation.json`.

## Offene Grenzen und Fortsetzung

- Änderungen sind lokal, uncommittet und nicht im Zielbranch integriert: Branch `codex/210-confluence-integration`, Basis `c572671f1ba17adf957fe4eff1e53457a4c20fc6`. Finaler `electron/plugin-service.ts`-SHA256: `91b4310efad6c074dcc9cd29565395005eb5fe169f20ae60b356ff360a59a2c4`.
- #208: besonderer Layout-Inhalt und kontrollierter externer Live-Doc-/Zwei-Geräte-Konflikt sind nicht live abgenommen. Das Restfenster vor dem Seiten-PUT ist keine nachgewiesene atomare Konfliktsperre.
- #217: allgemeine Sichtbarkeit und sichere Wiederherstellung injizierter Registrierungsfehler bleiben offen.
- #219: explizite Recovery-Oberfläche; #220: Schließen bei Renderer-Absturz; #221: konkurrierende allgemeine Plugin-Einstellungsänderungen. Diese getrennten Folgeaufgaben sind nicht umgesetzt. #220/#221 sind zunächst statische Befunde, keine behaupteten nativen Reproduktionen.
- Das Entfernen von Jira entfernt die Live-Verknüpfungen gemäß dem expliziten Konfigurationsvertrag; die verbleibende UX-Frage ist im Fable-Bericht benannt.
- Der geschützte Graphify-Quellrefresh wurde genau einmal erneut ausgeführt und verweigerte 222 entfallende Nicht-Ledger-Knoten. Der vorherige Graph blieb bytegleich erhalten; kein Force und kein weiterer Versuch. Die Ledger-Verknüpfungen werden davon getrennt aktualisiert und geprüft; der Quellgraph ist nicht als frisch regeneriert ausgewiesen.

GitHub bleibt maßgeblich. #208/#210/#218 stehen offen auf `status: review`; #217 bleibt offen auf `status: in-progress`. Nächster Integrationsschritt ist die Übernahme des geprüften lokalen Stands in den Zielbranch; fehlende Abnahme-/Funktionspunkte bleiben in ihren Issues. Ohne erfüllte Abschlussbedingungen wurden keine Tickets geschlossen.

Bestätigte Abschlusskommentare: [#208](https://github.com/J-ARTS/de.sketchdraw.io/issues/208#issuecomment-6916612671), [#210](https://github.com/J-ARTS/de.sketchdraw.io/issues/210#issuecomment-6916613185), [#217](https://github.com/J-ARTS/de.sketchdraw.io/issues/217#issuecomment-6916613603), [#218](https://github.com/J-ARTS/de.sketchdraw.io/issues/218#issuecomment-6916613998).
