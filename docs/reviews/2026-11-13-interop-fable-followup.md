Tatsächlicher unabhängiger Claude-Code-Folgereview, CLI 2.1.323, Modell claude-fable-5-2, Effort high. Sitzung `0741b543-de19-44b1-bfc6-99048bffebdf`; Read/Glob/Grep, keine Tests oder Edits. Resultat `success`, `is_error: false`. Originalbericht vor Codex-Nachkorrekturen; Gegenprüfung in `2026-11-13-interop-audit.md` und `2026-11-13-graphify-audit.md`. Metriken in `2026-11-13-interop-fable-followup.json`.

**Urteil:** Kein Blocker in #155, #156, #180 und im Wrapper-Code. Für #145 bleiben zwei P2-Punkte im Workflow, der Rest ist P3 oder spekulativ. Ich habe nur statisch gelesen und keine Tests ausgeführt. `graphify query` (per Hook verlangt) lief nicht, weil mir nur Read/Glob/Grep zur Verfügung stehen.

## Befunde

**P2 – #145: Verbindliche Anweisungen nennen weiterhin den unsicheren Befehl**
- **Fundstelle:** `CLAUDE.md:81`, `AGENTS.md:184` und `AGENTS.md:191` schreiben `graphify update .` vor; nur `docs/graphify-traceability.md:39` nennt den Wrapper.
- **Fehlerfall:** Ein Agent folgt CLAUDE/AGENTS und startet das rohe Update auf dem gemischten Live-Graphen. Upstream verweigert nur bei Netto-Schrumpfung (`graphify/watch.py:373`). Sobald der Zuwachs den Kollaps übersteigt, wird der kollabierte Graph live geschrieben, ohne Nicht-Ledger-Prüfung.
- **Fix:** Die drei Zeilen auf `python3 tools/graphify-update.py` umstellen.

**P2 – #145: Kein Freigabeweg für die gewollte Blockade bei Löschungen**
- **Fundstelle:** `tools/graphify-update.py:43-46`; `docs/graphify-traceability.md:46` sagt nur „getrennt abgeglichen“.
- **Fehlerfall:** Upstream verwirft beim Vollaufbau jeden nicht erneut extrahierten AST-Knoten (`watch.py:614-620`). Jedes entfernte oder umbenannte Symbol blockiert den Wrapper daher dauerhaft. Bei Schrumpfung reicht der Wrapper zudem Upstreams Hinweis „Pass --force to override“ durch (`watch.py:380`), was zur Umgehung einlädt. Die Fehlermeldung zeigt nur zehn IDs (`:45`).
- **Fix:** Verfahren dokumentieren oder `--accept-removed DATEI` ergänzen, das nur bei exakter Mengengleichheit mit den fehlenden IDs veröffentlicht; in `--check` die volle Liste ausgeben.
- **Test:** Exakte Menge veröffentlicht; Teil- oder Obermenge bricht bytegleich ab.

**P3 – #145: `graph.json` wird zweimal gelesen**
- **Fundstelle:** `tools/graphify-update.py:74` und `:80`.
- **Fehlerfall:** Ändert sich die Datei dazwischen, vergleicht die Race-Prüfung (`:122`) gegen den neueren Stand. Der Wrapper veröffentlicht dann einen Merge auf Basis des älteren `previous`.
- **Fix:** `before["graph.json"] = original`.

**P3 – #145: Dekodierung innerhalb der Veröffentlichungsschleife**
- **Fundstelle:** `tools/graphify-update.py:127-128`.
- **Fehlerfall:** Eine nicht UTF-8-kodierte Staging-Datei wirft erst, nachdem `graph.json` und `manifest.json` bereits ersetzt sind.
- **Fix:** Alle Ausgaben vor dem ersten Schreiben dekodieren.

**P3 – #180: Mischfarbenvergleich unterscheidet Groß-/Kleinschreibung**
- **Fundstelle:** `src/interop/export.ts:268`; die Domain erlaubt beide Schreibweisen (`src/domain/validation.ts:201`), der Export normalisiert klein (`src/interop/common.ts:60`).
- **Fehlerfall:** `#ABCDEF` neben `#abcdef` erzeugt eine falsche `STYLE_APPROXIMATED`-Warnung samt `requiresConfirmation`.
- **Fix/Test:** Kleingeschrieben vergleichen; Test mit zwei gleichfarbigen Zellen in abweichender Schreibweise erwartet keine `table.colors`-Diagnose.

**P3 – #180: Warntext stimmt bei `embedDocument: false` nicht**
- **Fundstelle:** `src/interop/export.ts:269`.
- **Fehlerfall:** Der Text behauptet „remain in embedded metadata only“, obwohl nichts eingebettet wird; die übrigen Zellfarben gehen verloren.
- **Fix:** Text und `effect: 'omitted'` abhängig von `embed` setzen.

## Ohne Befund geprüft

- **#155:** Die Reihenfolge Textlimit → Split → Zellprodukt → Padding → Allokation stimmt (`src/interop/drawio.ts:342-350`). Die Padding-Summe entspricht exakt der Länge von `tablePlainText`, und der Split ist durch das Textlimit beschränkt.
- **#156:** `tableColor` erhält nur von `color()` normalisierte Werte und liefert für alle Zweige gültiges sechsstelliges Hex (`drawio.ts:151-163`).
- **#180:**
  - v1 nutzt ausschließlich die äußeren Farben (`export.ts:266-270`) und passt zur Fixture.
  - Der Vergleich läuft über die gesamte `mxfile`-Wurzel (`drawio.ts:184-186`).
  - Unbekannte oder formatfremde Versionen ergeben `EMBEDDED_MODEL_STALE` (`common.ts:168-170`).
  - `drawio-v2` entsteht nur über `prepareExport` für draw.io; SVG und Mermaid bleiben v1.
  - Ein Umetikettieren zwischen v1 und v2 besteht nur, wenn beide Projektionen ohnehin identisch sind.
- **Wrapper gegen Upstream 0.8.44 (installierter Quelltext):**
  - Ein absolutes `GRAPHIFY_OUT` lenkt Graph, Lock und Cache um (`watch.py:11,428`; `cache.py:282-283`).
  - Das Manifest liegt CWD-relativ (`detect.py:27`).
  - Die CLI endet bei Verweigerung mit Code 1 (`__main__.py:3358-3363`).
  - `GRAPHIFY_FORCE` wird aus der Umgebung entfernt (`graphify-update.py:94`).
  - Die Pfade „keine Änderung“ lassen den Staging-Graphen unverändert und sind damit unkritisch.

## Spekulative Grenzen

- **Live-Schreibzugriff trotz Staging:** Die Office-/Google-Konvertierung schreibt fest nach `<root>/graphify-out/converted` (`detect.py:1084,1123`), auch bei `--check`. Unter `docs/` liegen keine solchen Dateien; den Rest des Repos habe ich nicht durchsucht. Die Nachprüfung des Wrappers deckt nur sieben Dateinamen ab.
- **Keine Versionsbindung:** Die obigen Upstream-Eigenschaften gelten nur für 0.8.44; eine Versionsprüfung im Wrapper wäre billig.
- **Nur Knoten-IDs werden verglichen:** Kanten und Hyperedges prüft der Wrapper nicht. Upstream erhält Kanten mit bestehenden Endpunkten und Top-Level-Hyperedges (`watch.py:622-629`). Der Live-Graph hat `"hyperedges": []`. Hyperedges, die nur unter `graph.hyperedges` liegen, gingen still verloren.
- **v1-Validierung für andere Elementarten:** Sie ist nur so exakt wie der heutige Exporter. Die Fixture deckt Tabelle und Rechteck ab; einen Diff gegen HEAD konnte ich ohne Git nicht ziehen. Eine Abweichung fiele auf Nativimport zurück, also fail-safe.
- **v0.1.1 und `drawio-v2`:** Die veröffentlichte Version dürfte neue Exporte nur als Nativimport öffnen; den alten Lesercode habe ich nicht gesehen.
- **Kosmetik und Laufzeit:** `GRAPH_REPORT.md` verliert die Zeile „Built from commit“, weil `_git_head()` im Staging-Verzeichnis läuft (`watch.py:183`). Der Snapshot hasht alle unversionierten Dateien zweimal, auch `artifacts/`.

**Konfidenz:** Mittel bis hoch für die TypeScript-Pfade, weil ich alle genannten Funktionen und Tests vollständig gelesen habe. Mittel für den Wrapper: Upstream habe ich nur an den genannten Stellen statisch geprüft, die Deduplizierung in `build_from_json` nicht.
