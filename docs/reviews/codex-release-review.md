# Unabhängige Prüfung der Release-Pipeline — Issue #24

Stand: 17.10.2026. Reviewer: interner Codex-Subagent `setup_integration`; Implementierung: tatsächlicher Antigravity-Lauf, siehe [Implementierungsbericht](antigravity-release-pipeline.md). **Noch nicht zur Veröffentlichung freigegeben.** Produktdateien, Workflows und Tests wurden durch dieses Review nicht geändert; kein Release, Tag, Upload oder Signing ausgeführt.

Geprüft wurden die abschließend gelieferten sechs Release-Dateien, der aktuelle `package.json`-Build einschließlich `build:mcp` sowie die tatsächlich vorhandenen Electron-Tests. Der Graphify-Einstieg lieferte nur allgemeinen Dependency-Kontext; die Befunde stammen aus den Dateien und den unten beschriebenen lokalen Gegenproben. Im lokalen Checkout existiert noch kein auflösbarer `HEAD`; der geprüfte Stand ist deshalb durch Dateihashes festgehalten.

## R-01 — P1: Windows-Job übergibt leere Release-Argumente

**Stellen:** `.github/workflows/release.yml:108` und `:158`.

Die Windows-Matrix hat weder `defaults.run.shell` noch ein `shell` am jeweiligen Schritt. GitHub verwendet dort PowerShell. Die Aufrufe lesen jedoch `"$TARGET_PLATFORM"`, `"$RELEASE_TAG"` und `"$RELEASE_COMMIT"` wie Bash-Variablen. Die Werte werden ausschließlich über `env:` gesetzt; PowerShell benötigt dafür `$env:TARGET_PLATFORM` usw. Die einfachen PowerShell-Variablen sind ungesetzt. Bereits `verify-env` erhält dadurch leere Argumente und stoppt vor dem Windows-Installer; auch der Stagingpfad des Packaging-Schritts ist falsch. [GitHub: Standard-Shells](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), [Microsoft: Umgebungsvariablen](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_environment_variables).

**Reparatur:** Für diese Schritte explizit dieselbe verfügbare Shell verwenden oder die Variablen ohne Shell-Auswertung aus `process.env` lesen. Ein Windows-spezifischer PowerShell-Aufruf ist ebenfalls möglich. Alle drei Argumente und den Stagingpfad gemeinsam korrigieren.

**Abnahme:** Den wirklichen `windows-2025`-Schritt mit belegter Shell ausführen; `verify-env` muss `win32`, `x64`, das richtige Tag und dieselbe Commit-SHA melden. Lokal ist `pwsh` nicht installiert; dieser Befund ist durch Workflow und offizielle Shell-Semantik belegt, kein behaupteter Windows-Lauf.

## R-02 — P1: Der aktuelle MCP-Build wird nicht ausgeliefert

**Stellen:** `electron-builder.json:10`, `scripts/release.mjs:326`, `docs/release.md:151`.

`npm run build` erzeugt inzwischen `dist-mcp/server.cjs`. Die explizite Packaging-Dateiliste enthält nur `dist/**/*`, `dist-electron/**/*` und `package.json`. `dist-mcp` fehlt ebenso in `verifyBuildPrerequisites`. Die Release-Dokumentation beschreibt stattdessen einen künftig angenommenen MCP-Adapter unter `dist-electron/`. Damit besteht der Build, der benötigte Adapter fehlt aber im ausgelieferten Paket. Eine lokale Gegenprobe ohne irgendein `dist-mcp` wurde von `verifyBuildPrerequisites` akzeptiert.

**Reparatur:** Den tatsächlich vereinbarten Adapterpfad aufnehmen und vor sowie nach dem Packaging prüfen. Seine Ausführung aus dem installierten Paket muss mit dem MCP-Startvertrag abgestimmt werden; bloßes Vorhandensein innerhalb `app.asar` beweist noch keinen funktionierenden externen Node-/stdio-Start.

**Abnahme:** Paketinhalt auf den Adapter prüfen und den vorgesehenen Adapterstart aus genau diesem Paket testen, einschließlich fremdem Arbeitsverzeichnis und Pfad mit Leerzeichen. Die Dokumentation auf den wirklichen Buildpfad aktualisieren.

## R-03 — P1: Ein fremder Draft mit erwarteten Dateinamen wird überschrieben

**Stellen:** `scripts/release.mjs:1409–1441` und `:1461–1472`.

Der Resume-Pfad prüft nur, ob vorhandene Assetnamen in der erwarteten Namensliste stehen. Er prüft vor der ersten Mutation weder eine eigene Release-Zuordnung noch Revision oder vorhandene Assetdigests. Danach ersetzt er Titel und Beschreibung und lädt alle Dateien mit `--clobber` hoch. Ein manuell angelegter Draft am selben Tag mit denselben Dateinamen, aber anderem Inhalt, wird dadurch verändert und anschließend veröffentlicht.

**Ausgeführte Gegenprobe:** Ein vollständig gemockter GitHub-Adapter lieferte zunächst einen Draft mit fremder Beschreibung, abweichender SHA, erwarteten Dateinamen, Größe `99` und abweichenden Digests. `publishGitHubRelease` führte `release edit`, Upload mit `--clobber` und abschließend `--draft=false` aus; Ergebnis `published`. Alle API-Aufrufe waren lokale Stubs, es gab keinen GitHub-Schreibzugriff.

**Reparatur:** Einen fremden oder nicht eindeutig diesem Pipeline-Lauf/Release zugeordneten Draft vor jeder Mutation ablehnen. Bei einem eigenen unterbrochenen Upload nur nach geprüfter Revision und Assetidentität fortsetzen; identische Dateien wiederverwenden. Abweichende vorhandene Inhalte dürfen nicht allein wegen übereinstimmender Namen überschrieben werden.

**Abnahme:** Fremder Draft mit gleichnamigen Assets und falscher Revision/Hash muss mit **null Mutationen** abbrechen. Eigener partieller Draft und bereits vollständig veröffentlichter identischer Stand müssen kontrolliert fortsetzbar bzw. unverändert idempotent bleiben.

## R-04 — P1: Die Release-Gates starten kein gebautes Paket und prüfen keinen echten Installerinhalt

**Stellen:** `.github/workflows/release.yml:130–165`, `scripts/release.mjs:634–720` und `:799–861`; Gegenabgleich `tests/electron/desktop.spec.ts:19`.

Die Electron-Tests starten vor dem Packaging die lokale Anwendung über `electron.launch({ args: ['.'] })`. Der zusätzliche Backend-Test startet ausdrücklich eine unpaketierte Fixture. Nach dem Packaging werden lediglich das separat entpackte Executable, wenige Header-/Trailerbytes des Installers, Größe und Hash geprüft. Es gibt keinen Start des erzeugten App-Bundles und keine Installation/Extraktion des konkreten Installers mit anschließendem Start. Die Architektur der separaten `*-unpacked`-Datei beweist nicht den Inhalt des angehängten Installers. Fehler durch fehlende Paketdateien, ASAR-Pfade oder Signierung bleiben dadurch unentdeckt.

**Ausgeführte Gegenprobe:** Drei jeweils exakt 1.048.576 Byte große, ansonsten mit Nullbytes gefüllte Dateien mit minimalen PE-, `koly`- bzw. `ar`-Markern wurden zusammen mit passenden minimalen Executable-Markern von `packagePlatformInstaller` und `validateCollectedReleaseArtifacts` als vollständiges Dreierbundle akzeptiert. Der Produktions-Mindestwert wurde nicht abgesenkt. Diese Dateien sind keine lauffähigen Installer; die Gegenprobe zeigt die begrenzte Aussage der vorhandenen Headerprüfung.

**Reparatur:** Vor Staging/Upload auf jedem Zielrunner den tatsächlichen Installer mit dem jeweiligen Plattformwerkzeug prüfen bzw. isoliert installieren/extrahieren und die daraus stammende Anwendung starten. Mindestnachweis: richtige Architektur/Version, Produktfenster und reales Preload, paketierter Zustand, enthaltene benötigte Bundles einschließlich MCP. Bestehende Tests bleiben zusätzlich bestehen. Keine Sicherheitsflags oder globale Gatekeeper-Abschaltung als Ersatz.

**Abnahme:** Fehlerhafter oder nicht extrahierbarer Installer sowie fehlende Paketdatei müssen das Release blockieren. Startbeleg muss genau das anschließend gehashte Installerartefakt identifizieren. Bis dahin bleiben tatsächliche Windows-/macOS-/Linux-Installer und deren Startabnahme unbestätigt.

## R-05 — P2: Fehlender Remote-Digest wird als bestandene Inhaltsprüfung behandelt

**Stelle:** `scripts/release.mjs:1296–1321`.

Der Remote-SHA-Vergleich findet nur statt, wenn `remoteAsset.digest` mit `sha256:` beginnt. Fehlt dieses Feld oder hat es ein anderes Format, werden Größe und die in der Release-Beschreibung vorkommenden lokalen Prüfsummen akzeptiert. Die Beschreibung ist jedoch kein Hash des tatsächlich gespeicherten Assets. Gleich große andere Bytes können damit als `already-published-idempotent` gelten; nach einem Upload reicht dieselbe Prüfung für die Veröffentlichung.

**Ausgeführte Gegenprobe:** Drei Remote-Assetdatensätze ohne `digest`, aber mit erwarteten Namen/Größen und einer Beschreibung mit den lokalen Hashes wurden von `verifyRemoteReleaseAssets(... requireCommitInBody: true)` mit `true` angenommen. Kein Remoteinhalt wurde gelesen.

**Reparatur:** Einen gültigen SHA-256-Digest verlangen oder das konkrete Asset herunterladen und selbst hashen. Wenn beides nicht verfügbar ist, die Verifikation abbrechen. Beschreibungstext bleibt Dokumentation, kein Ersatz für Inhaltsprüfung.

**Abnahme:** Fehlender, falsch formatierter oder falscher Digest darf ohne tatsächlichen Bytevergleich keine erfolgreiche Identitätsprüfung ergeben; gleich große abweichende Bytes ausdrücklich testen.

## Bestätigte Teile und tatsächlich ausgeführte Prüfungen

- Tag-/Versionsprüfung, Checkout der verifizierten Commit-SHA, drei explizite Plattformziele, striktes Staging auf drei Installer und drei interne Manifeste sowie der nachgelagerte Veröffentlichungsjob sind vorhanden. Alle bestehenden Testgates bleiben konfiguriert. Ein konfiguriertes Gate ist kein belegter erfolgreicher CI-Lauf.
- Der Runner `macos-15` wird in der aktuellen offiziellen GitHub-Tabelle als `arm64` geführt; das ist hier **kein** Befund. Zusätzlich prüft der Code `process.arch`. [GitHub-Runnerreferenz](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
- `node --test tests/unit/release.test.mjs`: **10 bestanden, 0 fehlgeschlagen**, macOS arm64, Node `22.16.0`. Die Tests verwenden synthetische Dateien und gemockte GitHub-Aufrufe.
- `node --test 'tests/unit/release*.test.mjs'`: ebenfalls **10 bestanden**. Der literal übergebene Glob wird mit dieser Node-Version aufgelöst; hierfür wurde kein Windows-Globfehler behauptet.
- Lokale Gegenproben zu R-02 bis R-05: oben genannte Fehlerfälle bestätigt; nur temporäre Verzeichnisse, anschließend entfernt. Die erfolgreiche Annahme unsicherer Fälle ist ein reproduzierter Fehler, keine bestandene Sicherheitsabnahme.
- Nicht ausgeführt: reales Packaging/Signing, Installerinstallation/-start, kompletter Release-Workflow, GitHub-Release und Windows-PowerShell. Diese Prüfung änderte ausschließlich diesen Bericht und veröffentlichte nichts.
- Antigravitys Abschlussbericht wurde nach dessen abgeschlossenem Lauf gegengelesen. Die dort als nicht ausgeführt bezeichneten Laufzeitprüfungen wurden nicht nachträglich als Antigravity-Ergebnisse ausgegeben. Der Ausdruck „signiertes Build-Manifest“ im Bericht ist nicht durch Implementierung belegt: erzeugt wird gewöhnliches JSON mit Hashfeldern.

## Geprüfter endgültiger Dateistand

Alle sechs Dateien wurden nach Ende des Antigravity-Laufs erneut abgeglichen; die oben genannten Stellen waren weiterhin vorhanden.

| Datei | SHA-256 |
| --- | --- |
| `.github/workflows/ci.yml` | `ff1e80ee24cd5557cc6a04947822277afdd0d2d417efd44c9586c3b20b7b1530` |
| `.github/workflows/release.yml` | `a9bdbefe4ec8f4ee77fd3c8365b9bf64c28e8bb2b051afc0b822fd574b7f51c0` |
| `scripts/release.mjs` | `7fba9070726734c07c7d8939bc76c99d0cd9b798a1ce81b72a59423807c52e4b` |
| `electron-builder.json` | `56f31631bb1a70530e7c225db9a6e6465da70b6652937320d8007f521e115144` |
| `tests/unit/release.test.mjs` | `7c4b6e9b3444a268c2ac3821cebfdcf4a3f2fc35ef931f10c4eec4d2686d73e2` |
| `docs/release.md` | `3a2df8bff3d3cf5e3a268c778693f60b831825dfbbc157a2ee917f015edc6871` |

Nächster Schritt für die koordinierende Instanz: R-01 bis R-05 in Issue #24 als offene Integration führen, zuständige Umsetzung klären und nach Reparatur die genannten Negativfälle sowie die drei echten Paketstarts prüfen. Kein Ticketabschluss oder Release allein aufgrund der zehn bestandenen Unit-Tests.
