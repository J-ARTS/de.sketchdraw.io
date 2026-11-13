# Plugin-Audit: #161, #165, #168 und Folgefehler #181 — 13.11.2026

## Prüfumfang und Herkunft

- Koordination und Implementierung: OpenAI Codex; reguläre Zuständigkeiten: Antigravity für Logik/Schnittstellen, Claude Code für Oberfläche, Codex für Architektur/Testing. Übernahme gemäß Nutzerauftrag.
- Basis: `main` bei `8df300656e28f6a7fb19ae9f6185ae236725fc9c`, dazu lokale Korrektur #161. Bestehende fremde Änderungen bleiben erhalten.
- GitHub-Tickettexte und Kommentare wurden mit dem tatsächlichen Datei- und Git-Stand abgeglichen. Zuerst `graphify query "Plugin-Konfiguration Profile unbekannte beschädigte Konfiguration Schreibschutz Gastmodus Plugin-Kacheln"`.
- Unabhängiges tatsächliches Claude-Code-Sparring: `claude-fable-5-2`, Aufwand `high`, ausschließlich Read/Glob/Grep, keine MCP-Server. Tatsächliches Assistant-Modell bestätigt, `result.is_error=false`, 418.713 ms, gemessene CLI-Kosten 4,8656558 USD. Unveränderter Originalbericht und vollständige gemessene CLI-Nutzungswerte: `2026-11-13-plugins-fable.md` / `.json`. Begrenzte Nachreviews: `2026-11-13-plugins-fable-followup.*` und `2026-11-13-plugins-fable-final.*`; beide ebenfalls tatsächliches `claude-fable-5-2`, `high`, `is_error=false`.

## #161 — Beschädigte und unbekannte Konfigurationen

Der Fehler war auf der Basisrevision weiterhin vorhanden: Lesefehler wurden wie eine fehlende Datei behandelt. Bei JSON-/Schemafehlern wurde eine Sicherung auf einen festen Namen versucht, Fehler dieser Sicherung wurden ignoriert und der nächste Speichervorgang konnte die Originaldatei ersetzen.

Lokale Korrektur:

- Fehlende Datei, Lesefehler, ungültiges JSON, nicht unterstützte Version und ungültige Feldtypen sind getrennte Ladeergebnisse.
- Bei problematischer Profildatei bleiben Original und bestehende Sicherungen unverändert. Alle Schreibzugriffe im zentralen Speicherdienst sind gesperrt. Git-Konfiguration prüft die Sperre bereits vor `git init` oder Remote-Änderungen.
- `PluginSettingsSnapshot.configurationIssue` transportiert ausschließlich Fehlerart, Quelle, sichere Meldung und Sperrstatus. Keine Konfigurationsinhalte oder Tokens werden darin ausgegeben.
- Plugin- und Profil-Dialog zeigen den Wiederherstellungsweg und deaktivieren Änderungen. Wiederherstellung: App beenden, Original sichern/reparieren oder zur Seite verschieben und neu starten. Die laufende Instanz hebt die Sperre nicht allein aufgrund einer zwischenzeitlichen Dateiveränderung auf.
- Problematische alte v2-Ordnerdateien bleiben unverändert; ihre fehlgeschlagene Übernahme wird sichtbar, während unabhängige Editor-Profile bearbeitbar bleiben. Gültige v2-Dateien und verschlüsselte Tokens werden weiter übernommen.
- ADR 0008 beschreibt den korrigierten Schutz statt der bisherigen ungesicherten Backup-Annahme.
- Englische Übersetzungen umfassen Gründe, Wiederherstellungstexte und die zusammengesetzte Meldung. Ein Test übersetzt die tatsächlich vom Service erzeugte Meldung vollständig einschließlich des unveränderten Dateipfads.
- Nach Fable-Befund erzwingt das Laden sowohl von v2- als auch von v3-Dateien dieselben Remote-/URL-/Feldgrenzen wie das ausdrückliche Konfigurieren. Ein als Git-Option oder URL übergebener Remote-Name sowie unsichere Atlassian-URLs werden als ungültige Daten verworfen. Die Tests prüfen, dass dabei kein Git-Aufruf stattfindet.
- Bei unbekannter Profildateiversion empfiehlt die Meldung eine passende App-Version und Sicherung; sie rät nicht zum Reparieren eines möglicherweise gültigen zukünftigen Formats.

Vorläufige Abschlussbewertung: lokal implementiert und gezielt geprüft; Integration in `main`, unabhängige Review-Auflösung und abschließende integrierte Prüfungen sind noch Voraussetzung für den Ticketabschluss.

## Entscheidungen zum tatsächlichen Fable-Review

| Befund | Abgleich und Behandlung |
| --- | --- |
| P1: zu schwache semantische Prüfung beim Laden | Bestätigt und in #161 behoben; gemeinsame Normalisierung verhindert Remote-Optionen/URLs als Remote-Namen und unsichere Atlassian-URLs. |
| Vorschlag: jede gültige Legacy-Konfiguration deaktivieren | Nicht übernommen: Der koordinierende Agent bestätigt am 13.11.2026 den vorhandenen #168-Migrationsvertrag. Gültige alte Einstellungen bleiben aktiv; eine neue Produktentscheidung wird nicht still eingeführt. |
| P2: veraltete zweite Instanz überschreibt neuere Profile | Als eigener Folgefehler #181 erfasst und mit optimistischem Dateirevisionsvergleich behoben; Grenzen siehe unten. |
| P2: Test trifft keinen echten Schreibfehler mehr | Bestätigt; nach erfolgreichem Laden wird jetzt `fs.rename` mit EACCES simuliert. Ablehnung, unveränderter Snapshot, fehlende Originaldatei und vollständige Temp-Dateibereinigung sind geprüft. |
| P3: veralteter Profilwechsel im Renderer | Koordinierender Agent ergänzt den Abgleich im verworfenen Ergebniszweig. Verstärkter Regressionstest verlangt das tatsächliche neue Profil, einen leeren Projektkontext nach „Neu“ und keine veraltete Erfolgsmeldung. Der Test war vor der Korrektur rot. |
| P3: fehlende Übersetzung | Parallel durch Gesamtprüfung bestätigt, korrigiert und mit echter zusammengesetzter Meldung geprüft. |
| P3: Sitzungsweite Sperre nach Lesefehler | Bewusste kleine Wiederherstellungslösung: Original erhalten und Neustart verlangen. Kein neuer mutierender Recovery-IPC-Pfad. |
| Verdacht zum Git-SVG | Widerlegt: nach gescheitertem Direktabruf (SVG-Inhaltstyp/HTTP 403) wurde die Datei aus dem offiziellen Repository `git/git-scm.com`, `static/images/logos/downloads/Git-Icon-1788C.svg`, über den GitHub-Connector gelesen. Vollständiger Textvergleich: beide 858 Bytes und identisch. Keine Logodatei wurde ersetzt. |

Der erste Nachreview fand zwei durch die Schutzkorrektur eingeführte Regressionen; beide sind behoben und im finalen Fable-Nachreview bestätigt:

- Historisch aus Git übernommene `credentialRemoteUrl`-Vergleichsschlüssel mit Benutzernamen werden als begrenzter Text geladen, damit zuvor selbst gespeicherte Profile nach Neustart nicht falsch gesperrt sind. Neue automatisch erkannte Bindungen werden dagegen normalisiert; unsichere Bindungen entfallen. Ein Test verwendet eine echte lokale Git-Remote, Neustart und eine historische Datei.
- Auch der Dateivorabgleich von `configureGit` läuft in der Schreibwarteschlange. Ein eigener Rename kann dadurch keine falsche externe Änderung vortäuschen. Ein deterministischer Rename-/Read-Test prüft dieses Rennen. Der Dokument-/Profilkontext wird vor dem Warten erfasst und danach nochmals geprüft.

Der finale Fable-Bericht formulierte nur noch eine **bedingte** P2-Frage, weil der begrenzte Quelltextauszug `adoptActiveProfile` nicht enthielt. Der vollständige Codeabgleich löst sie auf: `adoptActiveProfile()` erhöht `projectGeneration` synchron vor dem Wechsel von `this.config`, und Auswahl/Erstellen/Löschen eines aktiven Profils verwenden diese Methode. `assertGeneration` schützt daher ausdrücklich auch Profilwechsel. Es bleibt daraus kein bestätigter P1/P2. Der sichtbare Renderer-Ergebniszweig wurde ebenfalls ohne offensichtlichen P1/P2 bewertet.

Git-Initialisierung und Remote-Änderungen beim ausdrücklich gewünschten Konfigurationsspeichern erfolgen weiterhin vor dem atomaren Schreiben der Profildatei. Ein erst danach auftretender echter I/O-Fehler kann diese ausdrücklich angeforderten Repository-Änderungen nicht zurückrollen; der Konfigurations-Snapshot bleibt unverändert. Für beschädigte oder extern veränderte Dateien wird dagegen bereits vor diesen Git-Seiteneffekten abgebrochen.

## #181 — Veraltete Profildateistände

Der Dienst speichert den SHA-256 des geladenen Dateiinhalts und prüft ihn vor jeder Profilmutation sowie erneut nach dem temporären Schreiben unmittelbar vor dem Rename. Ein anderer Inhalt, eine zwischenzeitlich angelegte/gelöschte Datei oder ein Lesefehler sperrt Änderungen; die andere Datei wird nicht ersetzt. Der Hinweis empfiehlt, die betroffene Instanz neu zu starten und den aktuellen Stand zu laden. Tests verwenden zwei Dienste gegen dieselbe Datei, eine externe Änderung vor einer Git-Konfiguration und eine zwischen Temp-Write und Rename eingeschobene Änderung.

Dies erfüllt den vom koordinierenden Agenten festgelegten minimalen optimistischen Schutz. Es ist kein atomarer Mehrprozessvergleich: Eine exakt überlappende Veränderung im kleinen Zeitfenster zwischen letzter Prüfung und Rename kann ohne prozessübergreifende Sperre nicht ausgeschlossen werden. Diese Grenze wird ausdrücklich nicht als geprüft oder gelöst ausgegeben.

## #168 — Editor-Profile

Implementierung `39943a2` ist Vorfahr von `main`; die spätere Nutzerentscheidung #169 ist in ADR 0008 dokumentiert: AppSelect im Arbeitsbereich-Menü und eigene Profilverwaltung in `ProfileDialog.vue`. Der ursprüngliche Tickettext nennt noch die frühere Verwaltung im Plugin-Dialog und muss diesen bestätigten Änderungsstand berücksichtigen.

Die vorhandenen Service- und Renderer-Prüfungen bestätigen getrennte Installations-/Konfigurationswerte, verschlüsselte Token-Kopien ohne Rückgabe im Snapshot, Neustart-Persistenz, Namens-/Mengen-/Löschregeln, Legacy-Übernahme, ausbleibende Repository-Konfiguration beim Profilwechsel und Ablehnung dokumentgebundener Aktionen bei ungespeicherten oder Gast-Dokumenten. Die Oberfläche deckt Erstellen, Kopieren, Umbenennen, Wechseln, Löschen, Dropdown-Bedienung und Themenvarianten ab.

Der im Ticket ursprünglich gestartete CI-Lauf `43255995048` auf `39943a2` endete mit `failure`; er wird nicht als Erfolg ausgegeben. Der aktuelle gemeinsame Stand `8df3006` ist durch [CI 43388981883](https://github.com/J-ARTS/de.sketchdraw.io/actions/runs/43388981883) in allen fünf Jobs erfolgreich geprüft: Ubuntu, macOS, Windows, Direct P2P sowie Governance/Graphify. Diese Remote-CI bestätigt nicht die noch lokale #161-Korrektur.

Vorläufige Abschlussbewertung: vorhandene Umsetzung integriert und technische Abnahme bestätigt; endgültige Bewertung nach unabhängigem Sparring und integriertem Electron-Nachlauf.

## #165 — Plugin-Logos

Die unveränderten offiziellen Dateien liegen vor. SHA-256:

- Git: `1080a5430edb6278dc03e4b04efc16c8bed5b943408d648ad721a28836814220`
- Jira: `ad20a13973de9ff9b4ad7354881c84ba2207b9117b6aad9bfce68b611c6fb9a8`

Logoauflösung mit SVG-Vorrang und Buchstaben-Rückfall ist unitgeprüft; weiße Kacheln in Light/Dark sind UI-geprüft. `LICENSE` enthält seit integriertem `6a5b4f6` die Git-Namensnennung und den Jira-Markenhinweis. `electron-builder.json` enthält `LICENSE` in den ausgelieferten Dateien. Der ursprünglich gestartete Lizenz-CI-Lauf `43250248612` endete mit `failure`; der oben genannte spätere aktuelle CI-Lauf ist erfolgreich.

Abschlussbewertung: technische Abnahme grün. Der Projektinhaber hat während dieses Audits ausdrücklich bestätigt: „Nachweis liegt vor – ich ergänze ihn“. Root hat diese Bestätigung im Issue festgehalten; die Referenz ergänzt der Projektinhaber. Der Nachweisinhalt wurde von Codex und Fable nicht selbst geprüft. Die vorherige Review-Blockade ist damit durch eine ausdrückliche Nutzerbestätigung aufgelöst; die unveränderten Originalreview-Berichte dokumentieren ihren jeweils früheren Kenntnisstand. Keine erneute Genehmigungsfrage und keine externe Anfrage.

## Ausgeführte Prüfungen

Umgebung: macOS arm64, Node `v22.16.0`; Basisrevision mit oben beschriebener lokaler Korrektur.

| Prüfung | Tatsächliches Ergebnis |
| --- | --- |
| `npx vitest run tests/unit/plugin-service.spec.ts tests/unit/renderer/plugin-store.spec.ts tests/unit/renderer/plugin-logos.spec.ts` | 43/43 bestanden, 3 Dateien |
| Integrierter Unit-Lauf des koordinierenden Agenten | Zunächst 906/907; i18n-Coverage fand 7 fehlende Übersetzungen der neuen Meldungen. Dies wurde korrigiert. |
| `npx vitest run tests/unit/renderer/i18n-coverage.spec.ts tests/unit/plugin-service.spec.ts tests/unit/renderer/plugin-store.spec.ts tests/unit/renderer/plugin-logos.spec.ts` | Nach Übersetzungskorrektur 49/49 bestanden, 4 Dateien, einschließlich tatsächlicher englischer Service-Meldung |
| Derselbe fokussierte Lauf nach Fable-Korrekturen #161/#181 und Renderer-Race-Fix #168 | 56/56 bestanden, 4 Dateien; vorher war gezielt der verstärkte Race-Test rot, danach grün |
| Derselbe fokussierte Lauf nach Auflösung der beiden Nachreview-Befunde | 58/58 bestanden, 4 Dateien; historischer Credential-Vergleich und deterministischer eigener Rename/Read eingeschlossen |
| `npm run typecheck` nach den Nachreview-Korrekturen | Bestanden; der letzte kleine Kontextschutz-Delta wurde anschließend durch die fokussierten Tests mitgeprüft. Integrierte Schlussprüfung liegt beim Root. |
| `npm run typecheck` | Bestanden |
| `npx playwright test --project=ui tests/ui/plugins.spec.ts` | 21 bestanden; 4 beim Seitenaufruf fehlgeschlagen, weil der lokale Vite-Server nicht mehr erreichbar war (`ERR_CONNECTION_REFUSED`) |
| `npx playwright test --project=ui tests/ui/plugins.spec.ts --last-failed` | Die 4 fehlenden Szenarien bestanden; alle 25 Szenarien damit bestätigt |
| `git diff --check` im Plugin-Änderungsumfang | Bestanden |

Electron wird vom koordinierenden Agenten nach gemeinsamem Build geprüft; hier noch kein aktueller lokaler Electron-Erfolg behauptet. Reale Jira-/Git-Schreibaktionen gehören zu #178, nicht zu diesen simulierten Service- und UI-Prüfungen. GitHub-Abschluss, Ledger- und Graphify-Schreibzugriffe bleiben beim koordinierenden Agenten.
