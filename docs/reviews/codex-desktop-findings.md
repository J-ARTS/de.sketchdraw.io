# Unabhängiger Desktop-Review und Reparaturauftrag

Tickets #8/#15, Bugs #17/#22/#23. macOS arm64, Node22.16.0, Vitest5.0.5. Antigravity-Erstlauf abgeschlossen; Root baute Main/Preload erfolgreich und prüfte TypeScript. Keine GUI-Freigabe.

- #17: Node WHATWG URL gibt für app://sketchdraw/index.html die origin null zurück. Deshalb scheitert die eigene IPC-Seite. Explizite Scheme/Hostname/Port/Authority-Prüfung verwenden, nicht alle opaque Origins mit null zulassen. `tests/unit/desktop-security.spec.ts`:1/2 bestanden.
- #22: Save-as/Export übergeben keine erwartete Version; Writer überspringt dann Versionsprüfung. Nach Dialog vor dem Schreiben existierenden Inhalt oder explizite Abwesenheit erfassen, vor Rename erneut prüfen. Bei save-as conflict, bei Export error/EXPORT_CONFLICT. Keine Konkurrenzdatei überschreiben.
- #23: path.resolve ist keine kanonische Dateiidentität. Directory-Symlink-Aliase brauchen gemeinsame Sperre; über File-Symlink geöffnetes Dokument soll dessen reales Ziel speichern und den Link erhalten. Bestehende Ziele realpath-auflösen; für neue Ziele realen Parent + Blattname verwenden, sichere Zielbindung und Racegrenzen dokumentieren.

`tests/unit/desktop-review.spec.ts`:4 fehlgeschlagen,3 Kontrollfälle bestanden. Echte Temp-Dateien und deterministische Race-Hooks; gewöhnlicher Save schützt Fremdänderung, Browsercancel und Downloadfehler räumen korrekt auf. Unabhängige Tests nicht verändern.

Nach Reparatur: `npx vitest run tests/unit/desktop-security.spec.ts tests/unit/desktop-review.spec.ts tests/unit/platform/`; `npx tsc -p tsconfig.electron.json --noEmit`; `npm run build:electron`. Die Shell führt Codex aus. Native Dialoge, Renderer und Windows/Linux bleiben eigene Nachweise.
