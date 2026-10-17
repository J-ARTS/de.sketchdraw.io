# S1 Setup-Integration: tatsächliche Prüfnachweise

Issues #8/#15, unabhängiger Codex-Review nach Antigravity-Lieferung. Zeitpunkt: 2026-10-17T12:54:06.889689+00:00. Umgebung: macOS arm64, Node22.16.0/npm10.9.2. Lokaler Arbeitsbaum ohne Commit; Hashes begrenzen den geprüften Stand.

- `npm install`: bestanden, Lockfile erzeugt. TypeScript6.0.3, Vue3.5.44, vue-tsc3.3.13, Electron44.9.0, Builder26.15.3.
- `node --test tests/unit/dev-electron.test.mjs`: 9/9 bestanden, vom Implementierer und Root ausgeführt. Echte Vite-Listener und Node-Kindprozesse; Portkonflikt, fehlendes Executable, Buildfehler, Abbruch, verzögertes Beenden, hängendes Vite-Close, Kindprozessfehler.
- `node --check scripts/dev-electron.mjs`: bestanden laut Subagent, von Root inhaltlich geprüft.
- `vue-tsc -p tsconfig.app.json --noEmit`: bestand für den damals vorhandenen Typvertragsstand; kein Nachweis später entstehender Anwendungsmodule.
- `npm run typecheck:config`: scheiterte zuerst an entfernter baseUrl-Option (korrigiert), danach an noch fehlendem Domain-Einstieg. Muss nach Lieferung erneut laufen.
- TypeScript7.0.2 + vue-tsc: reproduzierbarer Fehler `ERR_PACKAGE_PATH_NOT_EXPORTED`; Pin auf6.0.3 behebt ihn.
- `npx playwright install chromium`: erfolgreich, Chromium156.0.8078.4/build1248 und Headless Shell installiert. Noch keine produktbezogenen UI-Tests.
- `npm audit`: acht moderate transitive Build-Befunde offen, Ticket #16. Test der Builder26.5.0-Linie brachte schwerere Befunde und wurde verworfen.
- Native Electron-GUI, Gesamtbuild, Persistenz, Windows/Linux: noch nicht ausgeführt, Produktdateien werden erstellt.

## Geprüfte Hashes

- `scripts/dev-electron.mjs`: `ba010e8110671654fd007e81c5a942dd82b18e816b3f8002727420b96bc29d4f`
- `tests/unit/dev-electron.test.mjs`: `7717a9ddc0ad186c7fd153f1a8e6b3892da28a2e20491259ea7de851090977f3`
- `package.json`: `81faaa97da2494815782feda5665ea568ffc008eadd321ae1570970a365b588a`
- `package-lock.json`: `463d287d10d7371f66d5a2ed56ccb7885dfd022ffb5cd5c2dc7ef9a1de203256`
- `.github/workflows/ci.yml`: `d6a4276a2f183194457cfa44baaf5bc81539f6ec3a7837fce82641a7a8264113`
