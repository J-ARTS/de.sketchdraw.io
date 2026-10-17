# Reparaturbericht (Antigravity) zu den Desktop-Befunden #17, #22 und #23 (Issues #8 / #15)

- **Verantwortlicher Agent / Rolle:** Google Antigravity (`logic`, `interface`, `iam`, `devops`)
- **Modell:** Gemini 4 Argon (High)
- **Bezug:** Issues [#8](https://github.com/J-ARTS/de.sketchdraw.io/issues/8), [#15](https://github.com/J-ARTS/de.sketchdraw.io/issues/15), Bugs [#17](https://github.com/J-ARTS/de.sketchdraw.io/issues/17), [#22](https://github.com/J-ARTS/de.sketchdraw.io/issues/22), [#23](https://github.com/J-ARTS/de.sketchdraw.io/issues/23), Review-Befunde in [docs/reviews/codex-desktop-findings.md](./codex-desktop-findings.md)
- **Werkzeugeinsatz & Bereichstreue:** Ausschließlich Dateiwerkzeuge (`view_file`, `write_to_file`, `replace_file_content`). Keine Shell-/Terminalbefehle (`run_command`), keine Berechtigungsänderungen. Unabhängige Regressionstests ([tests/unit/desktop-review.spec.ts](../../tests/unit/desktop-review.spec.ts), [tests/unit/desktop-security.spec.ts](../../tests/unit/desktop-security.spec.ts)) sowie Domain-, Renderer-, Konfigurations-, Ledger- und Graph-Dateien blieben unangetastet.

---

## 1. Behobene Befunde

### Bug #17 — Vertrauenswürdige `app://sketchdraw`-Seite trotz WHATWG `origin === 'null'` sicher erkennen ([electron/security.ts](../../electron/security.ts))

- **Ursache:** Der WHATWG-URL-Parser in Node.js liefert für nicht-spezielle Custom-Schemata wie `app://sketchdraw/index.html` die Eigenschaft `parsed.origin === 'null'`. Ein direkter Vergleich `parsed.origin !== allowedOrigin` wies daher die gebündelte Hauptseite `app://sketchdraw/index.html` bzw. `app://sketchdraw/` ab.
- **Fix:** In [`matchesAllowedOrigin`](../../electron/security.ts#L158-L228) und [`isAllowedRendererUrl`](../../electron/security.ts#L230-L249) wird `allowedOrigin` strukturiert geparst und ausschließlich für zwei Kategorien zugelassen:
  1. Das privilegierte App-Schema (`protocol === 'app:'`, `hostname === 'sketchdraw'`, `port === ''`, `host === 'sketchdraw'`), oder
  2. Eine explizite Tupel-Origin mit `expected.origin !== 'null'` (z. B. `http://127.0.0.1:5173` im unpaketierten Dev-Modus).
- **Sicherheitsgrenzen:**
  - Für die zu prüfende URL werden `protocol`, `hostname`, `port`, `host`, leere Credentials (`username === ''`, `password === ''`), die exakte Roh-Authority nach `<scheme>//` (wehrt auch leere Credential-/Port-Trennzeichen wie `app://sketchdraw@/index.html` oder `app://sketchdraw:/index.html` ab) sowie die erlaubten Einstiegspfade (`/` oder `/index.html`) geprüft.
  - Andere opaque Origins (`file:///index.html`, `data:text/html,app`, `blob:...`), abweichende Hosts/Ports/Authorities (`app://attacker/index.html`, `app://sketchdraw.evil/index.html`, `app://user@sketchdraw/index.html`, `app://sketchdraw:123/index.html`), andere Pfade (`app://sketchdraw/other.html`) und Subframes (`senderFrame.parent !== null`) werden weiterhin strikt abgewiesen.

### Bug #22 — Zielzustand-Guard für `save-as` und `exportFile` nach Dialogbestätigung und vor `rename` ([electron/persistence.ts](../../electron/persistence.ts))

- **Ursache:** Bei `save-as` und `exportFile` wurde `writeBufferAtomically` ohne erwarteten Zielzustand aufgerufen, sodass zwischen der Rückkehr des nativen Speicherdialogs und `fs.rename(tempPath, targetPath)` eine extern geänderte oder neu angelegte Datei überschrieben werden konnte.
- **Fix:**
  - Unmittelbar nach dem nativen Dialog und der Pfadkanonisierung wird der bestätigte Zielzustand auf der Festplatte über [`readDiskVersionToken`](../../electron/persistence.ts#L604-L641) als `ExpectedTargetState` erfasst:
    - Existiert die Zieldatei bereits, wird `{ kind: 'version', versionToken }` als Guard gespeichert.
    - Existiert die Zieldatei noch nicht (`ENOENT`), wird `{ kind: 'missing' }` als expliziter Abwesenheits-Guard gespeichert.
  - [`writeBufferAtomically`](../../electron/persistence.ts#L728-L814) prüft über [`verifyTargetState`](../../electron/persistence.ts#L643-L726) sowohl **vor** dem Anlegen der exklusiven Tempdatei (`wx`, `0o600`) als auch **nach** `writeFile` + `sync` + `close` unmittelbar **vor** `rename`, dass:
    - bei `{ kind: 'version' }` die Zieldatei weiterhin existiert und denselben SHA-256-`versionToken` besitzt, bzw.
    - bei `{ kind: 'missing' }` zwischenzeitlich keine Datei am Zielpfad angelegt wurde.
  - Bei Abweichung wird `rename` nicht ausgeführt, die temporäre Geschwisterdatei im `finally`-Block garantiert per `unlink` gelöscht und bei `save-as` `{ status: 'conflict' }` bzw. bei `exportFile` `{ status: 'error', code: 'EXPORT_CONFLICT' }` zurückgegeben.

### Bug #23 — Kanonische Dateiidentität (`realpath`), gemeinsame Sperre über Verzeichnis-Symlinks und Erhalt von Datei-Symlinks ([electron/persistence.ts](../../electron/persistence.ts))

- **Ursache:** `path.resolve` löst weder Verzeichnis-Symlinks noch Datei-Symlinks auf. Dadurch erhielten zwei Pfade auf dieselbe reale Datei über einen Verzeichnis-Alias getrennte Locks, und ein `rename` auf einen geöffneten Datei-Symlink ersetzte den Symlink durch eine reguläre Datei statt das reale Ziel zu aktualisieren.
- **Fix:**
  - Bestehende Ziele werden über [`resolveCanonicalExistingPath`](../../electron/persistence.ts#L525-L527) mittels `realpath` kanonisiert; potenziell neue Ziele bei `save-as` und `exportFile` werden über [`resolveCanonicalTargetPath`](../../electron/persistence.ts#L529-L541) zuerst per `realpath(resolved)` und bei `ENOENT` über `path.join(await realpath(path.dirname(resolved)), path.basename(resolved))` aufgelöst. `PersistenceFsAdapter.realpath` ist optional und fällt standardmäßig auf `fs.realpath` zurück, sodass bestehende Adapter-Mocks ohne `realpath`-Methode voll kompatibel bleiben.
  - `HandleRecord` bindet `handleId`, `selectedPath`, `canonicalPath` und `versionToken` gemeinsam. Die prozessinterne Lock-Queue (`fileLocks`) und der kanonische Versionsstand (`canonicalVersionByPath`, synchronisiert über [`syncCanonicalVersion`](../../electron/persistence.ts#L569-L579)) arbeiten ausschließlich auf `canonicalPath`.
  - Parallele `save`-Aufrufe auf dieselbe reale Datei über unterschiedliche Verzeichnis-Aliase teilen sich damit dieselbe Sperre; nach Abschluss des ersten Schreibvorgangs erkennt der zweite Aufruf den geänderten Versionsstand und bricht deterministisch mit `{ status: 'conflict' }` ab.
  - Wird ein Dokument über einen Datei-Symlink geöffnet und gespeichert, erfolgt das atomare Schreiben und `rename` auf die aufgelöste reale Zieldatei (`canonicalPath`), während der Datei-Symlink unter `selectedPath` unverändert als symbolischer Link erhalten bleibt.
  - Zusätzlich prüft [`verifyTargetState`](../../electron/persistence.ts#L643-L726) vor dem Schreiben und unmittelbar vor `rename`, dass `selectedPath` weiterhin auf denselben `targetPath` (`canonicalPath`) zeigt; ein externes Umbiegen eines Symlinks zwischen Öffnen/Dialog und `rename` führt zu `{ status: 'conflict' }` (bzw. `EXPORT_CONFLICT`).

---

## 2. Dokumentierte Betriebssystem-Restgrenze und Integrationsnachweise

- **OS-Restgrenze beim atomaren `rename`:** Prozessintern sind konkurrierende Zugriffe auf dieselbe reale Zieldatei über `runWithFileLock(canonicalPath)` vollständig serialisiert. Gegenüber unkoordinierten externen Betriebssystemprozessen minimiert die zweistufige Prüfung (vor Tempfile-Anlage sowie unmittelbar nach `fsync`/`close` vor `rename`) das Konfliktfenster auf das kleinstmögliche Userspace-Intervall. Da POSIX- und Windows-Kernel keinen plattformübergreifenden atomaren `rename-if-content-hash-equals`-Syscall bereitstellen, verbleibt im Sub-Millisekundenbereich zwischen der zweiten Prüfung und dem `rename`-Syscall sowie bei externen Symlink-Umbiegungen genau in diesem Mikrofenster eine prinzipielle Betriebssystem-Restgrenze ohne kooperative/mandatory Kernel-Locks.
- **Fortbestehende Integrationsnachweise aus dem Erstlauf (`AG-D01` bis `AG-D03`):**
  - `AG-D01`: Alle `electron/`- und `src/platform/`-Module nutzen explizite relative Imports ohne `@/`-Alias-Abhängigkeit.
  - `AG-D02`: `electron/preload.ts` und `electron/ipc-contract.ts` benötigen keinerlei Node-Builtins (`node:*`), sodass das Preload-Skript unter `sandbox: true`, `contextIsolation: true` und `nodeIntegration: false` lauffähig bleibt.
  - `AG-D03`: Der Renderer darf beim Close-Handshake nach „Speichern und Schließen" nur bei `{ status: 'saved' }` mit `respondToClose(requestId, 'close')` antworten und muss bei `'conflict'`, `'cancelled'`, `'error'` oder `'download-initiated'` das Schließen mit `'cancel'` abbrechen. Eine fertige GUI wird in diesem Desktop-Backend-Bericht ausdrücklich **nicht** behauptet.

---

## 3. Geänderte Dateien

- [electron/security.ts](../../electron/security.ts) — `matchesAllowedOrigin` und `isAllowedRendererUrl` für `app://sketchdraw` (`origin === 'null'`) und strikte Authority-/Pfad-/Subframe-Abwehr (#17).
- [electron/persistence.ts](../../electron/persistence.ts) — `ExpectedTargetState`-Guards für `save-as` und `exportFile` (#22) sowie `realpath`-Kanonisierung für bestehende Ziele/Elternverzeichnisse, gemeinsame kanonische Sperren/Versionen und Erhalt von Datei-Symlinks (#23).
- [src/platform/browser-bridge.ts](../../src/platform/browser-bridge.ts) — Typbereinigung des Fehler-Rückgabewerts in `triggerBlobDownload` ohne Verhaltensänderung.
- [tests/unit/platform/security-and-ipc.spec.ts](../../tests/unit/platform/security-and-ipc.spec.ts) — Ergänzte Unit-Assertions für `isAllowedRendererUrl` mit `app://sketchdraw` und abzuweisenden opaken Origins/Authorities (#17).
- [tests/unit/platform/persistence.spec.ts](../../tests/unit/platform/persistence.spec.ts) — Ergänzte Unit-Tests für `save-as`-/`exportFile`-Pre-Rename-Guards (#22) sowie Verzeichnis-Symlink-Locks und Datei-Symlink-Erhalt (#23).

---

## 4. Prüfungen (durch Codex in der Shell auszuführen)

Gemäß Auftrag wurden in diesem Lauf keine Shell-Befehle (`run_command`) ausgeführt. Folgende Prüfungen sind durch Codex auf dem unveränderten Testbestand auszuführen:

1. `npx vitest run tests/unit/desktop-security.spec.ts tests/unit/desktop-review.spec.ts tests/unit/platform/` — *nicht ausgeführt (Auftrag untersagt Shell-Zugriff in diesem Lauf; durch Codex auszuführen).*
2. `npx tsc -p tsconfig.electron.json --noEmit` — *nicht ausgeführt (kein Shell-Zugriff in diesem Lauf; durch Codex auszuführen).*
3. `npm run build:electron` — *nicht ausgeführt (kein Shell-Zugriff in diesem Lauf; durch Codex auszuführen).*
4. `npm run test:electron` — *nicht ausgeführt (kein Shell-Zugriff; erfordert gebauten Renderer und echte Electron-Laufzeitprüfung durch Codex).*
