# Codex-Korrekturen zur Release-Pipeline – Issue #24

Stand: 2026-10-17, lokaler Arbeitsbaum ohne veröffentlichte Revision. Tatsächlich ausführendes Werkzeug: OpenAI Codex, Subagent `setup_integration`. Dies ist die ausdrücklich vom Nutzer freigegebene vorübergehende Übernahme der DevOps-Korrekturen. Die ursprüngliche Implementierung und der Bericht von Google Antigravity bleiben diesem Werkzeug zugeordnet. Der historische [Codex-Review](codex-release-review.md) bleibt unverändert erhalten.

## Ergebnis nach Befunden

| Befund | Umsetzung | Nachweis / verbleibende Abnahme |
| --- | --- | --- |
| R01 – Windows-Variablen | Release-CLI liest `RELEASE_TAG`, `RELEASE_COMMIT`, `TARGET_PLATFORM` direkt aus der Prozessumgebung. Die Runner-Verzweigung beim Packaging verwendet ausdrücklich Bash. | Workflow-Inhaltsprüfung und YAML-Parse bestanden; tatsächlicher Windows-Actions-Lauf noch offen. |
| R02 – fehlendes MCP-Bundle | `dist-mcp/**/*` wird ausgeliefert; Build-Prüfung und Smoke verlangen `dist-mcp/server.cjs`. | Negativtest für fehlendes Bundle und Konfigurationsprüfung bestanden. |
| R03 – fremde Drafts / Clobber | Vor Änderungen: Bot-Autor, positive Release-ID, exaktes Tag, eigener Marker mit Revision und drei Asset-Identitäten, vorhandene Bytes und entfernte Tag-Revision prüfen. Nur fehlende Dateien per Release-ID hochladen; keine Löschung, kein Clobber, kein Beschreibungs-Update. Vor jedem weiteren Schritt Zustand erneut lesen. | Fremdes Draft, falsche Revision, gleichnamige abweichende Bytes, zusätzliche Assets, Tag-Verschiebung und Release-Ersetzung führen im Test zu null Mutationen. Verlorene Upload-Antwort wird ohne erneutes Hochladen vorhandener Bytes fortgesetzt; öffentlicher Wiederholungslauf ist nur lesend. |
| R04 – keine echten Installer-Starts | Neuer nativer Testdriver extrahiert den tatsächlichen NSIS-/DMG-/DEB-Installer, prüft ASAR-Inhalt mit der extrahierten Binary, startet dieselbe App mit Sandbox und prüft die echte UI/Preload-Bridge. Derselbe ausgelieferte Electron-Prozess startet den MCP-Adapter via ASAR; offizieller SDK-Client prüft Initialize, sechs Tools und `ACCESS_DENIED` ohne Grant. Packaging und Sammeln verlangen gebundene Smoke-Evidenz. | Implementiert, aber positive Produktinstaller auf allen drei Betriebssystemen noch nicht ausgeführt. Lokaler echter `hdiutil`-Negativtest weist den zuvor akzeptierten Header-Fixture zurück. Andere Extraktionspfade werden hier mit injizierten Prozessen getestet. Fehlgeschlagene Smokes verhindern Staging. |
| R05 – fehlender Remote-Digest | Fehlt ein brauchbarer SHA-256-Digest, werden echte Asset-Bytes ID-gebunden in eine eigene Datei heruntergeladen und gehasht. Notes und Größe genügen nicht. | Tests mit heruntergeladenen Bytes, gleich großer Korruption und Downloadfehler bestanden. GitHub-Netzwerk-/Publish-Mutation wurde nicht ausgeführt. |

## Technische Grenzen und Entscheidungen

Der Installer-Smoke ist verpflichtend in den drei Packaging-Jobs angeschlossen; unter Linux läuft er unter Xvfb. Es existiert kein „Datei fehlt, Prüfung überspringen“-Pfad. `chromiumSandbox: true` verhindert Playwrights Linux-Standard ohne Sandbox. App-Version, Architektur, ausführbarer Pfad, `app.isPackaged`, ASAR-Pfad, Sandbox, Context Isolation, deaktivierte Node-Integration und Preload-Bridge werden am tatsächlich gestarteten Prozess gelesen. Die vier ausgelieferten Bundle-Hashes müssen den lokalen Buildausgaben entsprechen. Der Installer-Hash wird vor und nach dem Smoke verglichen.

MCP-Discovery ohne Grant ist nach dem zwischenzeitlich gelieferten Adaptervertrag zulässig und enthält ausschließlich öffentliche Tool-Metadaten. Deshalb ist der Packaging-Smoke bewusst ein Start-/Protokoll-/Zugriffsverweigerungstest; er behauptet keine autorisierte Dokumentbearbeitung. Der vorher vorgesehene Testhost-Anschluss wird dafür nicht benötigt. Autorisierte SDK-/Socket-/Domain-Integration wird getrennt vom Koordinator geprüft. Alle geerbten `SKETCHDRAW_*`-Werte werden aus dem Smoke-Prozess entfernt. Ein Dokumentzugriff muss `ACCESS_DENIED` mit ausschließlich strukturiertem Fehler statt Dokumentinhalt liefern.

Die Ownership-Policy akzeptiert nur von `github-actions[bot]` angelegte Releases mit exakt passendem Marker. Bestehende menschliche oder frühere unmarkierte Drafts werden nicht übernommen. Release-ID-gebundene Uploads verhindern das Bearbeiten einer zwischenzeitlich ersetzten Release-ID; Namenskollisionen führen zum Abbruch. GitHub bietet keine atomare Transaktion über Tag, Release und Assets. Keine Abweichung wird durch Überschreiben korrigiert.

Die tatsächliche native Sandbox-Unterstützung auf Ubuntu, die reale NSIS-Extraktion auf Windows und der vollständige macOS-App-Start bleiben Runner-Abnahmepunkte. Globale Sicherheitskonfigurationen werden nicht geändert. Es wurde kein `--no-sandbox` ergänzt. Ein erfolgreicher Backend-Fixture auf macOS wäre kein Produktinstallernachweis und wird hier nicht als solcher ausgegeben.

## Ausgeführte Prüfungen

Umgebung: Node.js `v22.16.0`, Darwin `arm64`, lokaler Arbeitsbaum. Keine Revision wird erfunden; das Repository hat beim Prüfstand noch keinen integrierten Commit.

- `node --check scripts/release.mjs`: bestanden.
- `node --check scripts/release-installer-smoke.mjs`: bestanden.
- `node --test tests/unit/release*.test.mjs`: **21 bestanden, 0 fehlgeschlagen, 0 übersprungen** im letzten Lauf nach MCP-Deny-Gate und plattformneutraler Pfadkorrektur.
- Beide Workflows mit dem installierten `js-yaml` geparst und vorhandene Jobs geprüft: bestanden.
- Der native Extraktions-Negativtest führt auf diesem Rechner echtes `hdiutil verify` gegen einen 1-MiB-Header-Fixture aus: erwartete Ablehnung bestanden.
- Zusätzlicher tatsächlicher SDK-Test nach Bereitstellung des MCP-Builds: `node --input-type=module` ruft `smokeMcpCli` mit `require('electron')`, absolutem `dist-mcp/server.cjs` und einem eigenen fremden Arbeitsverzeichnis mit Leerzeichen auf. **Bestanden:** `initialized: true`, exakt sechs Tools, `deniedWithoutGrant: true`, `stderrBytes: 0`, Exit 0. Das ist der reale lokale Electron-/CLI-Start; es ist noch kein ASAR- oder Installer-Nachweis.

Ein früherer Zwischenlauf hatte 20 Tests, davon 19 bestanden und einen Fehler: macOS löst `/var` zu `/private/var` auf. Die Besitzprüfung verglich den kanonischen Kandidaten mit dem nicht kanonischen Temp-Verzeichnis. Beide Seiten werden jetzt kanonisiert; der Fehler wurde behoben und die betroffenen Tests erneut erfolgreich ausgeführt. Synthetische Smoke-Evidenz in Staging-Unit-Tests ist ausdrücklich nur Test-Fixture und kein nativer Erfolgsnachweis.

Nicht ausgeführt: positive vollständige Installer-Smokes auf Windows/macOS/Linux, reale GitHub-Release-Schreibzugriffe, Signing/Notarisierung mit Produktionszertifikaten, Gesamtprodukt-Endabnahme. Beim letzten Dateiabgleich waren Renderer-Einstiege `src/App.vue` und `src/main.ts` noch nicht vorhanden. Der MCP-Build wurde danach tatsächlich bereitgestellt und wie oben lokal geprüft. Diese Einschränkungen verhindern einen ehrlichen Release-Fertigclaim.

## Übergabe

Geänderte Ressourcen: `.github/workflows/ci.yml` (nur Build-Schrittbezeichnung), `.github/workflows/release.yml`, `electron-builder.json`, `scripts/release.mjs`, neues `scripts/release-installer-smoke.mjs`, `tests/unit/release.test.mjs`, neues `tests/unit/release-smoke.test.mjs`, `docs/release.md`, dieser Bericht. Keine Package-/Lock-, Produktcode-, Ledger-, Graphify- oder GitHub-Änderung durch diesen Korrekturlauf. Keine Tags, Releases, Commits oder Pushes erstellt.

Nächster Schritt: unabhängige Codex-Prüfung dieses Pakets; nach abgeschlossener Produktintegration tatsächliche Builds und native Installer-Smokes auf allen drei Runnertypen ausführen. Testergebnisse und verbleibende Befunde in Issue #24 durch den Koordinator nachführen. Bis dahin bleibt das Ticket offen; Implementierung und Abnahme werden getrennt ausgewiesen.
