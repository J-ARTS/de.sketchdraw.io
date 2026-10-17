# Unabhängiger Codex-MCP-Review — #13/#15

17.10.2026, lokale uncommittete Implementierung. Reviewer: OpenAI Codex (`setup_integration`), getrennt vom implementierenden Root-Agenten. Graphify zuerst abgefragt; anschließend tatsächliche Dateien in `src/agent-access/`, `src/mcp/`, `electron/agent-access/`, Main/Preload, Sessionautorität und UI-Anschluss gelesen. Keine Produktänderungen in diesem Review.

Kein bestätigter Blocker und keine reproduzierte Autorisierungsumgehung gefunden. Vier zusätzliche unabhängige Tests in `tests/unit/mcp-review-boundaries.spec.ts` prüfen manipulierte Actor-/Permission-/Grant-/Session-/Revisionsdaten, lokalen Widerruf während asynchronen Fingerprintings, Close-Barrier mit Cancel und reservierter fehlgeschlagener Command-ID sowie dieselbe Command-ID für unterschiedliche Operationen. Der echte gemeinsame Controller bleibt dabei maßgeblich.

Prüfstand: Darwin arm64, Node v22.16.0, Vitest v5.0.5.

- `./node_modules/.bin/vitest run tests/unit/mcp-review-boundaries.spec.ts tests/unit/mcp/backend.spec.ts tests/unit/mcp/renderer-session.spec.ts`: 18/18 bestanden, drei Dateien, 16:39:38, 447 ms. Einschließlich echtem lokalen Socket und SDK-stdio-Client der vorhandenen Backendtests; keine übersprungenen Tests.
- `./node_modules/.bin/tsc --ignoreConfig --noEmit --strict --noUnusedLocals --noUnusedParameters --noUncheckedIndexedAccess --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2023,DOM --types node tests/unit/mcp-review-boundaries.spec.ts`: bestanden, Exit 0.

Nicht selbst geprüft: native Windows-TCP-Ausführung, installierte App auf allen drei Systemen, tatsächliche Hersteller-Hostkonfiguration von Claude/Codex/Antigravity. Root berichtet seinen separaten echten Electron-Canvas-Test; dieser Bericht beansprucht dessen Durchführung nicht.

Kleine verbleibende Vertragsabweichung: `VALIDATION_FAILED` nach einem vom gemeinsamen Gateway zurückgewiesenen Domaincommand enthält derzeit keine detaillierten Pfad-/Issueinformationen. Das erschwert die Korrektur ungültiger Agentenbefehle, stellt nach dieser Prüfung aber keinen Schreibrechte- oder Atomaritätsfehler dar. Kein pauschaler Sicherheitsnachweis außerhalb des geprüften Umfangs.
