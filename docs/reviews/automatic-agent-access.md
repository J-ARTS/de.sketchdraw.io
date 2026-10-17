# Automatischer lokaler Agentenzugriff – Abnahmenachweis

Ticket: [#30](https://github.com/J-ARTS/de.sketchdraw.io/issues/30)

Datum: 17.10.2026

Koordination, Implementierung und Testverantwortung: OpenAI Codex als vom Nutzer erlaubte vorübergehende Übernahme. Die regulären Zuständigkeiten von Claude Code für UI und Antigravity für Schnittstelle/IAM bleiben dokumentiert.

## Bestätigtes Produktverhalten

- Der sichtbare Agenten-/Freigabebereich und seine manuellen Read-/Write-/Widerrufsfunktionen sind entfernt.
- Eine lokale Electron-`DocumentAuthority` registriert automatisch einen internen Schreib-Grant. Main veröffentlicht die aktuelle Capability und die exakte gebündelte MCP-Clientkonfiguration in einer privaten Laufzeitdatei.
- Die öffentlichen MCP-Werkzeuge akzeptieren eine optionale `documentId`. Ohne ID verwenden sie das aktuelle lokale Dokument; eine fremde ID wird abgewiesen.
- Der stdio-Adapter verbindet nach `ACCESS_DENIED`, `ACCESS_REVOKED` oder `SESSION_CHANGED` einmal gegen die aktuelle Laufzeitdatei neu. `OUTCOME_UNKNOWN` wird nicht automatisch wiederholt.
- Dokumentwechsel und App-Neustart rotieren Grant, App-Epoche und Capability ohne Freigabedialog. Die Browseransicht exponiert keinen Host; der P2P-Gastmodus besitzt keine lokale Authority und entfernt deshalb den automatischen Zugriff.
- Mutual-HMAC, private Unix-Sockets beziehungsweise Windows-Loopback, Revisionsprüfung, Command-ID-Deduplizierung, Größen-/Parallelitätsgrenzen und der fehlende Shell-/Dateipfadzugriff bleiben erhalten.

## Prüfungen

| Prüfung | Umgebung | Ergebnis |
| --- | --- | --- |
| `npm run typecheck` | macOS arm64, Node/npm aus Projektumgebung | bestanden |
| `npm run test:unit` | Vitest, einschließlich Runtime-Datei, Host, Renderer-Sitzung und MCP | 27 Dateien, 285 Tests bestanden |
| `node --test tests/unit/*.test.mjs` | Release-/Prozessprüfungen | 58/58 bestanden |
| `npm run build` | Renderer, Electron Main/Preload und MCP | bestanden; bestehender Größenhinweis für Renderer-/MCP-Bundle |
| Playwright UI mit getrenntem Ausgabeordner | Chromium | 19/19 bestanden |
| Playwright Electron mit getrenntem Ausgabeordner | echte gebaute Desktop-App | 6/6 bestanden |
| Automatischer MCP-Produkttest | echter SDK-stdio-Client gegen Electron | sechs Tools, Lesen, Schreiben, sichtbare Human-Weiterbearbeitung, Dokumentwechsel-Reconnect und App-Neustart bestanden |
| P2P-Suite | zwei Chromium-Kontexte und sandboxed Electron | 3/3 bestanden; Browser-/Gastgrenzen erhalten |

Ein vorheriger gemeinsamer Playwright-Lauf meldete ausschließlich fehlende Trace-Artefakte, weil ein paralleler UI-Lauf denselben Standard-Ausgabeordner verwendete. Die vollständigen Wiederholungen mit getrennten Ausgabeordnern bestanden. Dieser Befund ist kein Produktfehler.

## Nachweisgrenzen

Die lokalen Prüfungen bestätigen das Verhalten auf macOS arm64. Cross-Platform-Verhalten der stabilen Laufzeitpfade ist unit-getestet; der neue integrierte Commit benötigt anschließend die normale GitHub-CI für native Windows-, macOS- und Linux-Bestätigung. Der Bericht enthält keine Capability, Dokumentdaten, geschätzte Tokenzahl, Kostenangabe oder offiziellen Benchmark-Claim.
