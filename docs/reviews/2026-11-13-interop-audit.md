# Abnahme #153–#157 und Folgefehler #180 am 13.11.2026

Verantwortung: Codex-Root koordiniert Zielbranch, GitHub und Abschluss; delegierter Codex-Prüfer `interop_audit` führt Gegenprüfung und vorübergehende Implementierung aus. Tatsächliches externes Sparring: Claude Code 2.1.323, `claude-fable-5-2`, Effort `high`, ausschließlich Read/Glob/Grep. Fable hat keine Tests ausgeführt. Keine Commits, Pushes oder Ticketabschlüsse durch diesen Prüfer.

Geprüfte Basis: `main` bei `8df300656e28f6a7fb19ae9f6185ae236725fc9c`. Vorhandene parallele Änderungen anderer Prüfer erhalten. Die bisherigen Interop-Korrekturen aus `bdfbb20` sind Vorfahren dieses Stands; die anfänglichen Kernquellen und Regressionen entsprachen den Prüfsummen in `153-local-validation.json`. Graphify wurde zuerst gezielt abgefragt; die Treffer lieferten zu wenig spezifischen Kontext, daher folgte Quellprüfung.

## Kriterienentscheidung

| Ticket | Befund / Abnahme | Noch erforderlicher Schritt |
| --- | --- | --- |
| #153 | SVG, draw.io und Mermaid-Flowchart im bestehenden Panel erreichbar; echte Downloads, Vorschau/Bestätigung, Abbruch, Seitenauswahl und zugängliche Bedienung durch 13 aktuelle UI-Tests bestätigt. Bestehende Konvertierungs-, Sicherheits-, Ressourcen- und Plattformregressionen bestanden. Tatsächliches Fable-Sparring erzeugte drei bestätigte Tabellenbefunde, jetzt korrigiert. | Root integriert die neuen Korrekturen und nimmt die Gesamtprüfung ab. |
| #154 | Eigenes Modell wird auch bei späterer Seite aus Seite 1 gelesen, gegen den sichtbaren Baum sämtlicher Seiten geprüft und erst danach auf die Auswahl begrenzt. Manipulationen auf beiden Seiten verwerfen Metadaten. Neue v1/v2-Prüfungen erhalten dieses Verhalten. | Root-Abgleich nach Integration. |
| #155 | Bestehende Zellproduktgrenze greift vor der Factory. Neuer Randfall: Sparse-Label mit 49.997 Zeichen erzeugt durch Padding 50.015 Zeichen; nun vor Factory mit `LIMIT_EXCEEDED` abgewiesen. Regression überwacht tatsächliche Factory-Aufrufe. | Neue lokale Änderung integrieren. |
| #156 | Schriftfarbe unabhängig vom Rand; neue Normalisierung deckt `#rgb`, `#rgba`, `#rrggbbaa`, `rgb()` und `rgba()` ab. Zellvertrag bleibt sechsstelliges opakes Hex. Alpha/Transparenz und Bruchteile werden ausdrücklich angenähert. | Neue lokale Änderung integrieren. |
| #157 | Fehlende/unaufgelöste Schriftfarbe erhält unabhängiges Schwarz mit Theme-Hinweis; explizite Farben und unveränderte eigene Modelle bleiben erhalten. Shapes/Text/Tabellen und unveränderter eigener Roundtrip geprüft. | Root-Abgleich; kein zusätzlicher Produktfix nötig. |
| #180 | Exportfehler unabhängig reproduziert und minimal korrigiert: Zellschrift/-füllung statt äußerem Tabellenstil; getrennte Kontur bleibt erhalten. Alte v1-Dateien bleiben verifizierbar, neue v2-Dateien verwenden neue Projektion. | Integration und Root-Abnahme; unabhängige Nachprüfung abgeschlossen. |

Der in den Tickets genannte ältere CI-Blocker ist veraltet: Der über GitHub ausgelesene aktuelle Lauf [43388981883](https://github.com/J-ARTS/de.sketchdraw.io/actions/runs/43388981883) auf `8df3006` hat fünf erfolgreiche Jobs, einschließlich Windows/Linux/macOS, UI/Electron/Verzeichnispaket und P2P. Diese CI bestätigt die Basis, nicht die neuen lokalen Änderungen dieses Audits.

## Fable-Befunde und unabhängige Gegenprüfung

Originalbericht: `2026-11-13-interop-fable.md`; tatsächliche Metriken: `2026-11-13-interop-fable.json`. Sitzung `f9c4893e-d23e-4684-8a7b-76dd039d34c1`, tatsächliches Modell aus Assistant-Ereignissen `claude-fable-5-2`, Resultat `success`, `is_error: false`, 44 Turns, 474.973 Sekunden. CLI meldet 5.8534772 USD Listenpreis; das ist kein Zahlungsbeleg. Ein gemeinsamer Reviewlauf, keine mehrfache vollständige Zuweisung des Aufwands an jedes Ticket.

- **F1, P2 bestätigt (#156):** Unterstützte fremde Farbschreibweisen wurden unverändert an den engeren Zellvertrag weitergereicht und verursachten `INVALID_DOCUMENT` für die ganze Datei. Zehn Farbregressionen scheiterten vor der Änderung. Normalisierung liegt nun unmittelbar vor der Zuweisung an Zellstile; transparente Tinte/Füllung verwendet Schwarz/Weiß mit Diagnose, Teilalpha erhält den Farbton opak mit Diagnose.
- **F2, P2 bestätigt (#180):** Die Standardtabelle projizierte äußere Kontur `#cbd5e1` als Schrift, während Zellen `#242424` verwenden. Fünf von acht neuen Exportfällen schlugen vor dem Fix fehl. Erste sichtbare Zelle liefert nun Schrift/Füllung; Mischfarben lösen `STYLE_APPROXIMATED` auf `table.colors` aus. Die exakt formatierte Tabelle bleibt in Metadaten. Das bestehende flache native Tabellenmodell wird nicht erweitert.
- **F3, P3 bestätigt (#155):** Padding-Tabs konnten das Textbudget erst nach Allokation überschreiten. Die zusätzliche Budgetrechnung berücksichtigt `sum(columnCount - row.length)` vor `createTableDocument`. Der Repro scheiterte vor der Korrektur, danach bestanden; kein Factory-Aufruf im abgelehnten Fall.
- **F4, P3 geprüft, kein weiterer Blocker (#157):** Viele fehlende Schriftfarben verbrauchen das begrenzte Diagnosebudget. `DiagnosticCollector.finalize()` fügt bei Kürzung ausdrücklich `DIAGNOSTICS_TRUNCATED` als Warnung hinzu. Es entsteht keine Behauptung verlustfreier Konvertierung und kein stilles Übergehen von Bestätigung. Eine andere Priorisierung wäre eine optionale UX-Verbesserung, kein unbehobener Datenfehler.
- Weitere Reviewhypothesen (Mermaid-Pfeilvarianten, bewusst begrenzte Syntax, große Metadaten) wurden nicht als bestätigte Fehler übernommen. Keine allgemeine Mermaid-Kompatibilität oder identische Fremd-Layouts behauptet.

## Projektionsvertrag #180

Die Envelope-Struktur bleibt `format=sketchdraw-interop`, `version=1`, `encoding=base64-json`; ausschließlich neue draw.io-Exporte erhöhen `projection` auf `drawio-v2`. SVG/Mermaid bleiben bei ihren bestehenden Projektionen. `decodeEnvelopeWithProjection` akzeptiert nur die bekannten Format-/Versionskombinationen.

`drawio-v1` wird ausschließlich mit der alten äußeren Tabellenfarbe rekonstruiert; `drawio-v2` ausschließlich mit der neuen Zellfarbe. `drawioProjectionForValidation` ist ein interner Prüfpfad, keine Option für normale Exporte. Beide vergleichen den vollständigen sichtbaren XML-Baum. Es gibt kein blindes Vertrauen in Metadaten, keinen allgemeinen Versionsfallback und keinen Versuch, externe sichtbare Änderungen durch alte Metadaten zu überschreiben.

Die Fixture `tests/unit/interop/fixtures/table-colors-v1.drawio` wurde vor der Exportänderung mit dem unveränderten v1-Exporter erzeugt. Sie enthält Tabellenzellfarben, eigene IDs/Metadaten und zwei Seiten. Regressionen prüfen v1-Restore, v2-Restore, Seitenmanipulationen, falsche/ unbekannte Version, Farbänderung bei stale Envelope, portablen Rückimport und Mischfarben.

## Tatsächliche Prüfungen

Umgebung macOS 14.6.1 arm64, Node 22.16.0. Tests durch Codex, nicht durch Fable. Die Logs liegen lokal unter `/tmp`; Quellhashes und Ergebniszusammenfassung in `2026-11-13-interop-validation.json`.

| Prüfung | Ergebnis |
| --- | --- |
| Anfängliche Interop-/Mermaid-Plattform-Units | 10 Dateien / 138 Tests bestanden. |
| Neue Importregressionen vor Fix | 11 fehlgeschlagen, 18 bestanden; erwartetes Rot. |
| Interop nach F1/F3-Korrektur | 10 Dateien / 149 Tests bestanden. |
| Neue #180-Regressionen vor Fix | 5 fehlgeschlagen, 3 bestanden; erwartetes Rot. |
| `npm run test:unit -- tests/unit/interop tests/unit/platform/mermaid-export.spec.ts` nach allen Produktfixes | 11 Dateien / 159 Tests bestanden einschließlich beider Nachreview-Regressionen; `/tmp/sketchdraw-interop-final-unit.log`. |
| Interop-UI nach Kernfixes, vor den beiden kleinen Diagnosekorrekturen | 13/13 bestanden, 23.8 Sekunden; isolierte temporäre Playwright-Konfiguration auf Port 5187, gleiche Tests/Browser/Assertions, `/tmp/sketchdraw-interop-final-ui.log`. |
| `npm run typecheck` | Fehlgeschlagen durch parallel bearbeitete MCP-Typabweichung `src/mcp/server.ts:39`, `DocumentConnection` gegenüber `AgentClient`; an Root übergeben. Interop-Änderungen ohne dabei gemeldete Typfehler. Root hat anschließend den korrigierten Gesamt-Typecheck und 48/48 MCP-Tests erfolgreich bestätigt; der frühere Fehlversuch bleibt als Verlauf erhalten. |
| `git diff --check` für eigene Bereiche | Bestanden. |

Windows/Linux, Installer, Veröffentlichung und allgemeine Fremdprogramm-Layouttreue wurden für diese neuen lokalen Änderungen hier nicht erneut ausgeführt. Vorhandene historische 19 Mermaid-Referenzparserfälle sind frühere Nachweise, kein neuer Lauf. Root übernimmt abschließende Gesamtprüfung und Integration.

## Unabhängiger Folgereview und letzte Korrekturen

Tatsächlicher Folgelauf `0741b543-de19-44b1-bfc6-99048bffebdf`, Modell `claude-fable-5-2`, 45 Turns, 386.089 Sekunden, `success`, `is_error: false`. Originalbericht und unveränderte CLI-Metriken: `2026-11-13-interop-fable-followup.md` / `.json`; gemeldeter Listenpreis 4.0630112 USD. Dieser gemeinsame Lauf umfasst #145/#155/#156/#180 und wird ebenfalls einmal gezählt.

Fable fand keine Blockade in Budget, Farbnormalisierung oder Versionsprüfung. Zwei kleine bestätigte Exportdiagnosefehler wurden danach korrigiert: Gleichfarbige Hexwerte unterschiedlicher Großschreibung erzeugen keine Mischfarbenwarnung mehr; beim portablen Export nennt die Warnung den tatsächlichen Verlust (`effect: omitted`), ohne eingebettete Metadaten zu versprechen. Zwei gezielte Regressionen und die vollständige Interop-/Plattform-Unitsuite bestehen nun mit 159 Tests. Die ursprüngliche v1-Projektion bleibt unverändert. Kein dritter Fable-Lauf für diese begrenzten Nachkorrekturen behauptet. Die UI wurde vor diesen beiden Diagnosekorrekturen geprüft; Root übernimmt den abschließenden Gesamtstand.

## Übergabe

Eigene Produktdateien: `src/interop/common.ts`, `src/interop/drawio.ts`, `src/interop/export.ts`; Regressionen `tests/unit/interop/153-review.spec.ts`, `tests/unit/interop/table-export.spec.ts`, `tests/unit/interop/fixtures/table-colors-v1.drawio`. Fachliches Ergebnisupdate in #180, Kommentar 6848065693. Der getrennte Graphify-Auftrag #145 ist in `2026-11-13-graphify-audit.md` dokumentiert. Unveröffentlichte Änderungen sind noch kein Ticketabschluss.
