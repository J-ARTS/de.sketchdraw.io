# #153 — SVG, Mermaid, draw.io Import/Export

- Status: in Arbeit, lokal auf bestehendem `codex/149-hyperdht-relay` / `bd610f6`. Vorherige P2P-Änderungen #149–#151 erhalten, nicht integriert.
- Nutzerauftrag: drei Formate importieren/exportieren und tatsächliches Fable-5.2/high-Sparring.
- SVG/draw.io existieren aus #12. Mermaid neu als ausdrücklich benannter editierbarer Flowchart-Adapter, keine Vollunterstützung aller Mermaid-Diagrammtypen behaupten.
- Besitz: lifecycle-Agent nur neue `src/interop/mermaid.ts`/Tests/Fixtures; guest-Agent nur InteropPanel/en.ts/UI-Tests; architecture-Agent nach Übergabe nur drawio.ts und eigene Regressionen; Root gemeinsame Typen, Plattform-/Electron-Vertrag, Plattformtests, Review/GitHub/Graph.
- Bestandsreview reproduziert #154 Verlust eigener Metadaten auf später gewählter draw.io-Seite und #155 unbeschränkte Tabellenallokation vor Validierung. Separate Issues vor Fix angelegt.
- Vertrag: importMermaid/prepareMermaidExport/exportMermaid synchron, bestehende Interop-Diagnosen und Bestätigung, .mmd/text/plain, Datenmodell in Kommentar nur bei unveränderter sichtbarer Projektion. Kein Live-DOM oder Codeausführen.
- Root-Plattformprüfung: 3 Suites / 12 Tests bestanden, `/tmp/sketchdraw-153-platform.log`; neue Mermaid-Dateibridge plus bestehende Exportbudgets und IPC-Schutz. Noch keine Mermaid-/UI-/Gesamtabnahme.
- Externes Fable-Sparring noch nicht gestartet. Wird erst auf konkretem Diff über vorhandene ClaudeCode2.1.321 ausgeführt, Modell/High-Effort protokollieren.
- Nächster Schritt: Adapter/Panel finalisieren, Repros korrigieren, Fable prüfen lassen, Findings gegenprüfen, Tests/Issue/Ledger/Graph nachführen.

## Zwischenabnahme

- Mermaid und Panel implementiert; vier zusätzliche Mitgliedschaftsregressionen nach Gegenprüfung mit tatsächlichem Mermaid12.3. Gruppen werden beim `end` geschlossen, spätere Referenzen entfernen keine Mitgliedschaft; zyklische/übertiefe Hierarchien abgewiesen.
- Bestätigt: vollständiger Typecheck; 99 Suites/804 Unit-Tests; 11 Interop-UI-, 7 Electron-, 61 Build-Lifecycle- und 22 Python-Tests; Build. Neue Electron-Stufe speichert alle drei Formate über echtes Renderer/Preload/IPC/Atomic-Persistence; nur OS-Dialogantwort isoliert.
- Offizieller Mermaid12.3-Parser/Graphdaten gegen acht synthetische Fälle geprüft, Beleg `docs/reviews/153-mermaid-reference.json`; kein Pixelrendering-Nachweis.
- #154, #155, #156 offen mit `status: review`, lokale Fixes geprüft, Zielbranchintegration ausstehend. Kommentare 6805970154 / 6805970735 / 6805970980.
- Tatsächlicher Claude Code2.1.321-Lauf Fable5.2/high läuft, Sitzung `a2327c2e-97f8-479d-b658-60aea0a73996`, ausschließlich Read/Grep/Glob. Root wartet auf abschließendes Ergebnis. Prompt `docs/reviews/153-fable-prompt.md`.
- Graphify-Codeupdate durch bestehenden Knotenschutz abgewiesen: 5.882 neue / 6.052 vorhandene Knoten. Kein Force; bekanntes #145. Finale Traceability nach abgeschlossenem Review folgt.

## Finale Übergabe

- #153–#157: lokale Implementierung und Abnahme abgeschlossen; GitHub-Status Review / Integration ausstehend. Kein Commit, Push, Merge oder Release dieser Änderung.
- Fable-Run `claude-153-fable-sparring`: tatsächlich ClaudeCode2.1.321 / claude-fable-5-2 / high / Sitzung a2327c2e-97f8-479d-b658-60aea0a73996, erfolgreich abgeschlossen; Originalbericht, Metriken und Codex-Disposition in docs/reviews. Nicht als Fable-Implementierung/Tests ausgeben.
- Alle sieben Befundgruppen unabhängig bewertet. Bestätigte Backend/UI/Standardfarbfehler korrigiert, spekulative Parserfehler gezielt widerlegt. Zusätzlich frühe Subgraph-Mitgliedschaften und Label-only-Elemente abgesichert. Drei Subagenten mit getrennten Dateien abgeschlossen.
- Finale Prüfung: 830 Unit-, 13 Interop-UI-, 7 Electron-, 61 Lifecycle- und 22 Python-Tests; Typecheck/Build/diff-check grün. 19 tatsächliche Mermaid12.3-Parser-/Graphdatenfälle und begrenzte adversariale200k-Fälle bestanden. Reales >3MiB-Mermaid/Bild-UI-Roundtrip geprüft.
- Maßgeblicher Quellhash-/Befehlsnachweis: docs/reviews/153-local-validation.json. Keine neue vollständige Mermaid-Layout-/Pixelabnahme, Windows/Linux oder Installer dieser Revision behauptet. Kein Mermaid-Runtime-Paket in der Produktabhängigkeit.
- Graphify-Codeupdate erneut durch Schutz abgewiesen (5912 vs6052), #145 weiterhin offen; kein Force. Traceability wird nach endgültigem Ledgerstand separat erzeugt/geprüft.
- Nächster Schritt: aktuellen GitHub-Stand lesen, lokalen Branch codex/149-hyperdht-relay auf Basis bd610f6 samt vorherigen P2P-Fixes gezielt integrieren, CI/Plattformprüfung durchführen. #153–157 erst nach Zielbranchintegration schließen. Fremde .claude/.idea-Änderungen erhalten.

GitHub-Abgleich bestätigt: #153–#157 tatsächlich offen mit ausschließlich `status: review`, Kommentare:
- https://github.com/J-ARTS/de.sketchdraw.io/issues/153#issuecomment-6806165260
- https://github.com/J-ARTS/de.sketchdraw.io/issues/154#issuecomment-6806165583
- https://github.com/J-ARTS/de.sketchdraw.io/issues/155#issuecomment-6806166050
- https://github.com/J-ARTS/de.sketchdraw.io/issues/156#issuecomment-6806166217
- https://github.com/J-ARTS/de.sketchdraw.io/issues/157#issuecomment-6806166845

Traceability-Merge und --check bestanden; Codegraphschutz #145 separat als https://github.com/J-ARTS/de.sketchdraw.io/issues/145#issuecomment-6806166944 dokumentiert.

## Main integration (2026-11-11)

User-authorized commit, fast-forward merge and push completed at `bdfbb20`. Initial CI: Linux product checks/package passed; direct P2P product-UI test still used controls hidden by the new layout. Test-only selector correction independently reproduced and verified: all3 native P2P tests passed. Final CI pending after correction; tickets remain review. Durable evidence: `docs/reviews/149-153-main-integration.json`. No release published. Earlier local-only entries are historical.
