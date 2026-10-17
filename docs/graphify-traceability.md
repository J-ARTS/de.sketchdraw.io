# Tickets, Agentenläufe und Aufwand in Graphify

Zu [Issue #7](https://github.com/J-ARTS/de.sketchdraw.io/issues/7). GitHub bleibt die maßgebliche Quelle für Ticketstatus und Übergaben. `agent-state/work-ledger.json` ist der lokale, explizit gepflegte Snapshot. Der Adapter synchronisiert weder GitHub noch Abrechnungsdaten automatisch.

## Erzeugen und abfragen

Im Repository-Verzeichnis mit Python 3.9 oder neuer ausführen; der Adapter benötigt ausschließlich die Standardbibliothek:

```sh
python3 tools/graphify-links.py
python3 tools/graphify-links.py --check
graphify query 'Run codex-graph-001' --context traceability --budget 4000
graphify path 'Ticket #7:' 'Tool codex-subagent'
graphify path 'Tool codex-subagent' 'Run codex-graph-001'
graphify path 'Ticket #7:' 'Ist-Aufwand codex-graph-001:'
```

Die letzte Abfrage zeigt die direkte Zuordnung `Ticket → Run → Ist-Aufwand`. Zusätzlich existiert die Verbindung `Ticket → Tool → Run → Ist-Aufwand`. Die direkte Ticket/Run-Kante ist erforderlich: Ein gemeinsam genutztes Tool beweist allein nicht, dass jeder seiner Läufe zu jedem benachbarten Ticket gehört.

Graphify 0.8.44 sucht bei `path` über Labels; eine übergebene technische Knoten-ID wurde in der lokalen Prüfung mehrdeutig aufgelöst. Die obigen Labels wurden erfolgreich geprüft. Die Textausgabe von `query` auf einem ungerichteten Graphen kann die Besuchsrichtung statt der gespeicherten Kantenrichtung anzeigen. Für gerichtete Aussagen die `source`-/`target`-Werte in JSON oder die Pfeile von `path` verwenden.

Generierte Dateien:

| Datei | Inhalt |
| --- | --- |
| `graphify-out/graph.json` | Bestehender Graph plus aktuelle Traceability-Projektion; Standarddatei für Graphify |
| `graphify-out/traceability.json` | Eigenständiger Traceability-Graph, auch mit `--graph` abfragbar |
| `graphify-out/effort-summary.json` | Getrennte Planwerte und konservative Summen mit Messabdeckung |

`--ledger PFAD` und `--graph PFAD` erlauben andere Eingaben/Ziele. Die beiden Nebenprodukte werden neben der gewählten Graphdatei gespeichert. Bei identischen Eingaben ist der Inhalt bytegleich. Die Uhrzeit der Ausführung fließt nicht in den Graph ein.

Ledger, Graphdatei und beide Nebenprodukte müssen vier unterschiedliche Dateien bezeichnen. Vor dem Einlesen und Schreiben werden alle Pfade aufgelöst und einschließlich symbolischer Links sowie bestehender Hardlinks auf Kollisionen geprüft. Deshalb wird beispielsweise `--graph /tmp/x/traceability.json` mit Fehlercode `1` abgelehnt, statt die Graphdatei durch das Nebenprodukt zu ersetzen. Auch `--check` lehnt solche Aufrufe ab. Die Graphdatei darf als bestehende Eingabe zugleich das Ziel ihres eigenen Merges sein; sie darf keine andere Dateifunktion übernehmen.

## Nach Änderungen aktualisieren

Nach Codeänderungen zuerst den Codegraph erneuern, anschließend den Ledger erneut einmischen:

```sh
graphify update .
python3 tools/graphify-links.py
python3 tools/graphify-links.py --check
```

Die Befehle nacheinander ausführen und Fehler prüfen. `graphify update` kann Graphattribute und Cluster neu erzeugen. Der anschließende Merge stellt sämtliche Traceability-Metadaten und Links aus dem Ledger wieder her; die eigene Projektion hängt nicht vom Verhalten einer bestimmten Graphify-Version ab. Das gilt auch, wenn ein vollständiger Neuaufbau alle Traceability-Knoten entfernt hat. Kein `--force` ist für den normalen Ablauf nötig.

Bei reinen Ledger-Änderungen genügt `python3 tools/graphify-links.py`. Werden Report oder Visualisierung benötigt, können sie nach dem Merge mit `graphify cluster-only . --no-label` neu erstellt werden. Danach den Adapter erneut ausführen, um die kanonischen Metadaten und den `--check`-Stand wiederherzustellen. `GRAPH_REPORT.md` und `graph.html` sind zusätzliche Graphify-Sichten und können bis dahin einen älteren Stand zeigen.

Der Adapter ersetzt ausschließlich mit `_traceability_owner=sketchdraw-work-ledger-v1` markierte Datensätze. Andere Knoten, Kanten, Hyperedges und Graphmetadaten bleiben erhalten. Kollidierende fremde IDs oder fremde Kanten auf einen inzwischen entfernten Traceability-Knoten lösen einen Fehler aus; sie werden nicht stillschweigend gelöscht. Das normalisierte Ausgabeformat verwendet `links`, akzeptiert als Eingabe auch `edges` und erhält die vorhandenen `directed`-/`multigraph`-Einstellungen.

Mehrere Kanten mit denselben Endpunkten werden bei `multigraph: false` vor der Ausgabe abgelehnt: Ein Graph-Loader würde sonst eine der Relationen überschreiben. Bei `directed: false` gelten auch umgekehrte Endpunktpaare als identisch. Bereits als Multigraph deklarierte Graphen behalten parallele Kanten mit verschiedenen Schlüsseln; kollidierende Schlüssel werden ebenfalls abgelehnt. Der Adapter ändert den Graphtyp nicht automatisch.

Hyperedges werden sowohl unter `hyperedges` als auch unter `graph.hyperedges` geprüft. Jeder Eintrag muss ein `nodes`- oder `members`-Array mit vorhandenen Knoten-IDs enthalten; wenn beide Felder existieren, werden beide geprüft. Unbekannte Hyperedge-Strukturen oder Verweise auf entfernte Runs führen vor dem Schreiben zu einem Fehler. Der Verantwortliche muss die betroffene Beziehung im Quellgraphen prüfen und ausdrücklich korrigieren; der Adapter entfernt sie nicht automatisch.

Die Graphdatei wird atomar ersetzt. Der Adapter prüft vor dem Schreiben, ob Ledger oder Graph seit dem Einlesen geändert wurden. Das ersetzt keine gemeinsame Schreibsperre: Generator, Graphify-Watcher und andere Graphschreiber dürfen nicht gleichzeitig laufen. Mehrere Ausgabedateien bilden keine atomare Transaktion; nach Abbruch erneut generieren und `--check` ausführen.

## Datenvertrag und Aufwand

`schemaVersion` ist `1`. `repository` und `updatedAt` sind Pflichtfelder; Zeitstempel enthalten eine Zeitzone. `issues` und `runs` sind Arrays. Issue-Nummern und Run-IDs müssen eindeutig sein; jeder Dependency-/Run-Verweis muss auf ein vorhandenes Issue zeigen. Fehler werden vor dem Schreiben abgewiesen.

| Datensatz | Pflichtinhalt |
| --- | --- |
| Issue | `number`, `title`, `url`, `owner`, `phase`, `status`, `dependencies`, `estimatedEffort` |
| Planaufwand | `kind: planning_estimate`, `unit: story_points`, `value: Zahl oder null` |
| Run | `id`, `tool`, `issues`, `status`, `observedSeconds`, `tokens`, `costUsd`, `artifacts`, `concerns` |
| Optionale Run-Angaben | `model`, `startedAt`, `endedAt`; unbekannt als `null` |

Die Messfelder enthalten endliche, nicht negative Zahlen oder ausdrücklich `null`; `tokens` ist eine Ganzzahl für die vom Aufrufer gemeldete Gesamtzahl. Der Adapter schätzt keine Tokens aus Textlänge und keine Kosten aus Modellnamen. `observedSeconds` wird nicht aus Start-/Endzeit berechnet. Bei einem künftig dokumentierten Erfassungsverfahren kann der Koordinator einen tatsächlich beobachteten Wert eintragen und dessen Herkunft als Artefakt belegen.

`artifacts` und `concerns` akzeptieren nicht leere Strings oder Objekte mit mindestens einem der Felder `path`, `url`, `id`, `summary`, `title`, `description`. Zusätzliche Felder bleiben im Knoten erhalten. Ein Artefaktverweis bestätigt weder Existenz noch bestandene Tests. Bedenken und Ergebnisse tragen `recorded_unverified`, bis ein anderer Prozess sie unabhängig prüft; der Adapter selbst befördert keine Aussage zu geprüftem Produktwissen.

Aufwand wird wie folgt ausgewiesen:

- Story Points bleiben Planwerte. Es gibt keine Umrechnung in Zeit, Tokens oder Geld.
- Die globale Summe und jede Tool-Summe zählen jede eindeutige Run-ID genau einmal.
- Ein Run mit mehreren Issues wird bei allen betroffenen Issues unter `sharedUnallocatedRunIds` aufgeführt. Seine Messwerte werden keinem Issue zugeschlagen oder gleichmäßig verteilt.
- `exclusiveRuns` enthält nur Läufe, die genau diesem einen Issue zugeordnet sind. Die Summe der exklusiven Issue-Werte kann deshalb kleiner als die globale Summe sein.
- Jede Messgröße enthält `knownSubtotal`, `knownRuns`, `unknownRuns` und `total`. Sobald ein Wert unbekannt ist, bleibt `total: null`. Auch eine leere Laufmenge hat keinen gemessenen Gesamtwert. Ein explizit gemeldeter Wert `0` bleibt dagegen ein bekannter Wert.
- Summierte Laufsekunden sind Laufzeiten der gemeldeten Runs. Sie sind weder Personenstunden noch die verstrichene Projektzeit; parallele oder verschachtelte Läufe können zeitlich überlappen. Unterschiedliche IDs beweisen keine disjunkten Arbeitsintervalle.

## Provenienz und Grenzen

Technische IDs beginnen mit `traceability:`. Tickets und Planwerte gehören zum Teilgraphen `task-plan`, Zuständigkeitsangaben und Tools zu `agent-tool-capability`, Runs zu `resource-operational`, Messwerte zu `evaluation-feedback`, Artefakte zu `artifact-traceability` und Bedenken zu `claim`.

Jeder erzeugte Knoten und jede Kante enthalten Quelldatei, JSON-Pointer, SHA-256 des Ledger-Snapshots, Extraktorversion, `timestamp`, `confidence`, `confidence_score`, `validation_state` und `review_status`. Zusammengeführte Links halten alle Quellverweise in `evidence`. Der Zeitstempel stammt aus `updatedAt`; seine Pflege liegt beim Ledger-Verantwortlichen. `--check` vergleicht den aktuellen Dateiinhalt und erkennt veraltete generierte Dateien auch dann, wenn jemand den Zeitstempel nicht aktualisiert hat.

`EXTRACTED` mit `confidence_score: 1.0` bedeutet ausschließlich, dass der Datensatz deterministisch aus dem genannten Snapshot übernommen wurde. `schema_validated` bestätigt Format und Referenzintegrität, nicht die Wahrheit des Ticketstatus, die Qualität eines Agentenergebnisses oder die Richtigkeit einer Aufwandserfassung. Alle Datensätze bleiben `operational_only`; `official_score_claim_ready` ist stets `false`.

`owner` wird als wörtliche Zuständigkeitsangabe übernommen. Aus `Antigravity + Claude Code` oder `Claude Code / Codex-Recherche` werden keine individuellen Ausführungen erfunden. Ein tatsächlicher Lauf ist nur über einen expliziten `runs`-Eintrag belegt. `tool` bezeichnet den gemeldeten Ausführungsweg; eine Modellidentität wird nicht daraus abgeleitet.

Die Projektion enthält den aktuellen Snapshot; sie ersetzt kein unveränderliches Ereignisprotokoll. Frühere Statusstände und Übergaben bleiben gemäß Projektworkflow in GitHub und in versionierten Ledger-Ständen nachvollziehbar. Keine automatische Promotion in einen Domain-Wissensgraphen oder offiziellen Benchmark, keine automatische Abrechnung, keine globalen Graphify-Änderungen.

## Prüfen

```sh
python3 -m unittest discover -s tools/tests -v
python3 tools/graphify-links.py --check
```

Die Tests prüfen Referenzintegrität, ungültige Messwerte, unbekannte Werte, bekannte Nullen, geteilte Läufe, doppelte Run-IDs, Fremdknotenerhalt, wiederholte Merges, das Ersetzen veralteter Projektionen, Wiederherstellung nach einem Codegraph-Neuaufbau und die Erkennung veralteter Ausgaben. Regressionstests decken zudem kollidierende Eingabe-/Ausgabepfade einschließlich Links, verlustgefährdete parallele Kanten und verwaiste Hyperedge-Verweise ab. Bei diesen Fehlerfällen müssen die vorhandenen Dateien bytegleich erhalten bleiben.

Die EvoCodeGraph-Skills sehen für ein vorhandenes `kg-bench`-Rust-Projekt zusätzliche `cargo run`-Prüfungen vor. Dieses Repository enthält diesen Harness nicht. Hier gelten die genannten Python-Prüfungen und die realen Graphify-CLI-Abfragen; daraus entsteht kein offizieller Benchmark-Nachweis.
