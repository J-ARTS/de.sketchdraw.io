# Build-, Entwicklungs- und Test-Setup (`de.sketchdraw.io`)

Stand: 17.10.2026. Ursprung ist das Build-/Test-Grundgerüst von **Google Antigravity mit Gemini 4 Argon (High)** für [#8](https://github.com/J-ARTS/de.sketchdraw.io/issues/8). **OpenAI Codex** hat dieses Dokument im Integrationsticket [#15](https://github.com/J-ARTS/de.sketchdraw.io/issues/15) gegen die aktuellen lokalen Konfigurationen, Einstiegspunkte und Paketmetadaten abgeglichen. Die ursprüngliche Lieferung enthielt Konfigurationen und Skripte; die damaligen Aussagen über fehlende Produktdateien beschreiben nicht mehr den heutigen Stand. Echte externe Beiträge und spätere Codex-Korrekturen bleiben getrennt zugeordnet.

Renderer, Domain, Desktop-Brücke, Code/Katalog, Interop, MCP und P2P sind inzwischen im Repository vorhanden. Diese Anleitung beschreibt den ausführbaren Aufbau und die vorgesehenen Prüfwege. Den bestätigten Status einer konkreten Revision führen die Issues [#15](https://github.com/J-ARTS/de.sketchdraw.io/issues/15) und [#24](https://github.com/J-ARTS/de.sketchdraw.io/issues/24) sowie die zugehörigen Actions-Läufe; vorhandene Skripte sind allein kein Test- oder Release-Nachweis.

## 1. Voraussetzungen und Paketversionen

[package.json](../package.json) verlangt Node.js `^22.12.0 || ^24.0.0 || >=26.0.0` und npm `>=10.0.0`. Die CI verwendet Node.js **22.16.0**; die lokale Referenzumgebung wurde mit Node.js 22.16.0 und npm 10.9.2 eingerichtet. Für Graphify-Prüfungen ist Python erforderlich; die CI verwendet Python **3.12**. Die Abhängigkeiten sind in [package-lock.json](../package-lock.json) versioniert und werden mit `npm ci` installiert.

Die folgende Auswahl stammt aus dem aktuellen Manifest und Lockfile, nicht aus einer erneuten Registry-Abfrage:

| Paket | Fixierte Version | Zweck |
| --- | --- | --- |
| `vue` | `3.5.44` | Vue-Renderer |
| `vite` | `8.3.4` | Lokaler Entwicklungsserver und Renderer-Build |
| `@vitejs/plugin-vue` | `6.0.10` | Vue-SFC-Kompilierung |
| `typescript` | `6.0.3` | Statische Typprüfung |
| `vue-tsc` | `3.3.13` | Typprüfung der Vue-Komponenten |
| `@types/node` | `22.20.5` | Node-22-Typdefinitionen |
| `electron` | `44.9.0` | Desktop-Laufzeit |
| `electron-builder` | `26.15.3` | Desktop-Pakete und Installer |
| `esbuild` | `0.28.2` | Main-, Preload- und MCP-Bundles |
| `vitest` | `5.0.5` | TypeScript-Unit-/Integrationstests |
| `@playwright/test` | `1.64.1` | Browser-, Desktop- und P2P-Prüfungen |
| `@axe-core/playwright` | `4.14.0` | Automatisierte Accessibility-Prüfungen |
| `@modelcontextprotocol/server`, `@modelcontextprotocol/client` | `2.3.1` | MCP-Server bzw. echter SDK-Testclient |
| `fflate` / `saxes` / `htmlparser2` | `0.8.3` / `6.0.0` / `12.0.0` | Begrenzte Kompressions-, XML- und HTML-Verarbeitung |
| `jsonc-parser` / `zod` | `3.3.1` / `4.6.7` | Syntaxverarbeitung und Validierung |
| `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono` | `5.3.0` | Lokal gebündelte UI- und Codeschriften |

Die frühere TypeScript-7.0.2-Auswahl wurde nach einer realen `vue-tsc`-Inkompatibilität durch 6.0.3 ersetzt. Die Node-Typen sind auf die Node-22-Linie abgestimmt. Für [#16](https://github.com/J-ARTS/de.sketchdraw.io/issues/16) gilt weiterhin der gezielte Override `app-builder-lib@26.15.3` → `@electron/get@3.1.0` → `global-agent@4.1.3`. Der damalige Integrationsbericht verzeichnet eine Installation ohne bekannte Auditbefunde sowie Proxy-/Checksum-/TLS-Prüfungen; dieser Dokumentationsabgleich hat keinen neuen Auditlauf ausgeführt. Die zuvor untersuchte Builder-26.5.0-Linie wird nicht verwendet.

## 2. Einstiegspunkte, Bundles und Sicherheitslaufzeit

| Quelle | Ausgabe / Verwendung |
| --- | --- |
| [index.html](../index.html) → [src/renderer/main.ts](../src/renderer/main.ts) | Vite erzeugt `dist/index.html` und Renderer-Assets unter `dist/` |
| [electron/main.ts](../electron/main.ts) | `dist-electron/main.cjs`; `main`-Eintrag in `package.json` |
| [electron/preload.ts](../electron/preload.ts) | `dist-electron/preload.cjs`; benannte, begrenzte Renderer-Brücken |
| [src/mcp/server.ts](../src/mcp/server.ts) | `dist-mcp/server.cjs`; MCP-stdio-Adapter |

Die genannten Quellen und die vier Build-Einstiegsartefakte sind beim Abgleich vorhanden. Build-Ausgaben werden aus den Quellen neu erzeugt und ersetzen keine Revisionsprüfung. [build-electron.mjs](../scripts/build-electron.mjs) und [build-mcp.mjs](../scripts/build-mcp.mjs) bündeln mit esbuild für `node22` im CommonJS-Format einschließlich Source Maps. Das Electron-Bundle lässt `electron` als externes Laufzeitmodul bestehen. Die `.cjs`-Dateien sind trotz `"type": "module"` im Projekt bewusst gewählt; insbesondere bleibt der Sandbox-Preload gebündelt.

Im gebündelten Betrieb lädt Electron mit `loadURL()` die Adresse **`app://sketchdraw/index.html`**. [electron/security.ts](../electron/security.ts) definiert das privilegierte lokale Protokoll, begrenzte Dateiauflösung und die Content-Security-Policy. `bypassCSP` ist deaktiviert. Das Hauptfenster verwendet `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false` und `webSecurity: true`; auch Worker/Subframes erhalten keine Node-Integration. IPC prüft Sender, Hauptframe und erlaubte URL. Unzulässige Navigation und Popups werden abgefangen, externe HTTP(S)-Links benötigen eine menschliche Benutzeraktion.

Entwicklung verwendet ausschließlich den validierten lokalen Ursprung `http://127.0.0.1:5173`; `SKETCHDRAW_DEV_SERVER_URL` wird nur bei nicht paketierter Ausführung berücksichtigt. Die CSP gestattet im Entwicklungsmodus den lokalen Vite-/WebSocket-Zugriff, im gebündelten Betrieb gilt für `connect-src` nur `'self'`. [vite.config.ts](../vite.config.ts) bindet Entwicklungs- und Preview-Server mit `strictPort: true` an Loopback und verwendet relative Assetpfade (`base: './'`).

[dev-electron.mjs](../scripts/dev-electron.mjs) prüft die Einstiege, baut Main/Preload, startet Vite über dessen API im eigenen Prozess und startet anschließend die installierte native Electron-Datei direkt. Ein belegter Port führt zum Fehler; der Launcher übernimmt keinen unbekannten vorhandenen Server. Startup- und Shutdown-Fehler werden weitergereicht. Der Launcher baut den MCP-Adapter nicht selbst; für Agentenzugriff aus einem frischen Checkout vorher `npm run build:mcp` ausführen.

Der MCP-Adapter bearbeitet automatisch das aktuelle lokale Desktop-Dokument. Start und öffentliche Tool-Metadaten benötigen keine laufende Desktop-App; tatsächliche Dokumentaufrufe bleiben ohne eine aktive lokale Dokumentautorität gesperrt. Die App veröffentlicht die aktuelle Verbindung in einer privaten Laufzeitdatei und rotiert sie bei Dokumentwechsel oder Neustart. Es gibt keine Agenten-Freigabeoberfläche. Details: [Agentenintegration](agent-integration.md) und [MCP-Vertrag](contracts-mcp.md).

## 3. Installation und Befehle

Für einen frischen Checkout:

```sh
npm ci
npm run build:mcp
npm run dev:electron
```

Für Browserentwicklung genügt nach Installation `npm run dev:browser`. Browser-UI-Tests benötigen zusätzlich den Playwright-Browser und auf Linux dessen Systemabhängigkeiten:

```sh
npx playwright install --with-deps chromium
```

| Befehl | Tatsächliche Funktion |
| --- | --- |
| `npm run dev:browser` | Einstiegsprüfung und Vite auf `127.0.0.1:5173` |
| `npm run dev:electron` | Main-/Preload-Build, eigener Vite-Server und native Electron-App |
| `npm run typecheck:config` | TypeScript-Prüfung der Node-/Test- und App-Konfiguration; kein Ersatz für Vue-/Electron-/MCP-Gesamtprüfung |
| `npm run typecheck` | Einstiegsprüfung, `vue-tsc` für App sowie `tsc` für Electron, Node/Tests und MCP |
| `npm run test:unit` | Einstiegsprüfung, MCP-Build und Vitest für `tests/unit/**/*.test.ts` / `*.spec.ts` |
| `npm run test:ui` | Playwright-Projekt `ui` gegen den lokalen Vite-Server |
| `npm run test:electron` | Main/Preload, MCP und Renderer neu bauen; Playwright-Projekt `electron` ausführen |
| `npm run build:renderer` | Renderer nach `dist/` bauen |
| `npm run build:electron` | Main und Preload nach `dist-electron/` bauen |
| `npm run build:mcp` | MCP-Adapter nach `dist-mcp/` bauen |
| `npm run build` | Renderer, Main/Preload und MCP nacheinander bauen |
| `npm run mcp` | Bereits gebautes `dist-mcp/server.cjs` über Node starten |
| `npm run package` | Gesamtbuild und entpacktes Desktop-Paket (`--dir`) unter `release/` |
| `npm run package:dist` | Gesamtbuild und für die Plattform konfigurierte Installer unter `release/` |

Weitere Prüfungen laufen getrennt von `test:unit`:

```sh
node --test tests/unit/*.test.mjs
python3 -m unittest discover -s tools/tests -v
python3 tools/graphify-links.py --check
npx playwright test --config tests/p2p/playwright.config.ts
```

Die Node-Tests prüfen unter anderem Entwicklungs-Lifecycle, Release-Skripte und Prozessabbau. Die Python-Tests prüfen den Graphify-Adapter. Der letzte Befehl führt die eigenständigen echten P2P-Tests mit einem eigenen Vite-Server auf `127.0.0.1:5184` aus. Er ist kein Teil des normalen UI-Projekts.

[verify-entrypoints.mjs](../scripts/verify-entrypoints.mjs) sowie die jeweiligen Buildskripte brechen bei fehlenden erforderlichen Quellen oder Tests weiterhin mit Fehler ab. Die früher erwarteten Abbrüche wegen eines nicht implementierten Renderers oder einer fehlenden Domain sind keine aktuellen Setup-Voraussetzungen mehr. Vitest verwendet `passWithNoTests: false`.

## 4. Konfiguration und Plattformprüfungen

[tsconfig.json](../tsconfig.json) referenziert vier Teilkonfigurationen:

- [tsconfig.app.json](../tsconfig.app.json): `src/**/*.ts`, Deklarationen und Vue-Dateien, ausgenommen `src/mcp/**`; strikte Prüfung, `noUncheckedIndexedAccess`, keine automatisch geladenen Node-Typen (`types: []`).
- [tsconfig.electron.json](../tsconfig.electron.json): Electron und Domain mit Node-Typen.
- [tsconfig.node.json](../tsconfig.node.json): Vite-/Vitest-/Playwright-Konfigurationen und TypeScript-Tests mit Node-Typen.
- [tsconfig.mcp.json](../tsconfig.mcp.json): MCP sowie Agenten-Zugriffsmodule in Renderer-/Electron-Bereichen.

[playwright.config.ts](../playwright.config.ts) trennt `ui` (`tests/ui/`, Chromium, 1280×800) und `electron` (`tests/electron/`). Beim expliziten Electron-Projekt wird kein Vite-Server automatisch gestartet. UI-Prüfungen dürfen lokal einen vorhandenen Server wiederverwenden; in CI ist dies deaktiviert. Die [P2P-Konfiguration](../tests/p2p/playwright.config.ts) verwendet einen eigenen Port und keine Serverwiederverwendung.

[CI](../.github/workflows/ci.yml) läuft auf `ubuntu-24.04`, `macos-15` und `windows-2025`. Nach dem Governance-/Graphify-Job folgen pro Plattform `npm ci`, beide Typecheck-Befehle, Node-Tests, Vitest, Gesamtbuild, Browser-UI-Tests, echte Electron-Tests und ein entpacktes Desktop-Paket. Ein separater Ubuntu-Job prüft direkte P2P-Verbindungen in Chromium und Electron einschließlich der Produktinteraktion. Fehlerdiagnosen werden als Actions-Artefakte aufgehoben.

Linux-Electron-Tests laufen unter Xvfb mit aktiviertem Chromium-Sandboxing. Für Ubuntu 24.04 bindet [linux-sandbox.mjs](../scripts/linux-sandbox.mjs) nur in GitHub Actions ein temporäres AppArmorprofil an den konkreten Executable-Pfad und entfernt es wieder; Entwicklerrechner werden dadurch nicht umkonfiguriert. Die Tests verwenden weder `--no-sandbox` noch globale Sysctl-Lockerungen. Auf lokalen Linux-Systemen müssen ein Display beziehungsweise Xvfb und die passenden Sandbox-Voraussetzungen verfügbar sein.

Gemeinsamer Test-Prozessabbau: [stop-electron.mjs](../scripts/stop-electron.mjs) beendet nur die gestartete eigene App. Unter Windows erfolgt die begrenzte Prozessbaumbeendigung mit `taskkill /PID … /T /F` vor dem Löschen des Testprofils. Tatsächliches Prozessende und Cleanup-Fehler werden geprüft; dies ist Testinfrastruktur und kein Ersatz für den Produkt-Schließdialog. Hintergrund und Nachweise stehen im [Windows-Cleanup-Bericht](reviews/codex-windows-cleanup.md).

## 5. Packaging, Release und Nachweisgrenzen

[electron-builder.json](../electron-builder.json) packt **`dist/`, `dist-electron/` und `dist-mcp/`** sowie `package.json` in die Anwendung mit ASAR. Die konfigurierten Installer sind Windows x64 **NSIS `.exe`**, macOS arm64 **`.dmg`** und Linux x64/amd64 **`.deb`**. `publish: null` deaktiviert automatisches Veröffentlichen durch die Builder-Konfiguration; der Release-Pfad verwendet zusätzlich `--publish never` beim Paketbau.

Der [Release-Workflow](../.github/workflows/release.yml) prüft Tag, Version und Commit, führt die vollständige CI auf genau dieser Revision aus und baut die drei Installer auf den passenden nativen Runnern. Jeder Installer wird tatsächlich extrahiert; die extrahierte App und ihr ausgelieferter MCP-Adapter werden gestartet und geprüft. Erst danach werden genau drei zusammengehörige Assets für die Veröffentlichung akzeptiert. Ein Verzeichnis-Paket aus `npm run package` ersetzt diese Installer-Abnahme nicht. Ablauf, Wiederaufnahme, Signing und genaue Grenzen stehen in [docs/release.md](release.md).

Der ursprüngliche Antigravity-Setup-Lauf beschränkte sich auf Dateiwerkzeuge und führte keine Installation oder Produkttests aus. Spätere Installations-, Build- und Produktnachweise stammen aus den jeweiligen Integrationsläufen. Für **diesen Codex-Dokumentationsabgleich** wurden ausschließlich Manifest-/Lockfile-Versionen, vorhandene Einstiegspunkte und Bundles, Konfigurationen, Skripte, lokale Links und Format geprüft. Keine neuen Produkt-, Plattform-, Audit- oder Release-Tests wurden gestartet; laufende Release-Prüfungen werden hier nicht als bestanden vorweggenommen.
