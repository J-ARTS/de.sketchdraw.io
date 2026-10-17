# Build-, Entwicklungs- und Test-Setup (`de.sketchdraw.io`)

- **Ticket-Referenz:** Issue [#8](https://github.com/J-ARTS/de.sketchdraw.io/issues/8) (Teil 1: Unabhängiges Build-/Test-Grundgerüst), Epic [#4](https://github.com/J-ARTS/de.sketchdraw.io/issues/4)
- **Verantwortlicher Agent:** Google Antigravity (`devops`, `logic`, `interface`, `iam`) — ausgeführt mit **Gemini 4 Argon (High)**
- **Rollen- und Arbeitsabgrenzung:**
  - In diesem Schritt wurden ausschließlich die Root-Konfigurationsdateien, Hilfsskripte unter [`scripts/`](../scripts/), die CI-Pipeline [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) sowie diese Dokumentation angelegt.
  - Es wurden **keine** Produktdateien unter `src/` oder `electron/` angelegt oder verändert (`src/renderer/` gehört Claude Code in #10; `src/domain/` in #9 sowie `electron/`-IPC/Persistenz in #8 Teil 2 folgen nach finalem Vertragsabgleich).
  - Das Lockfile (`package-lock.json`) wurde gemäß Auftrag **nicht** manuell synthetisiert, sondern wird durch Codex per `npm install` deterministisch erzeugt.

---

## 1. Laufzeitumgebung und fixierte Paketversionen

Die Konfiguration ist auf die lokale Referenzumgebung (**Node.js `22.16.0`**, **npm `10.9.2`**) und die am **17.10.2026** per `npm view` verifizierten Paketversionen abgestimmt:

| Paket | Typ | Version in [`package.json`](../package.json) | `engines.node` laut Registry | Zweck |
| --- | --- | --- | --- | --- |
| `vue` | `dependencies` | `3.5.44` | — | Reaktives UI-Framework für `src/renderer/` |
| `vite` | `devDependencies` | `8.3.4` | `^20.19.0 \|\| >=22.12.0` | Dev-Server (`127.0.0.1:5173`) und Renderer-Bundler |
| `@vitejs/plugin-vue` | `devDependencies` | `6.0.10` | `^20.19.0 \|\| >=22.12.0` | Vue-3-SFC-Kompilierung für Vite |
| `typescript` | `devDependencies` | `7.0.2` | `>=16.20.0` | Statische Typprüfung (`strict: true`) |
| `vue-tsc` | `devDependencies` | `3.3.13` | — | Typprüfung für `.vue`-Komponenten und Renderer |
| `electron` | `devDependencies` | `44.9.0` | `>= 22.12.0` | Gehärtete Desktop-Laufzeit (Windows, Linux, macOS) |
| `electron-builder` | `devDependencies` | `26.15.3` | `>=14.0.0` | Plattformübergreifendes Desktop-Packaging |
| `esbuild` | `devDependencies` | `0.28.2` | `>=18` | Bundling für `electron/main.ts` und `electron/preload.ts` |
| `vitest` | `devDependencies` | `5.0.5` | `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` | Unit- und Integrations-Test-Runner (`tests/unit/`) |
| `@playwright/test` | `devDependencies` | `1.64.1` | `>=20` | Browser-UI-Tests (`tests/ui/`) & Electron-E2E (`tests/electron/`) |
| `@types/node` | `devDependencies` | `26.6.5` | — | Node.js-Typdefinitionen für Electron, Tests und Configs |

---

## 2. Konfigurationsdateien im Überblick

1. **[`package.json`](../package.json)**
   - Setzt `"type": "module"`, `"main": "dist-electron/main.cjs"` und `"engines": { "node": ">=22.12.0", "npm": ">=10.0.0" }`.
   - Enthält alle geforderten Entwicklungs-, Prüf-, Build- und Packaging-Skripte.
2. **TypeScript-Konfigurationen**
   - **[`tsconfig.json`](../tsconfig.json):** Projekt-Referenzen auf die drei Teilkonfigurationen.
   - **[`tsconfig.app.json`](../tsconfig.app.json):** Prüft `src/**/*.ts`, `src/**/*.d.ts` und `src/**/*.vue` mit `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`, `verbatimModuleSyntax: true` und `types: []` (verhindert versehentliche Nutzung von Node.js-Globals in `src/domain/` oder `src/renderer/`).
   - **[`tsconfig.electron.json`](../tsconfig.electron.json):** Prüft `electron/**/*.ts` und `src/domain/**/*.ts` mit `types: ["node"]`.
   - **[`tsconfig.node.json`](../tsconfig.node.json):** Prüft [`vite.config.ts`](../vite.config.ts), [`vitest.config.ts`](../vitest.config.ts), [`playwright.config.ts`](../playwright.config.ts) und `tests/**/*.ts`.
3. **[`vite.config.ts`](../vite.config.ts) & [`index.html`](../index.html)**
   - Bindet den Entwicklungs- und Preview-Server strikt an `127.0.0.1:5173` (`strictPort: true`), sodass kein Netzwerk-Port nach außen exponiert wird.
   - Nutzt `base: './'`, damit das gebaute Frontend (`dist/index.html`) sowohl im lokalen Browser-Server als auch via `BrowserWindow.loadFile()` in Electron ohne gebrochene Asset-Pfade lädt.
   - [`index.html`](../index.html) definiert eine restriktive Content-Security-Policy (`default-src 'self'; script-src 'self'; object-src 'none'; ...`) und referenziert `/src/renderer/main.ts`.
4. **[`vitest.config.ts`](../vitest.config.ts)**
   - Führt ausschließlich Tests unter `tests/unit/**/*.{test,spec}.ts` aus.
   - Setzt `passWithNoTests: false`, damit ein leerer Ordner `tests/unit/` niemals als bestandener Testlauf gewertet wird.
5. **[`playwright.config.ts`](../playwright.config.ts)**
   - Trennt Browser-UI-Tests (`--project=ui`, Verzeichnis `tests/ui/`, Viewport `1280×800`, `baseURL: http://127.0.0.1:5173`) und Desktop-E2E-Tests (`--project=electron`, Verzeichnis `tests/electron/`).
   - Startet den lokalen Vite-Dev-Server nur dann automatisch, wenn nicht ausschließlich `--project=electron` ausgeführt wird.
6. **[`electron-builder.json`](../electron-builder.json)**
   - Konfiguriert das Packaging aus `dist/**/*` und `dist-electron/**/*` nach `release/` für macOS (`dir`, `zip`), Linux (`dir`, `tar.gz`) und Windows (`dir`, `zip`).
7. **Hilfsskripte unter [`scripts/`](../scripts/)**
   - **[`scripts/verify-entrypoints.mjs`](../scripts/verify-entrypoints.mjs):** Prüft vor Ausführung von `dev:browser`, `dev:electron`, `typecheck`, `test:unit`, `test:ui`, `test:electron` und `build`, ob die jeweils benötigten Dateieinstiege bzw. Testdateien vorhanden sind. Fehlt eine Datei, bricht das Skript mit Exit-Code `1` und einer klaren Nennung des zuständigen Issues/Agenten ab.
   - **[`scripts/build-electron.mjs`](../scripts/build-electron.mjs):** Bundelt `electron/main.ts` → `dist-electron/main.cjs` und `electron/preload.ts` → `dist-electron/preload.cjs` mittels `esbuild` (`platform: 'node'`, `target: 'node22'`, `format: 'cjs'`, `external: ['electron']`).
   - **[`scripts/dev-electron.mjs`](../scripts/dev-electron.mjs):** Prüft die Einstiege, baut die Electron-Bundles, startet Vite auf `http://127.0.0.1:5173`, wartet auf Erreichbarkeit und startet anschließend Electron mit `SKETCHDRAW_DEV_SERVER_URL=http://127.0.0.1:5173`.
8. **[`.github/workflows/ci.yml`](../.github/workflows/ci.yml)**
   - Job `governance-and-graphify`: Führt die bestehenden Python-Tests (`python3 -m unittest discover -s tools/tests -v`) sowie `python3 tools/graphify-links.py --check` aus.
   - Job `build-and-test`: Matrix über `ubuntu-latest`, `macos-latest` und `windows-latest` mit Node `22.16.0`. Führt `typecheck:config`, `typecheck`, `test:unit`, `build`, `test:ui`, `test:electron` (unter Linux via `xvfb-run --auto-servernum`) und `package` ohne Fehler-Maskierung aus.

---

## 3. Verfügbare npm-Skripte und aktuelle Integrationsabhängigkeiten

Kein Skript täuscht einen grünen Lauf vor, solange erforderliche Einstiegsdateien oder Tests aus den parallelen Sprint-1-Aufträgen noch ausstehen:

| Befehl | Funktion | Benötigte Dateien / Vorbedingungen | Erwartetes Verhalten beim aktuellen Dateistand (nur `src/domain/types.ts` vorhanden) |
| --- | --- | --- | --- |
| `npm run typecheck:config` | Prüft [`tsconfig.node.json`](../tsconfig.node.json) und [`tsconfig.app.json`](../tsconfig.app.json) (`src/domain/types.ts` + Root-Configs) | `src/domain/types.ts`, Root-Config-Dateien | **Soll sofort bestehen (Exit 0)**, sobald `npm install` ausgeführt wurde |
| `npm run typecheck` | Vollständiger Typecheck über App (`vue-tsc`), Electron (`tsc`) und Node/Tests | `src/domain/types.ts`, `src/renderer/main.ts` (#10), `electron/main.ts` (#8), `electron/preload.ts` (#8) | **Bricht kontrolliert mit Exit 1 ab** und nennt die fehlenden Einstiege `src/renderer/main.ts`, `electron/main.ts`, `electron/preload.ts` |
| `npm run dev:browser` | Startet Vite auf `http://127.0.0.1:5173` | `src/renderer/main.ts` (#10 Claude Code) | **Bricht kontrolliert mit Exit 1 ab** (fehlender Renderer-Einstieg) |
| `npm run dev:electron` | Bundelt Electron + startet Vite (`127.0.0.1:5173`) + startet Electron | `src/renderer/main.ts` (#10), `electron/main.ts` (#8), `electron/preload.ts` (#8) | **Bricht kontrolliert mit Exit 1 ab** (fehlende Renderer-/Electron-Einstiege) |
| `npm run test:unit` | Führt Unit-Tests mit Vitest aus | Mindestens eine `*.test.ts`/`*.spec.ts` in `tests/unit/` (#9 Antigravity) | **Bricht kontrolliert mit Exit 1 ab** (`No unit test files found in tests/unit/`) |
| `npm run test:ui` | Führt Playwright-Browsertests gegen `http://127.0.0.1:5173` aus | `src/renderer/main.ts` (#10) + Tests in `tests/ui/` (#10 Claude Code) | **Bricht kontrolliert mit Exit 1 ab** (fehlender Renderer-Einstieg & fehlende UI-Tests) |
| `npm run test:electron` | Baut App + führt Playwright-Electron-Tests aus | `src/renderer/main.ts` (#10), `electron/main.ts` (#8), `electron/preload.ts` (#8) + Tests in `tests/electron/` (#8) | **Bricht kontrolliert mit Exit 1 ab** (fehlende Einstiege & fehlende Electron-Tests) |
| `npm run build` | Baut Renderer (`dist/`) und Electron (`dist-electron/`) | `src/renderer/main.ts` (#10), `electron/main.ts` (#8), `electron/preload.ts` (#8) | **Bricht kontrolliert mit Exit 1 ab** (fehlende Einstiege) |
| `npm run package` | Baut App + erzeugt entpacktes Desktop-Bundle unter `release/` | Erfolgreicher `npm run build` | **Bricht kontrolliert mit Exit 1 ab**, solange `build` durch fehlende Einstiege blockiert ist |

---

## 4. Technische Bedenken und Hinweise für die Integration

### SB-01 — Kompatibilität zwischen `typescript@7.0.2` und `vue-tsc@3.3.13`
- **Beobachtung:** In den per `npm view` ermittelten Versionen liegt `typescript` bei `7.0.2` und `vue-tsc` bei `3.3.13`.
- **Risiko:** `vue-tsc` koppelt intern an das TypeScript-Compiler-API. Bei großen Major-Sprüngen von TypeScript kann `npm install` entweder `ERESOLVE`-Peer-Warnungen melden oder `vue-tsc` zur Laufzeit API-Inkompatibilitäten zeigen.
- **Prüfschritt für Codex:** Beim Ausführen von `npm install` und `npx vue-tsc --version` prüfen, ob `vue-tsc@3.3.13` sauber mit `typescript@7.0.2` arbeitet.

### SB-02 — `@types/node@26.6.5` gegenüber Laufzeit Node `22.16.0`
- **Beobachtung:** Die neueste Registry-Version `@types/node@26.6.5` bildet Node-26-Typen ab, während die lokale Laufzeit und CI auf Node `22.16.0` (`>=22.12.0`) laufen.
- **Risiko:** TypeScript könnte in `electron/` oder `tests/` Node-APIs als verfügbar typisieren, die erst nach Node 22 hinzugefügt wurden.
- **Gegenmaßnahme:** `tsconfig.app.json` blendet Node-Typen über `"types": []` vollständig aus, sodass `src/domain/` und `src/renderer/` strikt frei von Node-Globals bleiben. In `electron/` (`target: 'node22'` in `scripts/build-electron.mjs`) dürfen nur Node-22-kompatible Standardmodule genutzt werden.

### SB-03 — CommonJS-Ausgabe (`.cjs`) für Electron Main & Preload trotz `"type": "module"`
- **Begründung:** Das Projekt nutzt `"type": "module"` in [`package.json`](../package.json). Da Electron-Fenster gemäß [docs/architecture.md](./architecture.md) zwingend mit `sandbox: true` und `contextIsolation: true` laufen müssen, unterstützt der gehärtete Renderer-Sandbox-Preload in Electron zuverlässig gebündelte CommonJS-Preload-Skripte. Deshalb bundelt [`scripts/build-electron.mjs`](../scripts/build-electron.mjs) `electron/main.ts` und `electron/preload.ts` explizit als `.cjs` (`dist-electron/main.cjs`, `dist-electron/preload.cjs`).

### SB-04 — Linux Headless Electron-Tests in CI (`xvfb-run`)
- **Begründung:** Electron benötigt unter Linux einen Display-Server. In [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) wird `npm run test:electron` unter Linux daher über `xvfb-run --auto-servernum --server-args="-screen 0 1280x800x24"` gestartet.

---

## 5. Durchgeführte und ausstehende Prüfungen

### In diesem Antigravity-Lauf ausgeführt
- **Statische Dateierstellung und Konsistenzprüfung (Datei-Werkzeuge):** Alle Konfigurationsdateien, Skripte und Workflows wurden ohne Shell-Zugriff erstellt und gegen [`AGENTS.md`](../AGENTS.md), [`docs/architecture.md`](./architecture.md), [`docs/contracts.md`](./contracts.md) und [`src/domain/types.ts`](../src/domain/types.ts) abgeglichen.
- **Nicht ausgeführt (Grund):** Keine Shell-/Befehlsausführung (`npm install`, `npm run typecheck:config`, `python3 tools/graphify-links.py`) in diesem Lauf, da die Laufzeit-Anweisung für diesen Auftrag strikt auf Dateiwerkzeuge (`view_file`/`write_to_file`/`replace_file_content`) begrenzt ist und Codex die Shell-, Installations- und Prüfschritte als Integrator übernimmt.

### Von Codex als Integrator auszuführende Schritte
1. **Abhängigkeiten installieren und Lockfile erzeugen:**
   ```bash
   npm install
   ```
2. **Sofort ausführbare Basisprüfung (Verträge & Konfigurationen):**
   ```bash
   npm run typecheck:config
   ```
3. **Verifikation der Guard-Skripte (müssen beim aktuellen Stand ehrlich mit Exit-Code `1` und klarer Abhängigkeitsmeldung abbrechen):**
   ```bash
   npm run typecheck
   npm run test:unit
   npm run build
   ```
4. **Bestehende Governance-/Graphify-Prüfungen aktualisieren und prüfen:**
   ```bash
   python3 -m unittest discover -s tools/tests -v
   python3 tools/graphify-links.py --check
   ```
5. **Nächste Implementierungsschritte nach diesem Grundgerüst:**
   - **Antigravity (#9):** Implementierung von `src/domain/` (`index.ts`, Validierung, Commands, Controller, Undo/Redo, Serialisierung) + Unit-Tests in `tests/unit/domain/`.
   - **Antigravity (#8 Teil 2):** Implementierung von `electron/main.ts`, `electron/preload.ts`, atomarer Datei-Persistenz, Browser-Fallback-Adapter + Tests in `tests/electron/`.
   - **Claude Code (#10):** Implementierung von `src/renderer/main.ts` und Whiteboard-UI + UI-Tests in `tests/ui/`.

## Codex-Integration nach Erstlieferung

Node-Typen auf 22.20.5 zur Laufzeitlinie begrenzt; Node-Engine gemäß Vitest 5 eingeschränkt. Axe 4.14.0 sowie Inter/JetBrains Mono Variable 5.3.0 für UI-Prüfung und gebündelte Fonts ergänzt. Die Konfigurations-Typprüfung umfasst über tsconfig.node auch Tests und kann bei noch fehlender Domain fehlschlagen; eine Erfolgserwartung aus dem Erstbericht ist kein Nachweis. Die Python-CI entdeckt Tests ausdrücklich unter tools/tests. Installation und Produktprüfungen werden separat protokolliert.

### Tatsächliche Kompatibilitätsprüfung (17.10.2026)

Erster Installationslauf erfolgreich. `vue-tsc` scheiterte mit TypeScript7.0.2 an fehlendem Export `typescript/lib/tsc`; mit TypeScript6.0.3 läuft die Typprüfung des bisherigen `src`-Stands erfolgreich. Dies prüft bislang nur die vorhandenen Verträge, keine fertige Anwendung. Die Einschränkung ist auch im [Upstream-Issue6124](https://github.com/vuejs/language-tools/issues/6124) dokumentiert. Die veraltete Option `baseUrl` wurde entfernt; `paths` verwendet bereits relative Ziele.

Die umfassende Konfigurations-/Test-Typprüfung scheiterte zunächst erwartungsgemäß an noch nicht geliefertem Domain-Einstieg. Die Node22-Typen, Vitest, Vue-Typprüfer und Playwright sind installiert. Fehlende Implementierungen werden nicht durch Test-Doubles im Produkt kaschiert.

Der erste `npm audit` meldete acht moderate Einträge entlang derselben Build-Abhängigkeit `sprintf-js` ([GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)). Ein Fix für sprintf-js selbst war nicht verfügbar. Statt eines erzwungenen Major-Overrides wird die von npm als nicht betroffene Linie vorgeschlagene Electron-Builder-Version26.5.0 geprüft; Electron bleibt44.9.0. Ergebnis und Pakettest folgen.

Der anschließende Test der vorgeschlagenen Builder26.5.0-Linie brachte acht hohe und einen kritischen Audit-Eintrag über ältere Build-Abhängigkeiten. Diese Linie wurde deshalb verworfen und26.15.3 wiederhergestellt. Der moderate sprintf-js-Befund bleibt bis gezielter Kompatibilitätsprüfung offen; `npm audit fix --force` wurde nicht ausgeführt.

### Gezielte Behebung des Auditbefunds (#16)

Der eng begrenzte Override `app-builder-lib@26.15.3` → `@electron/get@3.1.0` → `global-agent@4.1.3` entfernt roarr/sprintf-js, ohne den Got-Downloader zu wechseln. Installation und `npm audit` melden0 bekannte Befunde. Root hat HTTP-Proxy/NO_PROXY/Cache/Checksum-Rejection und HTTPS-CONNECT mit prozesslokaler Test-CA gegen die tatsächlich installierte Auflösung erfolgreich geprüft. Keine TLS-Validierung abgeschaltet; globale Einstellungen unverändert. Vollständiger Paketbau mit frischem Download-Cache steht noch aus.
