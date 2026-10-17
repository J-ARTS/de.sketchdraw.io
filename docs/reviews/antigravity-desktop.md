# Implementierungs- und Sicherheitsbericht (Antigravity) zu Issue #8 — Desktop-Shell, Preload-Brücke, Persistenz & Browser-Adapter

- **Verantwortlicher Agent / Rolle:** Google Antigravity (`logic`, `interface`, `iam`, `devops`)
- **Modell:** Gemini 4 Argon (High)
- **Bezug:** Issue [#8](https://github.com/J-ARTS/de.sketchdraw.io/issues/8), Gemeinsame Verträge S1 v2 ([docs/contracts.md](../contracts.md)), Domänentypen ([src/domain/types.ts](../../src/domain/types.ts))
- **Werkzeugeinsatz:** Ausschließlich Dateiwerkzeuge (`view_file`, `write_to_file`, `replace_file_content`). Gemäß Auftrag wurden **keine** Shell-/Terminalbefehle (`run_command`) ausgeführt und keine Dateien außerhalb des exklusiven Schreibbereichs (`electron/`, `src/platform/`, `tests/unit/platform/`, `tests/electron/`, `docs/reviews/antigravity-desktop.md`) verändert.

---

## 1. Übersicht der implementierten Dateien

| Datei | Zweck und Vertragsabdeckung |
| --- | --- |
| [electron/ipc-contract.ts](../../electron/ipc-contract.ts) | Feste IPC-Kanalnamen (`IPC_CHANNELS`), strikte Laufzeitvalidierung aller IPC-Payloads (`SaveDocumentRequest`, `ExportFileIpcPayload`, `OpenExternalIpcPayload`, `RespondToCloseIpcPayload`), Schutz vor Prototype-Pollution-Schlüsseln (`__proto__`, `constructor`, `prototype`), Abweisung unbekannter Felder (z. B. eingeschleuster Dateipfade) sowie reine `http:`/`https:`-URL-Prüfung ohne Node-Builtin-Abhängigkeiten. |
| [electron/security.ts](../../electron/security.ts) | Sicherheitsrichtlinien für Electron Main: Fenstermaße (`1280×800`, Minimum `960×640`), Privilegierung des `app://sketchdraw`-Schemas (`bypassCSP: false`), strikte Auflösung der Renderer-Ziel-URL (`http://127.0.0.1:5173/` ausschließlich im unpaketierten Dev-Modus bei verifiziertem `SKETCHDRAW_DEV_SERVER_URL`, sonst `app://sketchdraw/index.html`), `protocol.handle`-Dateiauflösung mit Traversal-, Nullbyte-, Backslash- und `fs.realpath`-Symlink-Escape-Schutz sowie vollständige IPC-Senderprüfung (`event.sender`, `mainFrame`, `routingId`, `parent === null`, erlaubte Origin/URL). |
| [electron/persistence.ts](../../electron/persistence.ts) | `DocumentPersistenceService`: Vergabe zufälliger opaker `handleId`s (`hdl_<32-hex>`) ausschließlich im Main-Prozess, SHA-256-Inhalts-Hash als `versionToken` (`sha256:<64-hex>`), Größen- und Schemavalidierung über `deserializeDocument` und `DOMAIN_LIMITS` aus `src/domain/index`, Serialisierung gleichzeitiger Speichervorgänge pro Handle/Zieldatei, atomares Schreiben über exklusive Geschwister-Tempdatei (`wx`, `0o600`) mit `fsync`, `close`, erneuter Versionsprüfung unmittelbar vor `rename` und garantiertem Tempfile-Cleanup sowie Pfad-Redaktion in allen Fehlermeldungen. |
| [electron/close-handshake.ts](../../electron/close-handshake.ts) | `CloseHandshakeCoordinator`: Fängt `BrowserWindow`-`close`-Events über `event.preventDefault()` ab, erzeugt eine einmalige `requestId` (`close_<32-hex>`), prüft bei `respondToClose` auf Übereinstimmung mit der aktiven `pendingRequestId` und lässt ein fehlendes oder abgelehntes Renderer-Signal niemals still das Fenster schließen. |
| [electron/main.ts](../../electron/main.ts) | Electron-Main-Einstiegspunkt: Registriert `app://`, blockiert Webviews, Popups (`setWindowOpenHandler -> deny`), fremde Navigationen/Redirects und Berechtigungsanfragen, setzt restriktive CSP-Header, bindet `DocumentPersistenceService` und `CloseHandshakeCoordinator` mit IPC-Senderprüfung an und leitet Anwendungsmenü-Kommandos (`open`, `save`, `save-as`, `undo`, `redo`) über den zentralen `onMenuCommand`-Kanal an den Renderer. |
| [electron/preload.ts](../../electron/preload.ts) | Sandbox-kompatibles Preload-Skript (`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`): Exponiert über `contextBridge.exposeInMainWorld('sketchdraw', ...)` ausschließlich die eingefrorene `DesktopBridge`-Fassade ohne rohe `ipcRenderer`-Methoden, kapselt Listener-Abmeldungen und prüft bei `openExternal` sowohl das URL-Schema als auch eine echte menschliche UI-Interaktion (`navigator.userActivation` bzw. vertrauenswürdiges DOM-Event). |
| [src/platform/browser-bridge.ts](../../src/platform/browser-bridge.ts) | Sicherer Browser-Adapter für `DesktopBridge` (`platform: 'browser'`): Echtes `<input type="file">` mit Unterstützung für `input.cancel`, Größen- und Domain-Validierung, SHA-256-`versionToken`, Speichern/Exportieren ausschließlich als Browser-Download (`status: 'download-initiated'`, niemals `'saved'`), zeitlich verzögerter Aufruf von `URL.revokeObjectURL` nach Download-Start und sichere No-Op-Hooks für `onCloseRequested`/`onMenuCommand`. |
| [src/platform/index.ts](../../src/platform/index.ts) | Plattform-Einstiegspunkt mit globaler `Window.sketchdraw`-Typdeklaration, Vertragsprüfung `isDesktopBridgeContract` und `getDesktopBridge(): DesktopBridge`. |
| [tests/unit/platform/persistence.spec.ts](../../tests/unit/platform/persistence.spec.ts) | Unit-Tests gegen echte temporäre Verzeichnisse (`os.tmpdir()`): Öffnen/Speichern-Roundtrip, `save-as` mit Basename-Sanitizing, externe Dateiänderung vor dem Schreiben und unmittelbar vor `rename`, Serialisierung konkurrierender Saves desselben Handles, Domain-Validierungsfehler, Tempfile-Cleanup bei `rename`-Fehlern und Pfad-Redaktion. |
| [tests/unit/platform/security-and-ipc.spec.ts](../../tests/unit/platform/security-and-ipc.spec.ts) | Unit-Tests für Dev-/Prod-URL-Auflösung, `app://`-Protokoll-Handler inkl. Traversal- und Symlink-Escape-Abwehr, `validateIpcSender`, `CloseHandshakeCoordinator` sowie Preload-Validierung und User-Gesture-Pflicht bei `openExternal`. |
| [tests/unit/platform/browser-bridge.spec.ts](../../tests/unit/platform/browser-bridge.spec.ts) | Unit-Tests für den Browser-Adapter (`openDocument`, `input.cancel`, Domain-Validierung, `saveDocument -> download-initiated`, verzögertes `URL.revokeObjectURL`, `exportFile`, `openExternal` mit User-Gesture). |
| [tests/electron/desktop.spec.ts](../../tests/electron/desktop.spec.ts) | Playwright-Electron-Integrationstest für die gebündelte App (`app://sketchdraw/index.html`), Fenstergröße (`1280×800`, Min `960×640`), Sandbox-/ContextIsolation-Nachweis, IPC-Validierung, Menü-Command-Routing und Close-Handshake. |

---

## 2. Dokumentierte externe CAS-Restgrenze beim atomaren Speichern

Gemäß [docs/contracts.md](../contracts.md) (Abschnitt *Dateizugriff und Speicherzustand*) und Entscheidung `AG-03` in [docs/concerns.md](../concerns.md) führt `DocumentPersistenceService` in [electron/persistence.ts](../../electron/persistence.ts) eine zweistufige Versionsprüfung durch:

1. **Erste Prüfung vor Tempfile-Anlage:** Vor dem Anlegen der exklusiven temporären Datei (`.<name>.<random>.tmp`, Flag `wx`, Modus `0o600`) im Zielverzeichnis wird der aktuelle Dateiinhalt gelesen und sein SHA-256-`versionToken` mit `expectedVersionToken` verglichen.
2. **Serialisierung im Main-Prozess:** Parallele Speicheranfragen für dasselbe Handle bzw. denselben kanonischen Dateipfad werden über eine prozessinterne Lock-Queue (`runWithFileLock`) streng nacheinander ausgeführt.
3. **Zweite Prüfung unmittelbar vor `rename`:** Nachdem die neuen Bytes vollständig in die Tempdatei geschrieben, per `fileHandle.sync()` (`fsync`) auf das Speichermedium geflusht und per `fileHandle.close()` geschlossen wurden, liest und hasht der Main-Prozess die Zieldatei unmittelbar vor `fs.rename(tempPath, targetPath)` erneut. Weicht der Hash ab, wird `rename` abgebrochen, die Tempdatei gelöscht und `{ status: 'conflict' }` zurückgegeben.
4. **Verbleibende Betriebssystem-Restgrenze:** Da POSIX- und Windows-Dateisysteme keinen plattformübergreifenden atomaren Kernel-Syscall der Form `rename_if_target_sha256_equals(tempPath, targetPath, expectedHash)` ohne kooperative Sperren bereitstellen, verbleibt zwischen dem Abschluss des zweiten Lese-/Hash-Vorgangs und dem `rename`-Syscall ein mikroskopisches Kernel-TOCTOU-Fenster gegenüber unkoordinierten externen Prozessen, die exakt in derselben Mikrosekunde schreiben. Innerhalb von Sketchdraw selbst sind konkurrierende Schreibzugriffe durch die prozessinterne Dateisperre vollständig ausgeschlossen.

---

## 3. Neue Bedenken und Hinweise für die Integration

### AG-D01 (P2 / Mittel) — `esbuild`-Pfadalias-Auflösung in `scripts/build-electron.mjs`

- **Betroffener Bereich:** Electron-Build ([scripts/build-electron.mjs](../../scripts/build-electron.mjs), [tsconfig.json](../../tsconfig.json), [tsconfig.electron.json](../../tsconfig.electron.json))
- **Trigger:** `tsconfig.electron.json` definiert `"paths": { "@/*": ["./src/*"] }`, die Root-`tsconfig.json` enthält jedoch nur `"references"` ohne eigene `"paths"`, und `scripts/build-electron.mjs` übergibt kein `tsconfig: 'tsconfig.electron.json'` an `esbuild`.
- **Auswirkung:** Würden Dateien unter `electron/` den Alias `@/domain/...` verwenden, könnte `tsc -p tsconfig.electron.json` erfolgreich durchlaufen, während `esbuild` den Alias ohne explizite `tsconfig`-Angabe nicht auflöst.
- **Umgesetzte Gegenmaßnahme / Empfehlung:** Alle Module unter `electron/` und `src/platform/` verwenden explizite relative Imports (`../src/domain/index`, `../src/domain/types`), die sowohl von `tsc`, `vue-tsc`, `vitest` als auch von `esbuild` ohne Alias-Abhängigkeit aufgelöst werden. Optional kann Codex in `scripts/build-electron.mjs` zusätzlich `tsconfig: path.join(rootDir, 'tsconfig.electron.json')` ergänzen.

### AG-D02 (P1 / Hoch) — Sandboxed Preload (`sandbox: true`) darf keine Node-Builtins im Preload-Bundle referenzieren

- **Betroffener Bereich:** Electron Preload ([electron/preload.ts](../../electron/preload.ts), [electron/ipc-contract.ts](../../electron/ipc-contract.ts))
- **Trigger:** Mit `sandbox: true` stellt Electron im Preload-Kontext kein volles Node-`require` für Dateisystem- oder Pfadmodule (`node:fs`, `node:path`, `node:crypto`) bereit, sondern nur das Sandbox-Shim für `require('electron')`.
- **Auswirkung:** Ein transitiver Import von `node:fs` oder `node:path` in `electron/preload.ts` würde im gebündelten `dist-electron/preload.cjs` zur Laufzeit beim Fensterstart mit `Unable to load preload script` fehlschlagen, sodass `window.sketchdraw` im Renderer fehlen würde.
- **Umgesetzte Gegenmaßnahme / Validierung:** `electron/ipc-contract.ts` und `electron/preload.ts` sind vollständig frei von `node:*`-Imports; `tests/electron/desktop.spec.ts` prüft im echten gebündelten Electron-Fenster (`sandbox: true`), dass `window.sketchdraw` erfolgreich initialisiert ist und `window.require`/`window.process` isoliert bleiben.

### AG-D03 (P2 / Mittel) — Zusammenspiel zwischen Renderer-Speicherfluss und `respondToClose` bei „Speichern & Schließen"

- **Betroffener Bereich:** Close-Handshake zwischen `electron/` und `src/renderer/` ([electron/close-handshake.ts](../../electron/close-handshake.ts), `src/renderer/`)
- **Trigger:** Der Nutzer schließt das Fenster bei ungespeicherten Änderungen und wählt im Renderer-Dialog „Speichern und Schließen", woraufhin `saveDocument` aufgerufen wird, das wegen externer Dateiänderung `{ status: 'conflict' }` oder im Browser `{ status: 'download-initiated' }` liefert.
- **Auswirkung:** Würde der Renderer nach jedem nicht-werfenden `saveDocument`-Aufruf pauschal `respondToClose(requestId, 'close')` senden, gingen ungespeicherte Änderungen bei `'conflict'`, `'cancelled'` oder `'error'` verloren.
- **Alternative / Vertragsregel für UI-Integration (#10/#15):** Der Renderer darf bei „Speichern und Schließen" ausschließlich dann `respondToClose(requestId, 'close')` aufrufen, wenn `saveDocument` exakt `{ status: 'saved' }` zurückgibt; bei `'conflict'`, `'cancelled'` oder `'error'` muss `respondToClose(requestId, 'cancel')` gesendet und die Konflikt-/Fehlermeldung im geöffneten Fenster angezeigt werden.

---

## 4. Nicht ausgeführte Prüfungen (durch Codex auszuführen)

Da in diesem Lauf gemäß Vorgabe keine Shell-/Terminalbefehle (`run_command`) verwendet werden durften und `src/domain/index.ts` (#9) sowie `src/renderer/main.ts` (#10) parallel integriert werden, wurden folgende Prüfungen noch **nicht** ausgeführt:

1. `npm run typecheck` (`vue-tsc -p tsconfig.app.json --noEmit && tsc -p tsconfig.electron.json --noEmit && tsc -p tsconfig.node.json --noEmit`) — *nicht ausgeführt (kein Shell-Zugriff in diesem Lauf; benötigt zudem `src/domain/index.ts` aus #9 und `src/renderer/main.ts` aus #10).*
2. `npm run build:electron` (`node scripts/build-electron.mjs`) — *nicht ausgeführt (kein Shell-Zugriff; benötigt `src/domain/index.ts` aus #9).*
3. `npm run test:unit` (`vitest run --config vitest.config.ts`) — *nicht ausgeführt (kein Shell-Zugriff; führt `tests/unit/platform/persistence.spec.ts`, `tests/unit/platform/security-and-ipc.spec.ts` und `tests/unit/platform/browser-bridge.spec.ts` gegen `src/domain/index.ts` aus).*
4. `npm run test:electron` (`node scripts/build-electron.mjs && vite build && playwright test --config playwright.config.ts --project=electron`) — *nicht ausgeführt (kein Shell-Zugriff; benötigt den gebauten Renderer aus #10).*
