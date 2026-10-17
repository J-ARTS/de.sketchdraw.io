# Architektur-, Sicherheits- und Bedenkenbericht: Cross-Platform Release-Pipeline (Issue #24)

- **Werkzeug / Agent:** Google Antigravity
- **Modell / Modus:** Gemini 4 Argon High (Implementer Mode, reine Dateiwerkzeuge gemäß Auftragsstriktion)
- **Zugeordnetes Ticket:** Issue #24 (`devops`, `interface`, `testing`)
- **Geänderte / erstellte Dateien:**
  - `electron-builder.json`
  - `.github/workflows/ci.yml`
  - `.github/workflows/release.yml`
  - `scripts/release.mjs`
  - `tests/unit/release.test.mjs`
  - `docs/release.md`
  - `docs/reviews/antigravity-release-pipeline.md`

---

## 1. Zusammenfassung der Implementierung

1. **Deterministische Zielartefakte (`electron-builder.json` & `scripts/release.mjs`):**
   - **Windows x64:** Target `nsis` (`x64`) auf `windows-2025` $\rightarrow$ `Sketchdraw-<version>-windows-x64.exe`
   - **macOS Apple Silicon (M1/arm64):** Target `dmg` (`arm64`) auf `macos-15` $\rightarrow$ `Sketchdraw-<version>-macos-arm64.dmg`
   - **Linux Debian/Ubuntu x64:** Target `deb` (`x64`) auf `ubuntu-24.04` $\rightarrow$ `Sketchdraw-<version>-linux-x64.deb`
   - Automatisches Veröffentlichen in `electron-builder` ist sowohl in `electron-builder.json` (`"publish": null`) als auch beim CLI-Aufruf (`--publish never` sowie Entfernen von `GITHUB_TOKEN`/`GH_TOKEN` aus der Subprozess-Umgebung von `electron-builder`) deaktiviert.
   - Zusatzdateien (`*.blockmap`, `latest*.yml`, `builder-debug.yml`, `builder-effective-config.yaml`) werden durch `nsis.differentialPackage: false`, `dmg.writeUpdateInfo: false`, isoliertes Staging (`release/staged/<platform>/`) und einen expliziten Verbotsfilter (`FORBIDDEN_RELEASE_ASSET_PATTERNS`) strikt ausgeschlossen.

2. **Revisionssichere CI- und Release-Orchestrierung (`.github/workflows/ci.yml` & `.github/workflows/release.yml`):**
   - `.github/workflows/ci.yml` unterstützt nun zusätzlich `workflow_call` mit optionalem `commit_sha`-Input, ohne bestehende Prüfungen zu entfernen (`governance-and-graphify`, `typecheck:config`, `typecheck`, `node --test tests/unit/*.test.mjs`, `npm run test:unit`, `npm run build`, Playwright `test:ui`, Playwright `test:electron` mit `xvfb-run` unter Linux sowie `npm run package`).
   - `.github/workflows/release.yml` prüft in `preflight` das Tag-Format `v<package.version>`, die Existenz des Git-Tags und den exakten 40-stelligen Commit-SHA, führt danach `ci-verification` auf exakt diesem Commit aus, baut und testet in `package-installers` auf `windows-2025`, `macos-15` und `ubuntu-24.04` (mit `contents: read`) und vergibt `contents: write` ausschließlich an den finalen Job `publish-release`.

3. **Draft-First-Release, Remote-Asset-Prüfung und Idempotenz (`scripts/release.mjs`):**
   - Vor jedem GitHub-API-Schreibzugriff werden alle drei lokalen Installer und ihre `.manifest.json`-Dateien auf Anzahl (exakt 3), Namen, Mindestgröße, Binärheader, Architektur, Commit-SHA, Version und SHA-256-Prüfsumme validiert.
   - Das Release wird am bestehenden Tag zunächst als **Draft** (`--draft --verify-tag`) angelegt bzw. aktualisiert, die 3 Installer werden hochgeladen, über `gh api` remote auf Vollständigkeit/Größe/Digest geprüft und erst danach auf `--draft=false` umgestellt.
   - Die Release-Beschreibung wird über `--notes-file` übergeben und enthält die drei finalen Asset-Downloadlinks sowie die SHA-256-Prüfsummen als Tabelle und Textblock (keine separaten Checksummen-Dateien als Release-Assets).

---

## 2. Notwendige `package.json`-Ergänzungen für Codex

Da `package.json` und `package-lock.json` gemäß Auftragsstriktion nicht durch Antigravity bearbeitet wurden, sind folgende Punkte durch **Codex** bei der Integration zu berücksichtigen:

### 2.1 Metadaten in `package.json`
In `package.json` fehlen derzeit `homepage`, `repository`, `author`, `license` und optional `desktopName`.
- **Bereits wirksamer Schutz in `electron-builder.json`:** Damit `electron-builder` beim Linux-`.deb`-Build (`FpmTarget.computeFpmMetaInfoOptions`) nicht wegen fehlender `author`/`homepage`-Felder abbricht, wurden in `electron-builder.json` bereits `"linux.maintainer": "J-ARTS"` und `"extraMetadata.homepage": "https://github.com/J-ARTS/de.sketchdraw.io"` (echte Repository-Daten aus `AGENTS.md`, ohne erfundene E-Mail-Adresse) hinterlegt.
- **Empfohlene Ergänzung in `package.json` durch Codex:**
  ```json
  {
    "homepage": "https://github.com/J-ARTS/de.sketchdraw.io",
    "repository": {
      "type": "git",
      "url": "https://github.com/J-ARTS/de.sketchdraw.io.git"
    },
    "author": "J-ARTS"
  }
  ```
  *Hinweis zu `license` und E-Mail-Adresse:* Bitte keine Lizenz (wie `MIT`) oder E-Mail-Adresse ohne Rücksprache mit dem Repository-Eigentümer eintragen; solange `"private": true` gesetzt ist und keine Lizenzentscheidung vorliegt, kann `"license": "UNLICENSED"` verwendet oder die Lizenzentscheidung explizit eingeholt werden.

### 2.2 Optionale NPM-Skripte in `package.json`
Die Workflows rufen `node scripts/release.mjs <subcommand>` direkt auf und funktionieren daher **ohne** Änderung an `package.json`. Für die lokale Entwicklerergonomie kann Codex optional folgende Skripte in `package.json` aufnehmen:
```json
{
  "scripts": {
    "release:preflight": "node scripts/release.mjs preflight",
    "release:verify-env": "node scripts/release.mjs verify-env",
    "release:package": "node scripts/release.mjs package",
    "release:validate": "node scripts/release.mjs validate-artifacts",
    "release:publish": "node scripts/release.mjs publish"
  }
}
```

---

## 3. Technische Bedenken und Architekturentscheidungen (für `docs/concerns.md`)

### Bedenken 1: Abweichendes `${arch}`-Token für Debian-Pakete in `electron-builder` (`amd64` statt `x64`)
- **Betroffene Anforderung:** Exakter Dateiname `Sketchdraw-<version>-linux-x64.deb` beim Target `deb` (`x64`).
- **Fehlerfall:** In `builder-util/out/arch.js` (`electron-builder@26.15.3`) übersetzt `getArtifactArchName(Arch.x64, "deb")` die Architektur `x64` für `.deb`-Ziele automatisch in den Debian-Architekturnamen `"amd64"`. Ein Template `${productName}-${version}-linux-${arch}.${ext}` würde daher `Sketchdraw-0.1.0-linux-amd64.deb` erzeugen.
- **Auswirkung:** Der Release-Job würde das Paket unter falschem Namen erzeugen und die strikte Namensvalidierung (`Sketchdraw-<version>-linux-x64.deb`) würde fehlschlagen.
- **Umgesetzte Lösung:** In `electron-builder.json` ist das Ziel strikt auf `[{ "target": "deb", "arch": ["x64"] }]` festgelegt und `linux.artifactName` / `deb.artifactName` explizit auf `"${productName}-${version}-linux-x64.${ext}"` gesetzt. Die tatsächliche `x64`-Architektur wird zusätzlich vor dem Build über `process.arch === 'x64'` und nach dem Build über den ELF64-Header (`EM_X86_64 = 0x003e`) der entpackten Binärdatei verifiziert.
- **Vorgeschlagene Prüfung:** Unit-Test in `tests/unit/release.test.mjs` sowie Linux-Packaging-Lauf auf `ubuntu-24.04`.

### Bedenken 2: `FpmTarget`-Metadatenpflicht (`maintainer` & `homepage`) bei `.deb`-Erstellung
- **Betroffene Anforderung:** Fehlerfreier `.deb`-Build ohne erfundene E-Mail-Adressen oder Lizenzangaben.
- **Fehlerfall:** `app-builder-lib/out/targets/FpmTarget.js` (`computeFpmMetaInfoOptions`) bricht mit `Please specify "author" in the application package.json` bzw. `Please specify "homepage"` ab, wenn weder `package.json` noch `electron-builder.json` diese Werte liefern.
- **Auswirkung:** Der Linux-Release-Build würde auf `ubuntu-24.04` trotz erfolgreichem Vite/Electron-Build im letzten Schritt (`fpm`) abbrechen.
- **Umgesetzte Lösung:** In `electron-builder.json` wurden `"linux.maintainer": "J-ARTS"` (wodurch `FpmTarget.js` den `package.json`-Author-Check überspringt) und `"extraMetadata.homepage": "https://github.com/J-ARTS/de.sketchdraw.io"` gesetzt.
- **Vorgeschlagene Prüfung:** Ausführung von `node scripts/release.mjs package --platform linux --tag v0.1.0 --commit <sha>` auf Linux.

### Bedenken 3: Native Lauffähigkeit auf macOS Apple Silicon (`arm64`) ohne Apple Developer ID
- **Betroffene Anforderung:** Native Ausführbarkeit von `Sketchdraw-<version>-macos-arm64.dmg` auf Apple Silicon (M1/arm64) auch dann, wenn noch keine Apple-Signing-Secrets konfiguriert sind.
- **Fehlerfall:** Auf Apple Silicon (`arm64`) erzwingt der macOS-Kernel (AMFI) eine gültige Code-Signatur für jede Mach-O-Binärdatei. Wenn `electron-builder` das vorgefertigte `Electron.app`-Bundle modifiziert (`Info.plist`, `Resources/app.asar`) und das Signieren komplett übersprungen wird (`identity: null`), wird die bestehende Signatur des Bundles ungültig; macOS beendet die App beim Start sofort (`SIGKILL` / `Code Signature Invalid`) oder verweigert V8-JIT-Speicher (`com.apple.security.cs.allow-jit`).
- **Auswirkung:** Ein komplett unsigniertes (`identity: null`) `arm64`-App-Bundle wäre auf Apple Silicon nicht nativ lauffähig.
- **Umgesetzte Lösung:** Wenn weder `CSC_LINK` noch `CSC_NAME` konfiguriert ist, setzt `resolveSigningConfiguration('mac', env)` in `scripts/release.mjs` explizit `-c.mac.identity=-`, `-c.mac.notarize=false`, `-c.mac.timestamp=none` und `CSC_IDENTITY_AUTO_DISCOVERY=false`. In `app-builder-lib@26.15.3` führt `identity="-"` eine lokale Ad-hoc-Signierung über `@electron/osx-sign` inklusive der Standard-Electron-Entitlements (`allow-jit`, `allow-unsigned-executable-memory`, `disable-library-validation`) und `codesign --verify --deep --strict` durch, ohne ein Apple-Zertifikat oder eine Team-ID zu erfinden. Sobald echte Secrets (`CSC_LINK` + `APPLE_API_KEY`/`APPLE_ID`) hinterlegt sind, schaltet `resolveSigningConfiguration` automatisch auf Developer-ID-Signierung und Notarisierung um.
- **Vorgeschlagene Prüfung:** Unit-Test `resolveSigningConfiguration` in `tests/unit/release.test.mjs` sowie macOS-Packaging-Lauf auf `macos-15`.

### Bedenken 4: NSIS-Installer-Stub (`0x014c`) vs. entpackte Windows-x64-Anwendungsbinärdatei (`0x8664`)
- **Betroffene Anforderung:** Binär- und Architekturvalidierung für `Sketchdraw-<version>-windows-x64.exe`.
- **Fehlerfall:** `makensis` erzeugt für den äußeren NSIS-Setup-Wrapper standardmäßig einen 32-Bit-Unicode-PE-Stub (`IMAGE_FILE_MACHINE_I386 = 0x014c`), der beim Ausführen das 64-Bit-Anwendungsarchiv (`x64`) entpackt. Eine naive Prüfung, die am äußeren NSIS-Setup-Wrapper `0x8664` erzwingt, würde valide NSIS-x64-Installer fälschlich ablehnen.
- **Auswirkung:** Falsch-negative Abbrüche beim Windows-Packaging.
- **Umgesetzte Lösung:** `scripts/release.mjs` führt eine zweistufige Binärprüfung durch:
  1. `verifyUnpackedBinaryArchitecture` prüft die tatsächliche Anwendungsbinärdatei `release/win-unpacked/Sketchdraw.exe` strikt auf PE `0x8664` (`x64`).
  2. `verifyInstallerBinaryHeader` prüft den äußeren NSIS-Installer auf einen validen PE-Header (`MZ` + `PE\0\0`) und dokumentiert das Ergebnis im signierten Build-Manifest (`<installer>.manifest.json`), das in `publish-release` gegen `unpackedArch === "x64"` geprüft wird.
- **Vorgeschlagene Prüfung:** Binärheader-Unit-Tests in `tests/unit/release.test.mjs`.

### Bedenken 5: Spätere MCP-Adapter-Bündelung (`dist-electron/`)
- **Betroffene Anforderung:** Vorbereitung auf einen später gebündelten MCP-Adapter ohne unehrliche Prüfbehauptungen für noch nicht existierende Dateien.
- **Fehlerfall:** Würde `verifyBuildPrerequisites()` bereits heute nach einer Datei wie `dist-electron/mcp-server.cjs` suchen, würde der Build scheitern; würde behauptet, diese Datei sei bereits geprüft, wäre der Prüfbericht unehrlich.
- **Umgesetzte Lösung:** `electron-builder.json` bündelt `dist-electron/**/*`, sodass künftige MCP-Adapter-Artefakte in `dist-electron/` automatisch in `app.asar` aufgenommen werden. `verifyBuildPrerequisites()` prüft aktuell exakt die vorhandenen Dateien (`dist/index.html`, `dist-electron/main.cjs`, `dist-electron/preload.cjs`).
- **Vorgeschlagene Prüfung:** Nach Implementierung des MCP-Adapters Ergänzung des Dateipfads in `verifyBuildPrerequisites()` und `scripts/verify-entrypoints.mjs`.

---

## 4. Prüfstatus (Ehrliche Ausweisung gemäß `AGENTS.md`)

Da in diesem Implementierungslauf gemäß strikter Auftrags- und Werkzeugvorgabe ausschließlich Dateiwerkzeuge ohne Shell-/Prozessausführung eingesetzt wurden, sind alle Laufzeitprüfungen offen als **nicht ausgeführt** markiert und durch Codex auszuführen:

| Prüfung / Befehl | Status | Grund / Hinweis für Codex |
| --- | --- | --- |
| `node --test tests/unit/release.test.mjs` | **nicht ausgeführt** | Keine Shell-/Prozessausführung durch Antigravity gemäß Auftragsstriktion; durch Codex auszuführen |
| `node --test tests/unit/*.test.mjs` | **nicht ausgeführt** | Keine Shell-/Prozessausführung durch Antigravity gemäß Auftragsstriktion; durch Codex auszuführen |
| `npm run typecheck:config` | **nicht ausgeführt** | Keine Shell-/Prozessausführung durch Antigravity gemäß Auftragsstriktion; durch Codex auszuführen |
| `npm run typecheck` | **nicht ausgeführt** | Keine Shell-/Prozessausführung durch Antigravity gemäß Auftragsstriktion; durch Codex auszuführen |
| `npm run test:unit` | **nicht ausgeführt** | Keine Shell-/Prozessausführung durch Antigravity gemäß Auftragsstriktion; durch Codex auszuführen |
| `npm run build` | **nicht ausgeführt** | Keine Shell-/Prozessausführung durch Antigravity gemäß Auftragsstriktion; durch Codex auszuführen |
| `npm run package` | **nicht ausgeführt** | Keine Shell-/Prozessausführung durch Antigravity gemäß Auftragsstriktion; durch Codex auszuführen |
