# Release-Pipeline und Desktop-Packaging (Issue #24)

Die Pipeline baut Windows-, macOS- und Linux-Installer aus derselben bestätigten Git-Revision. Veröffentlichung setzt erfolgreiche Produkt-, Installer- und MCP-Prüfungen voraus. Für v0.1.1 an `c4bdfd6` sind die gesamte Produkt-CI und alle drei nativen Installerprüfungen einschließlich tatsächlichem GUI-/MCP-Start bestanden. Veröffentlichungsstand, konkrete Artefakte und historische Korrekturen stehen im [konsolidierten Nachweis](reviews/release-validation.md).

## Veröffentlichtes Release

[Version 0.1.1](https://github.com/J-ARTS/de.sketchdraw.io/releases/tag/v0.1.1) wurde am 17. Oktober 2026 um 16:27:58 UTC aus den unveränderten CI-Artefakten von `c4bdfd6` veröffentlicht. Genau drei öffentliche Downloads wurden erneut heruntergeladen und gegen die nativen Smoke-Berichte, Größen und GitHub-Digests geprüft: [maschinenlesbarer Nachweis](reviews/release-v0.1.1-verification.json).

Der erste Publish-Versuch in GitHub Actions scheiterte an der Draft-Suche (#28). Codex nahm das vorhandene Bot-Draft mit dem korrigierten Publisher lokal wieder auf. Anschließend bestand derselbe Actions-Lauf mit `already-published-idempotent`; dies bestätigt das vorhandene Release, ohne es erneut zu verändern. Der ursprüngliche Fehlschlag bleibt im Verlauf erhalten. Produktrevision und Tags wurden für diese Recovery nicht verschoben.

## Zielartefakte

| Plattform | Architektur | Runner | Installer |
| --- | --- | --- | --- |
| Windows | x64 | `windows-2025` | `Sketchdraw-<version>-windows-x64.exe` (NSIS) |
| macOS | arm64 | `macos-15` | `Sketchdraw-<version>-macos-arm64.dmg` |
| Linux | x64 / amd64 | `ubuntu-24.04` | `Sketchdraw-<version>-linux-x64.deb` |

Genau diese drei Installer werden als Release-Assets veröffentlicht. Manifeste und Smoke-Berichte bleiben Actions-Prüfarbelege. Blockmaps, Updater-Dateien, Debug-Dateien und zusätzliche Archive werden beim Staging und beim Sammeln abgewiesen. Die von GitHub selbst angebotenen Quellcode-Downloads zählen nicht zu den drei Assets.

## Prüfungen vor der Veröffentlichung

`.github/workflows/release.yml` startet durch ein Versions-Tag oder die manuelle Wiederaufnahme eines bereits vorhandenen Tags. `preflight` gleicht Tag, `package.json` und ausgecheckte Commit-Revision ab. Tags werden durch die Skripte weder erstellt noch verschoben. Der wiederverwendbare CI-Workflow und alle Packaging-Jobs checken die ermittelte Commit-SHA aus.

CI und Packaging behalten die vorhandenen Graphify-, TypeScript-, Node-, Vitest-, Browser- und Electron-Prüfungen bei. `npm run build` erzeugt Renderer, Electron Main/Preload und den MCP-Adapter. Die drei Packaging-Jobs prüfen ihr tatsächliches Betriebssystem und ihre CPU-Architektur. Release-Parameter werden direkt über `process.env` gelesen; Windows hängt damit nicht von Bash-Variablensyntax in PowerShell ab. Nur der ausdrücklich mit `shell: bash` deklarierte Packaging-Schritt verzweigt anhand von `RUNNER_OS`, um Linux unter Xvfb auszuführen.

`scripts/release.mjs package` verlangt diese Dateien vor dem Packaging:

- `dist/index.html`
- `dist-electron/main.cjs`
- `dist-electron/preload.cjs`
- `dist-mcp/server.cjs`

`electron-builder.json` nimmt alle drei Ausgabeordner in die Anwendung auf. Electron Builder erhält `--publish never` und keine GitHub-Zugangsdaten. Ein alter Installer mit dem erwarteten Namen wird vor dem Build entfernt. Binärheader und Architekturprüfung bleiben schnelle Vorprüfungen; für die Freigabe reicht ein passender Header nicht aus.

## Tatsächlicher Installer- und Starttest

`scripts/release-installer-smoke.mjs` verarbeitet genau den erzeugten Installer in einem eigenen temporären Verzeichnis, dessen Pfad Leerzeichen enthält:

- macOS: DMG mit `hdiutil verify` prüfen, nur lesbar einhängen, die einzige App mit `ditto` kopieren und das Volume wieder aushängen.
- Windows: NSIS mit dem auf dem Runner vorhandenen 7-Zip prüfen und extrahieren; genau ein eingebettetes `app-64.7z` oder `app-64.zip` prüfen und entpacken.
- Linux: DEB-Metadaten und `amd64` prüfen, mit `dpkg-deb` extrahieren und genau eine App mit zugehörigem `resources/app.asar` finden.

Gestartet wird anschließend die aus diesem Installer extrahierte ausführbare Datei. Das prüft weder eine separate Build-Kopie noch ein Backend-Fixture an ihrer Stelle. Ein erster Lauf im Electron-Node-Modus liest das echte ASAR: Paketversion, Prozessarchitektur und SHA-256 der vier erforderlichen Bundles müssen dem gerade gebauten Stand entsprechen.

Playwright startet dieselbe Datei mit isoliertem Nutzerverzeichnis und `chromiumSandbox: true`. Geprüft werden der sichtbare Renderer unter `app://sketchdraw/index.html`, ein befülltes `#app`, die echte Preload-Bridge, `app.isPackaged`, Version, Architektur, ausführbare Datei und ASAR-Pfad sowie Sandbox, Context Isolation und deaktivierte Node-Integration. Es wird kein `--no-sandbox` gesetzt. Der Testdriver beendet nur seinen eigenen gestarteten Prozess mit begrenzten Fristen; Produktcode wird dafür nicht ersetzt.

Der MCP-Test startet ebenfalls diese ausgelieferte Electron-Datei mit `ELECTRON_RUN_AS_NODE=1` und dem absoluten ASAR-Pfad `dist-mcp/server.cjs`, aus einem fremden Arbeitsverzeichnis. Der offizielle MCP-SDK-Client prüft Initialize und die vollständige Sechs-Tool-Liste. Diese öffentlichen Metadaten benötigen laut Adaptervertrag keine Dokumentfreigabe. Ein anschließender `sketchdraw_read_document`-Aufruf mit `documentId: 'smoke'` muss ohne konfigurierte Freigabe mit `ACCESS_DENIED` antworten und darf keinen Dokumentinhalt liefern. Alle geerbten Sketchdraw-Konfigurationen werden dafür entfernt. Es gibt keinen bedingten Erfolgs-Skip. Der gewählte Auslieferungsweg setzt voraus, dass der Electron-`runAsNode`-Fuse aktiviert bleibt.

Nur ein vollständig bestandener Smoke erzeugt freigabefähige Evidenz. Der Bericht bindet Version, Commit, Plattform, Architektur, Installer-Hash und Bundle-Hashes an das Ergebnis. Das Packaging prüft ihn, prüft den unveränderten Installer-Hash erneut und legt danach Installer plus Manifest in `release/staged/<platform>/` ab. Fehler verhindern das Staging. Beim Sammeln werden exakt drei zusammengehörige Installer/Manifest-Paare einschließlich Smoke-Evidenz verlangt. Das Manifest ist ein Prüfdatensatz, keine kryptografische Signatur.

## Wiederaufnahme und Schutz vorhandener Releases

Nur der Publish-Job erhält `contents: write`. Vor jeder Mutation wird das entfernte Git-Tag bis zum Commit aufgelöst und mit der bestätigten Revision verglichen. Bereits vorhandene Releases benötigen eine positive Release-ID, das exakte Tag, den unveränderlichen Autor `github-actions[bot]` vom Typ `Bot` und genau einen passenden `sketchdraw-release-v1`-Marker. Dieser bindet Repository, Tag, Commit und die drei Dateinamen, Größen und SHA-256-Werte.

Der Tag-Endpunkt kann für ein vorhandenes Draft mit HTTP 404 antworten. Nur dann durchsucht der Publisher die vollständige paginierte Releases-Liste nach dem exakten Tag. Mehrdeutige Treffer, fehlerhafte Antworten und API-Fehler brechen ab. Die anschließend ausgeführten Identitäts- und Inhaltsprüfungen gelten unverändert. Große Installer-Uploads dürfen bis zu zehn Minuten dauern; Metadatenabfragen behalten das Zeitlimit von zwei Minuten. Ein Timeout löst keine automatische Wiederholung aus.

Jedes bereits vorhandene Asset muss einen erwarteten, eindeutigen Namen, die exakte Größe, Zustand `uploaded` und die richtigen Bytes haben. Falls GitHub einen gültigen SHA-256-Digest liefert, wird er verglichen. Andernfalls wird das echte Asset über seine ID in eine eigene temporäre Datei heruntergeladen und gehasht. Release-Notes oder Dateigröße ersetzen diesen Inhaltsnachweis nicht.

- Kein Release: neues Draft mit Marker am verifizierten vorhandenen Tag anlegen und zurücklesen.
- Eigenes passendes Draft: bereits identische Assets erhalten; ausschließlich fehlende Assets hochladen. Vor jedem Upload Zustand, Release-ID, Tag und vorhandene Bytes erneut prüfen.
- Bereits öffentliches identisches Release: ohne Schreibzugriff erfolgreich beenden.
- Fremder Autor, fehlender Marker, abweichende Revision, zusätzliche Datei oder abweichender Inhalt: vor Änderungen abbrechen.

Uploads und Veröffentlichung adressieren die geprüfte Release-ID. Es gibt kein `--clobber`, kein Löschen von Assets und kein Umschreiben fremder Beschreibungen. Ein konkurrierender Upload desselben Namens schlägt fehl. Nach einem verlorenen Upload-Ergebnis liest der nächste Lauf den tatsächlichen Zustand und setzt erst nach erneuter Prüfung fort. Ein persönliches Token wird nicht als alternative Freigabe zur Übernahme menschlich erstellter Drafts interpretiert.

Nach drei bestätigten Assets wird genau dieses Draft veröffentlicht und erneut gelesen. GitHub bietet hierfür keine Transaktion über Tag und Release; parallele manuelle Änderungen können weiterhin einen fehlgeschlagenen Lauf auslösen. Abweichungen werden nicht durch Überschreiben „repariert“.

## Signing

Ohne Signing-Secrets erstellt macOS eine Ad-hoc-signierte, nicht notarisierte App; Windows ist unsigniert. Release-Notes weisen den Modus aus. Echte optionale `CSC_*`, `WIN_CSC_*` und `APPLE_*`-Secrets steuern Signing/Notarisierung gemäß `resolveSigningConfiguration()`. Zugangsdaten werden nicht in Manifeste oder Smoke-Berichte aufgenommen. Die Testprozesse erhalten keine Signing- oder GitHub-Zugangsdaten und keine geerbten Node-/Electron- oder Sketchdraw-Laufzeitüberschreibungen.

GitHub Actions liefert fehlende Secrets als leere Strings. Vor Electron Builder werden diese optionalen leeren Pfade und Einstellungen entfernt, damit ein leeres `CSC_LINK` nicht als Checkoutverzeichnis interpretiert wird. Tatsächlich konfigurierte Werte werden unverändert weitergegeben; gültige leere Zertifikatpasswörter bleiben erhalten. Der unabhängige Review hat die optionale Erkennung eines Notarisierungsprofils im Standardkeychain als getrennten Folgefehler [#27](https://github.com/J-ARTS/de.sketchdraw.io/issues/27) erfasst. Die Ad-hoc-Auslieferung ohne Notarisierung ist davon nicht betroffen.

Native Starttests bestätigen keine Gatekeeper-/SmartScreen-Freigabe oder erfolgreichen interaktiven Installationsdialog. Linux muss die Sandbox auf dem vorgesehenen Runner tatsächlich unterstützen; ein Fehlschlag darf nicht durch Abschalten der Sandbox verborgen werden.

## Lokale Prüfungen und native Abnahme

```bash
node --test tests/unit/release*.test.mjs
node --check scripts/release.mjs
node --check scripts/release-installer-smoke.mjs
```

Die Node-Tests prüfen Staging, Revisionen, fremde Drafts, konkurrierende Release-Ersetzung, verlorene Upload-Antworten, Wiederaufnahme, Download-Hash-Prüfung und Fehlerpfade. Synthetische Fixture-Berichte dienen nur diesen Unit-Tests. Ein nativer Negativtest führt den echten Extraktor gegen einen unbrauchbaren Installer mit zuvor akzeptiertem Header aus. Diese Prüfungen ersetzen keinen positiven Start der Produktinstaller auf allen drei Betriebssystemen.

Die CLI unterstützt `preflight`, `verify-env`, `package`, `validate-artifacts` und `publish`; Parameter können explizit (`--tag`, `--commit`, `--platform`) oder über `RELEASE_TAG`, `RELEASE_COMMIT`, `TARGET_PLATFORM` übergeben werden. `--artifacts-dir` wählt das gesammelte Bundle. `publish` führt echte externe Schreibzugriffe aus; ein gestarteter Lauf zählt erst nach Rückprüfung des öffentlichen Releases als erfolgreich.

**Native Abnahme:** `runInstallerSmoke({ platformKey, installerPath, version, commitSha, outputPath })` führt den vollständigen beschriebenen Test aus. Der Installer-MCP-Smoke prüft Startfähigkeit, Protokolloberfläche und die verweigerte unberechtigte Anfrage. Er belegt keine autorisierten Dokumentänderungen; dafür sind getrennte Integrationstests mit dem wirklichen Host und Domain-Handlern erforderlich. Die vollständige Anwendung und alle drei nativen Installer einschließlich MCP sind für `c4bdfd6` im [Release-Lauf39046419226](https://github.com/J-ARTS/de.sketchdraw.io/actions/runs/39046419226) geprüft. R04 ist damit auf drei Plattformen abgenommen. Eine erfolgreiche Veröffentlichung und der Download-Abgleich werden separat nachgewiesen.

## Gezielte Linux-Sandbox-Voraussetzung in CI

Unter Ubuntu 24.04 benötigen nicht installierte Electron-Binaries eine gezielte Freigabe für User Namespaces. `scripts/linux-sandbox.mjs` lädt ausschließlich in GitHub Actions ein temporäres AppArmorprofil für den kanonischen, exakt gebundenen Executable-Pfad und entfernt dieses nach dem Prozessende. Checkout-Tests und der extrahierte Installer erhalten jeweils ihre eigene Bindung. Pfad-Metazeichen werden abgewiesen. Es gibt keine globalen Sysctl-Änderungen und keinen `--no-sandbox`-Start. Das entspricht der [Ubuntu-Empfehlung](https://documentation.ubuntu.com/release-notes/24.04/#unprivileged-user-namespace-restrictions); Chromium richtet seine eigene Sandbox ein. Das AppArmorprofil ist keine zusätzliche vollständige AppArmor-Einschränkung der App.

Der DEB-Installer bringt bereits das entsprechende Electron-Builder-Profil für den installierten `/opt/Sketchdraw`-Pfad mit und registriert es im Installationsskript. Die reine Testextraktion führt dieses Skript nicht aus; deshalb braucht der Smoke seinen temporären Pfad. Auf Entwicklerrechnern nimmt der CI-Helfer keine privilegierten Änderungen vor. Frühere Linux-Backend-/P2P-Läufe mit Playwrights Standardoption gelten ausdrücklich nicht als Sandboxnachweis; die korrigierten Tests verlangen `chromiumSandbox: true` und das Fehlen des Abschalters.

Profilnamen enthalten eine zufällige Run-ID; das Laden verwendet `--add` und überschreibt kein vorhandenes Profil. Der Testwrapper beendet bei SIGINT/SIGTERM seine eigene Prozessgruppe vor dem Entladen. SIGKILL oder ein zerstörter Runner können keinen JavaScript-Cleanup ausführen; die Pipeline verwendet deshalb wegwerfbare GitHub-hosted Runner.
