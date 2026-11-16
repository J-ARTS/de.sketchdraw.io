# #210: Korrektur der Live-Beobachtung und Fable-Laufnachweise

Stand: 2026-11-16T08:05:29.408891+00:00. Delegation vor Beginn in #210 Kommentar 6910746850 registriert. Diese Nachprüfung ändert nur Dokumentation, Ledger/Task und deren Ledger-Graph-Projektion. Keine Produkt-, UI-, Tenant-, GitHub- oder Commit-Aktion; keine erneuten Tests.

## Bestätigter Live-Fortschritt (Root-Beobachtung)

- Der vermeintliche Hänger beruhte auf veralteten CUA-Accessibility-/Screenshotdaten. Ein harmloser Klick auf eine Überschrift, ausdrücklich nicht auf „Jetzt synchronisieren“, zeigte den aktuellen Appstatus „Diagramm in Confluence aktualisiert“, zuletzt 08:43 Ortszeit.
- Im bereits geöffneten originalen Chrome-LiveDoc 164037 waren beide PNGs ohne Browserreload sichtbar. Root bewahrt `tenant-initial-page1.png` und `tenant-initial-page2.png` als Belege.
- Der lokale MCP-Titelwechsel am 2026-11-16T07:54:31.253Z änderte Revision 0→1 auf „AWS Bedrock & AgentCore · Live-Architektur“. Die Antwort meldete `saved:false`, `unsaved-open-document`; daraus wird kein Speichervorgang abgeleitet. Das erste Bild aktualisierte sich automatisch sichtbar (`tenant-local-edit.json`, `tenant-local-update-page1.png`).
- Ergänzter Root-Nachweis: Auch Seite 2 zeigt den neuen Header „Live-Architektur“ ohne Reload des Originaltabs (`tenant-local-update-page2.png`). Echte Git-Aktualisierung und Neustart bleiben offen. Die lokale Git-Fixture-Basis ist `a68fb10c3bd21f31da85f113b6949ed1209f6c06` (ausschließlich lokales Bare-Repository, kein GitHub-Push). Root bittet den Nutzer, den Git-Pluginbereich zu öffnen.
- GitHub-Issues #208/#210 bleiben in-progress. Laut Root sind die Bodies inzwischen auf die bestätigte Übertragung korrigiert; Kommentare 6910746850/6910748642 bewahren die Korrekturhistorie. Kein Gesamtabschluss wird behauptet. Der separat aktualisierte Versionsverlauf zeigt initial V1→V2/08:43 und nach dem lokalen Titelwechsel weiterhin Seitenversion 2 (`tenant-version-history-v2.png`, `tenant-live-checkpoint.json`). Die beiden Bildänderungen sind direkt sichtbar belegt; kein V3 wird behauptet.

## Historische Aufnahmen bleiben unverändert

`tenant-first-transfer-pending.json`, `tenant-first-transfer-pending.png` und `tenant-transfer-later-observation.json` bleiben bytegleich erhalten. Ihre „syncing“-Angaben sind historische, als stale erkannte Beobachtungen und kein Nachweis eines laufenden Hängers. Diese Einordnung steht separat hier, im Ledger und im aktuellen Taskcheckpoint; die früheren Belege werden nicht rückwirkend umgeschrieben. Alle derzeit vorhandenen Tenantbelege wurden unverändert in den Integrationsworktree gespiegelt.

## Tatsächliche Fable-Ergebnisse und Messwerte

| Lauf | Tatsächlicher Abschluss | Laufzeit | Turns | Inkrementelle Tokens | Inkrementelle Kosten |
| --- | --- | ---: | ---: | ---: | ---: |
| CLI 6, Untersuchung | Root-SIGINT, Prozess laut Root exit 0; Result `error_during_execution`, `is_error:true`, `aborted_streaming` |336.215s|27|4185578|7.204830 USD|
| CLI 7, Berichtskorrektur | Result `success`, `is_error:false`, `completed` |50.597s|4|1100557|0.715523 USD|

Die Session ist `728fee98-1c17-4d6b-88d8-8669564c95e6`, tatsächliches Werkzeug Claude Code CLI 2.1.323, tatsächliches Modell claude-fable-5-2. Kosten und Tokenzahlen stammen aus `model_usage_since_last_result`. Die kumulativen Kosten 9.9753938→17.1802238→17.8957468 wurden nicht erneut als einzelne Läufe gezählt. Die vier addierten Tokenkategorien sind Input, Output, Cache-Erstellung und Cache-Lesen; Thinking-Tokenzahlen sind bereits Teil der Outputzahl. `duration_api_ms` ist kein zusätzlicher Laufzeitwert.

Die archivierten Dateien `fable-live-hang-result.json` und `fable-live-observation-correction-result.json` enthalten ausschließlich die jeweiligen Terminalresultate, keine Thinkingtexte oder Rohgesprächslogs. `fable-live-usage-review.json` dokumentiert den Kategorieabgleich mit dem vorherigen kumulativen Resultat. Fables Bericht wurde wortgetreu aus dem Integrationsworktree übernommen; seine Angabe „Zeit, Tokens, Kosten unbekannt“ wird durch diese gemessenen Abschlussdaten ergänzt, nicht nachträglich in seinem Text verändert.

## Isolierter Rendernachweis und Grenzen

`fable-live-render-run-evidence.json` archiviert lediglich die tatsächlichen Tool-Ergebniszeilen aus Event 160: „Running 2 tests using 1 worker“ / „2 passed (7.0s)“. Kein erneuter Testlauf. Das Renderprotokoll zeigt beide PNGs dekodiert, keine Seitenfehler, Rasterzeit 341 ms (erste Bildquelle 3533 ms bis zweite PNG-Fertigstellung 3874 ms), Übergabe an die Fake-Bridge 3874 ms, Antwort 3908 ms. PNGs: 3202×2608/571969Bytes und 2562×3606/774755Bytes. Fixture-Hash `bdf3038570b04d6b0141faa0bf2405238f2d24ff3923c0754eef1c10f62cc888`, 53000 Bytes, 62 Elemente, keine Assets.

Die Prüfung geschah in Headless-Chromium mit erfundener Bridge, nicht in Electron/gepackter App oder am Tenant. Der Live-Link war über Fake-getSettings vorgegeben; der Test beweist kein echtes Verknüpfen. Eine vollständige Netzwerksperre ist im Harness nicht nachgewiesen; die relevante Upload-Bridge ist jedoch synthetisch. Die nicht ausgeführten Fehler-Injektionsschalter liefern keine Ergebnisse. Die erfolgreichen Tenantbeobachtungen stammen separat von Root.

## Quellintegrität

Aktueller Integrationsstand gegen die vorhandenen Nachweise: 275/275 Quell-/Testhashes identisch, 11/11 Kernhashes und 14/14 finale UI-/Kontexthashes identisch. `live-observation-source-verification.json` enthält die konkreten Hashes. Die ältere export.ts-Abweichung gehört bereits zur dokumentierten main-Integration; sie ist keine Änderung dieser beiden Fable-Läufe. Nicht jede Konfigurationsdatei besitzt einen früheren Vollhash-Nachweis; der unabhängige Leser fand bei ausgewählten Root-/Buildkonfigurationen keine Änderungen gegenüber HEAD. Es wurde keine Produktkorrektur vorgenommen oder ein Hänger reproduziert.

## Separater Exportbefund #215 und begrenzte Referenzvorbereitung

[Issue #215](https://github.com/J-ARTS/de.sketchdraw.io/issues/215) wurde lesend gegen GitHub abgeglichen: „SVG-/Confluence-Export: Lange Annotation-Absätze werden nicht umgebrochen und abgeschnitten“, offen/geplant, Labels bug, ui, interface, testing. `tenant-initial-page2.png` zeigt den von Root gemeldeten Textüberlauf. Die allgemeine Exportkorrektur gehört nicht zum Umfang von #210.

Root hat ausschließlich in der lokalen Git-Fixture einen Workaround mit kurzen Absatzblöcken und besseren Seitennamen vorbereitet: Commit `6aa1e14df8f67115e9fe577ca0613f5cde676fa7`, noch nicht gepusht. `tenant-git-reference-validation.json` dokumentiert die vorhandene erfolgreiche validateDocument-Prüfung: 62 Elemente, zwei Seiten, 38 Annotationsblöcke. Das ist ein Vorbereitungsnachweis, kein ausgeführter Auto-Pull-/Tenanttest; es wurde hier keine Prüfung wiederholt.

Root hat `tenant-live-checkpoint.json` in beiden Checkouts getrennt erzeugt: Inhalt identisch bis auf `recordedAt` (weniger als eine Millisekunde Abstand). Beide Originaldateien bleiben unverändert erhalten; der Hashnachweis nennt die unterschiedlichen Hashes ausdrücklich.

## Ledger-Abschluss dieses begrenzten Auftrags

Ledger und aktueller Taskcheckpoint sind in beiden Checkouts identisch. Serielle Ledger-Projektion und `--check` bestanden in beiden Checkouts, auch nach dem Abschlussvermerk: 2857 Traceability-Knoten und 3964 Links. Alle 273 früheren Messdatensätze sowie fremde Graphdatensätze und unbeteiligte Issue-/Laufeinträge bleiben erhalten. Die neuen Fable-Läufe sind einmalig mit ihren tatsächlichen inkrementellen Messwerten erfasst. Git-/Neustart- und laut Root-Checkpoint Tenant-Konfliktnachweis bleiben offen.
