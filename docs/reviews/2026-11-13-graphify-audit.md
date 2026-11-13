# Graphify-Ursachenprüfung und sicherer Aktualisierungspfad #145

Delegierter Codex-Prüfer `interop_audit`; Root koordiniert Integration, finale serielle Graphschreibvorgänge und Ticketabschluss. Verwendeter Skill: `/Users/jeremyteichmann/.codex/skills/evo-subgraph-maintenance/SKILL.md`. Keine neue Ontologie, kein automatisches Aufwerten von Befunden zu Produktwissen, keine Benchmarkbehauptung.

## Bestätigte Ursache

Graphify 0.8.44 erhält beim Code-Neuaufbau Nicht-AST-Knoten aus dem bisherigen Graphen. `build.build_from_json()` dedupliziert vermeintliche Geisterknoten nach `(basename(source_file), label)`. Die Implementierung berücksichtigt `source_location` als kanonisches Merkmal und lässt dadurch auch zwei Nicht-AST-Knoten gegeneinander kollabieren. Verschiedene Ledger-Runs verweisen absichtlich auf gleich benannte Artefakte; ihre JSON-Pointer und IDs sind verschieden. Diese Knoten sind keine Duplikate. Der globale Knotenzahlschutz reagiert anschließend auf die Gesamtreduktion.

Der ursprüngliche Fehler ist exakt reproduziert: Quellstand `7781fa5` in einem temporären `git archive`-Checkout, Ausgangsgraph aus `ac86d5f`, `graphify update .` meldet **5.174 statt 5.201** und verweigert das Schreiben mit Exit 1. Der Kandidat wurde durch einen temporären Beobachter vor `_check_shrink` kopiert; die Schutzfunktion selbst lief unverändert und verweigerte weiterhin. Kein `--force`.

Die Differenz besteht aus **272 entfernten eigenen Ledger-Knoten**, **79 fehlenden AST-IDs** und **324 neuen AST-IDs**: `5201 - 272 - 79 + 324 = 5174`. Deshalb wäre eine Erklärung ausschließlich über Traceability unvollständig. Vollständige Liste der 79 Nicht-Ledger-IDs sowie Hashes in `2026-11-13-graphify-evidence.json`; Ausgangsgraph enthält `built_at_commit=2919afe662de6c739c116c32ad8a2ee490e6e13c` und ist älter als der reproduzierte Quellstand.

Ein konkreter weiter existierender Symbolfall: `src/renderer/components/ColorPicker.vue` enthält in `ac86d5f` und `7781fa5` die Definitionen `current` und `hueColor` (Zeilen 20/21). Der Ausgangsgraph hat `components_colorpicker_current` und `components_colorpicker_huecolor`; aktuelle direkte `graphify.extract.extract_js(Path(...ColorPicker.vue))` erzeugt nur den Dateiknoten, keine Kanten und keine Aufrufe. Das ist eine reproduzierte Vue-SFC-Extraktionslücke, keine legitime Symbollöschung. Der Fall ist als getrenntes Folgeissue [#183](https://github.com/J-ARTS/de.sketchdraw.io/issues/183) erfasst (außerhalb des ursprünglichen Ticketumfangs). Der Wrapper stellt historisch bereits verlorene Symbole nicht wieder her.

Ein zweiter tatsächlicher temporärer Rebuild auf dem heutigen Ausgangsgraphen reduzierte 6.490 auf 6.254 Knoten: 304 eigene Ledger-Knoten verloren (294 Artefakte, 10 Bedenken), 68 AST-Knoten neu, keine alte Nicht-Ledger-ID verloren. Der separate source-only Neuaufbau bestätigte die noch vorhandenen Codeknoten.

## Begrenzte Korrektur

`tools/graphify-update.py` trennt ausschließlich `_traceability_owner=sketchdraw-work-ledger-v1` vor der Extraktion ab und verwendet die bestehende kanonische Ledger-Projektion danach erneut. Kein Patch der global installierten Graphify-Bibliothek, kein Force und keine gelockerte Knotensicherheit.

- Sowohl `GRAPHIFY_OUT` als auch das Prozessarbeitsverzeichnis liegen im temporären Bereich. Das ist nötig, weil Upstream `detect._MANIFEST_PATH` relativ zum CWD schreibt. Ein erster explorativer Lauf nur mit `GRAPHIFY_OUT` hatte deshalb das lokale Manifest aktualisiert; dieser Seiteneffekt wurde Root sofort gemeldet. Es erfolgte kein blindes Zurücksetzen der vorher bereits fremd geänderten Datei. Alle weiteren Probeläufe isolierten beide Pfade.
- Fremde Knoten/Metadaten bleiben Ausgangsbasis. Fremde Kanten oder Hyperedges auf die abgetrennten eigenen Knoten führen zum Fehler.
- Nach Upstream-Erfolg müssen **alle vorherigen Nicht-Ledger-IDs** weiterhin vorhanden sein, selbst bei steigender Gesamtzahl. Graph-Typänderungen werden abgewiesen. Legitime Quelllöschungen verlangen einen gesonderten Abgleich; der Wrapper erteilt keine automatische Freigabe.
- Vor Veröffentlichung werden Ledger, Git-erfasste Eingaben und bestehende Graphausgaben erneut verglichen. Änderungen während der Extraktion führen zum Fehler.
- `--check` führt die gleiche Extraktion/Validierung ohne Veröffentlichung aus. Normaler Lauf schreibt jede Datei atomar, die gesamte Dateigruppe bleibt eine dokumentierte nichtatomare Transaktion. Graphschreiber müssen seriell laufen.
- `built_at_commit` stammt vom wirklichen Repository, nicht aus dem temporären CWD. Der Graph beschreibt trotzdem den geprüften Arbeitsbaum; ein Commitstempel allein bestätigt keine saubere Arbeitskopie.

Dokumentierter Ablauf in `docs/graphify-traceability.md`: `python3 tools/graphify-update.py`, danach `python3 tools/graphify-links.py`, danach `python3 tools/graphify-links.py --check`.

## Nachweise und Abschlussgrenze

`python3 -m unittest discover -s tools/tests -v`: **30/30 bestanden**, darunter acht neue Prüfungen für isolierte Ausgabe, Eigentümergrenzen, verborgenen Knotenverlust bei Gesamtwachstum, Fehler/Dry-run ohne Schreibeffekt und parallele Eingabe-/Ledger-/Graphänderungen. Letzter Log `/tmp/sketchdraw-145-python-final.log`.

Ein tatsächlicher `python3 tools/graphify-update.py --check` bestand: 4.056 Quellknoten plus 2.555 eigene Ledger-Knoten, keine vorherige Nicht-Ledger-ID verloren, kein Force. Log `/tmp/sketchdraw-145-wrapper-check.log`. Der Arbeitsbaum entwickelte sich danach parallel weiter; dieser Probelauf ersetzt nicht Roots finalen seriellen Update-/Merge-/Check-Lauf.

Reproduktionslogs: `/tmp/sketchdraw-145-historical.log`, `/tmp/sketchdraw-145-historical-capture.log`, `/tmp/sketchdraw-145-capture.log`, `/tmp/sketchdraw-145-vue-extract.json`. Dauerhafte Zähl-/Hash-/ID-Evidenz in `2026-11-13-graphify-evidence.json`.

#145 ist fachlich zur Integration vorbereitet. Vor Abschluss erforderlich: Code integrieren, finalen Wrapperlauf im stabilen Arbeitsbaum durchführen, Ledger erneut mischen und `--check` bestätigen; Vue-Extraktionsfolgefehler #183 getrennt weiterführen. Tatsächliche Fable-Nachprüfung des Wrappers ist im gemeinsamen Folgeaudit abgeschlossen; Details und Codex-Gegenprüfung unten.

## Fable-Folgereview und Gegenprüfung

Original: `2026-11-13-interop-fable-followup.md`, Metriken `.json`, Sitzung `0741b543-de19-44b1-bfc6-99048bffebdf`, tatsächliches `claude-fable-5-2`, erfolgreich beendet. Keine Tests durch Fable.

- Veraltete rohe Update-Anweisungen in AGENTS/CLAUDE: bestätigt; Root zur koordinierten Änderung übergeben.
- Fehlender operativer Abgleichpfad für legitime Löschungen: dokumentierter manueller Ablauf in `docs/graphify-traceability.md` ergänzt (gesicherte Basis, vollständige ID-Differenz, konkrete Quellenbelege, unabhängige Prüfung, exakt begrenzte Basisanpassung, erneute Wrapper-/Merge-/Check-Prüfung). Kein neues pauschales Akzeptieren und kein Force.
- Doppeltes Lesen des Ausgangsgraphen konnte ein kleines Race-Fenster übersehen: bestätigt und korrigiert, `before["graph.json"]` verwendet die zuerst gelesenen Bytes. Regression bewahrt eine Änderung exakt zwischen beiden Lesezeitpunkten.
- UTF-8-Dekodierung erst während Veröffentlichung konnte Teiländerungen erzeugen: bestätigt und korrigiert, sämtliche Ausgaben werden vor dem ersten Schreiben dekodiert. Regression mit ungültigem Reportbyte prüft unveränderte Live-Dateien.
- Office-/Google-Konvertierung kann in Upstream an `root/graphify-out/converted` schreiben: relevante Formate im sichtbaren Projektkorpus per Dateisuche nicht vorhanden, daher keine tatsächlich ausgelöste Nebenwirkung dieses Audits. Der Wrapper ist für diesen Repository-Quellbestand geprüft; neu hinzukommende konvertierbare Dokumente oder eine Graphify-Versionsänderung verlangen erneute Prüfung. Kein universeller Sandboxvertrag behauptet.
- Kanten-/Hyperedge-Semantik ist keine vom Wrapper neu garantierte Vollständigkeit. Vorhandene fremde Endpunktreferenzen werden validiert; der aktuelle Graph hat keine Hyperedges. Der von Fable vermutete Verlust eines ausschließlich unter graph.hyperedges gespeicherten Felds ist im einfachen Fall durch den schon vorhandenen Merge alter Graphmetadaten verhindert; ein allgemeiner Semantiktest wird daraus nicht abgeleitet. Quellenknotenverlust wird unabhängig von Gesamtwachstum geprüft. Die bestätigte Vue-Extraktionslücke bleibt #183.

Nach beiden Wrapperkorrekturen 30 Python-Tests bestanden; Root führt den tatsächlichen finalen Wrapperlauf seriell aus. Kein dritter Fable-Lauf für die kleinen Nachkorrekturen behauptet.
