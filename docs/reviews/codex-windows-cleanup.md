# Windows-CI: Backend-Gesture-Test und Prozessabbau (#15)

Werkzeug: OpenAI Codex; lokale Korrektur und Tests am 17.10.2026. Kein Beitrag von Antigravity oder Claude Code. Der Windows-Nativnachweis bleibt dem nächsten CI-Lauf vorbehalten.

## Bestätigter Ausgangsbefund

Die Artefakte unter `/tmp/sketchdraw-windows-first/test-results/` und `/tmp/sketchdraw-ci-windows-first.log` zeigen Backend-Teardown-Timeouts. Im ersten Backend-Trace beobachtet das bisherige `expect.poll` wiederholt aktive Benutzeraktivierung, erreicht anschließend aber die negativen Opener- und weiteren Bridge-Prüfungen. Der bestätigte Testabbruch dieses Durchlaufs entsteht erst beim Aufräumen; der Trace belegt keinen dauerhaften Fehler der Aktivierungsprüfung. Beim separaten MCP-Produktfall überschreibt ein `EBUSY` beim Entfernen des Profil-Journals die vorherige Ursache.

## Änderungen

- `tests/electron/backend-shell.spec.ts`: Ein einmal gestarteter Renderer-Job wartet ausschließlich mit eigenen Timern auf inaktive Benutzeraktivierung. Keine wiederholten Automation-Evaluierungen während dieser Wartephase. Direkt vor jedem Opener-Aufruf wird die inaktive Voraussetzung geprüft; die Assertions prüfen sowohl das ungültige URL-Protokoll als auch die konkrete Ablehnung des gültigen HTTPS-Links ohne menschliche Interaktion.
- `scripts/stop-electron.mjs` mit `stop-electron.d.mts`: gemeinsamer Helper für den eigenen Electron-Prozess. Windows verwendet vor einem Parent-Quit ausschließlich `taskkill.exe /PID <eigene PID> /T /F`, ohne Shell und mit Zeitgrenze. Das tatsächliche Prozessende muss vor dem Automation-Close bestätigt sein. Nur Exitcode 128 bei zusätzlich bestätigtem natürlichem Parent-Ende wird als enger Lookup-Race akzeptiert; andere Fehler bleiben Fehler. POSIX fordert `app.exit` an und verwendet bei Bedarf begrenzte SIGTERM-/SIGKILL-Schritte mit Exit-Wartezeit. Bereits beendete Prozesse werden nicht erneut signalisiert.
- `tests/electron/helpers/stop-electron.ts` re-exportiert nur den gemeinsamen Helper. Backend-Teardown löscht das Profil erst nach erfolgreichem Stop, behält bei Stopfehlern das Verzeichnis und einen Diagnoseanhang und erhält einen bereits vorhandenen Testfehler. Das Fixture besitzt ein eigenes begrenztes Teardown-Zeitbudget.
- Ein echter kontrollierter Testprozess verweigert normales SIGTERM; lokal wird die erzwungene Beendigung geprüft. Unter Windows startet derselbe Fall zusätzlich einen echten eigenen Kindprozess und prüft nach `taskkill /T` auch dessen Ende. Ein zweiter Cleanup prüft Idempotenz.

Die [Microsoft-Dokumentation zu taskkill](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill) beschreibt die PID- und Kindprozessbegrenzung. Die [Electron-Dokumentation](https://www.electronjs.org/docs/latest/api/web-contents#contentsexecutejavascriptcode-usergesture) dokumentiert den `userGesture`-Parameter; die neue Prüfung ist zusätzlich unabhängig von wiederholtem Eintritt durch die Automation.

## Ausgeführte Prüfungen

Umgebung: macOS arm64, Node 22.16.0, Electron 44.9.0, Playwright 1.64.1. Geprüft wurden lokale Änderungen im Integrations-Checkout; kein Windows-Erfolg und kein Release werden behauptet.

| Prüfung | Ergebnis |
| --- | --- |
| `playwright test --project=electron tests/electron/backend-shell.spec.ts --workers=1 --reporter=line --output=/tmp/sketchdraw-backend-shared-cleanup-final` | **4/4 bestanden**, 25,4 s; echter Electron-Backend-Test mit unveränderten Main-/Preload-Buildbytes, ergänzt um den kontrollierten Cleanup-Prozess |
| `node --test tests/unit/stop-electron.test.mjs` | **8/8 bestanden**, 8,11 s, keine Skips; ausdrücklich simulierte Windows-Prozessgrenzen, einschließlich Lookup-Race, lebendem Parent trotz Command-Erfolg, anderen Fehlern trotz Exit, ungültiger PID, Idempotenz und hängendem Automation-Close |
| Strikter gezielter TypeScript-Check für Backend-Spec und Helper einschließlich `.d.mts` | **Bestanden** |
| `node --check scripts/stop-electron.mjs` und `git diff --check` | **Bestanden** |

Der TypeScript-Aufruf verwendete `--ignoreConfig --noEmit --strict --noUnusedLocals --noUnusedParameters --noUncheckedIndexedAccess --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2023,DOM --types node`.

Geprüfte Build-Hashes: Main `861c6933fefe30787dfa3c4d3401a70d6c533886f1fe6a315286f33b55a41cfd`; Preload `3cb35ae7042fee9116e8d87bcd739edf6fc662343f3b3d57f708f79a2e1a4608`. Der Backend-Test verifiziert beim Kopieren die unveränderten Buildbytes.

## Übergabe und Grenzen

Root bindet denselben Helper in MCP-Produkt-, Desktop- und Installer-Prüfungen ein und führt die Gesamtprüfung aus. Diese Integrationen wurden von dieser Teilaufgabe nicht verändert oder als bestanden erklärt. Der native Windows-Prozessbaum-/Profilnachweis sowie die Windows-Gesture-Prüfung sind noch offen. Die simulierten Unit-Prüfungen ersetzen diese Abnahme nicht. GitHub-, Ledger- und Graphify-Fortschreibung erfolgen koordiniert durch Root.

Der unabhängige Reviewer meldete zusätzlich mögliche Überdeckung ursprünglicher Installer-Smoke-Fehler durch DMG-Detach, MCP-Close und Report-Schreiben. Diese drei Befunde wurden an Root zur separaten Integration weitergegeben; die betreffende Release-Datei wurde hier nicht parallel verändert.
