# Update-Installer und App-Name: Prüfung vor der Umsetzung

Tickets: #236 (App-Name und Icon), #237 (Update-Installer). Werkzeug: Claude Code (Cloud-Sitzung), Modell Claude Fable 5.2. Messwerte für Zeit, Tokens und Kosten liegen nicht vor.

## Entscheidungen

| Frage | Entscheidung | Grund |
| --- | --- | --- |
| `app.name` auf „Sketchdraw“ umstellen? | Nein. Sichtbare Texte werden einzeln gesetzt. | `app.name` benennt den Datenordner (`…/de.sketchdraw.io`, am veröffentlichten v0.1.6-Paket nachgemessen) und unter macOS/Linux den Schlüsselbund-Eintrag von `safeStorage`. Eine Umbenennung macht `plugins.json`, Wiederherstellungsdaten und verschlüsselte Zugangsdaten für bestehende Installationen unlesbar. |
| `electron-updater`? | Nein, eigener Dienst gegen `releases/latest`. | Squirrel.Mac verlangt eine echte Signatur; die App ist ad-hoc signiert. Der Release-Ablauf veröffentlicht bewusst keine `latest*.yml`. Ein Mechanismus für drei Plattformen ist kleiner als zwei. |
| Still installieren? | Nein, immer nach Rückfrage. | Die Installer sind unsigniert bzw. ad-hoc signiert; der Nutzer soll wissen, wann die App ersetzt wird. Ungespeicherte Arbeit läuft über den vorhandenen Schließen-Dialog. |
| Automatische Prüfung | An, abschaltbar. | Die Abfrage geht nur an GitHub und überträgt nichts aus Dokumenten. Die Vision schließt zentrale Server für Dokumente und Signaling aus, nicht eine abschaltbare Versionsabfrage. |

## Bedenken

1. **Vertrauensanker ist das GitHub-Konto.** Größe und SHA-256 kommen aus derselben Quelle wie die Datei. Das schützt vor beschädigten oder vertauschten Downloads, nicht vor einem übernommenen Konto oder Release-Workflow. Fehlerfall: Ein Angreifer mit Schreibrecht auf Releases veröffentlicht `v9.9.9` mit eigenem Installer; jede App bietet ihn an. Auswirkung: Codeausführung nach Bestätigung durch den Nutzer. Alternative: Signatur mit einem Schlüssel, der nicht in GitHub liegt (Developer ID/Authenticode oder eine eigene Ed25519-Signatur über den Installer, deren öffentlicher Schlüssel in der App steckt). Offen; betrifft `devops`/`iam`.
2. **macOS: Tausch des Bundles ist am echten Programme-Ordner ungeprüft.** Einhängen, Prüfen und Kopieren laufen mit den echten Werkzeugen im macOS-CI-Lauf, der Tausch in einem Testordner. Ob macOS (App-Verwaltung, ab Ventura) den Tausch einer ad-hoc signierten App in `/Applications` ohne Rückfrage zulässt, zeigt erst eine installierte App. Fehlerfall: `mv` wird verweigert. Auswirkung: Die alte App startet wieder, die Version wird beim Start nicht erneut angeboten, ein Dialog verweist auf die Release-Seite – kein Datenverlust. Alternative, falls es scheitert: DMG öffnen und den Nutzer ziehen lassen.
3. **Windows: stiller Lauf des Installers ist nur über die Vorlage belegt.** `/S --updated --force-run` sind die Schalter, die die NSIS-Vorlage von electron-builder auswertet (`installSection.nsh`, `allowOnlyOneInstallerInstance.nsh`). Ein Lauf auf einer installierten App fehlt. Fehlerfall: Installation für alle Benutzer verlangt UAC; lehnt der Nutzer ab, bleibt die alte Version, und die App wurde bereits beendet.
4. **Linux: `dpkg -i` ohne Abhängigkeitsauflösung.** Bringt ein Release neue Paketabhängigkeiten mit, scheitert die Installation; die App meldet das und verweist auf die Release-Seite. `pkexec` braucht einen laufenden Polkit-Agenten.
5. **Ende-zu-Ende erst mit zwei Releases prüfbar.** Die erste Version mit Updater kann sich erst auf die übernächste aktualisieren. Bis dahin sind belegt: Abfrage, Download (119 MB) und Prüfsumme gegen das echte Release v0.1.6, alle Schritte je Plattform mit eingesetzten Werkzeugen, die macOS-Schritte nativ im CI.
6. **Rate-Limit.** `api.github.com` erlaubt 60 anonyme Anfragen je Stunde und Adresse. Hinter einer gemeinsamen Adresse kann die Prüfung scheitern; das bleibt beim Start still und wird nur bei „Nach Updates suchen“ gemeldet.
7. **Linux-Fensterklasse.** Die Desktop-Datei des v0.1.6-Pakets nennt `StartupWMClass=Sketchdraw`, das Fenster meldet `de.sketchdraw.io`. GNOME ordnet über den Dateinamen der Desktop-Datei trotzdem zu; die Angabe ist jetzt angeglichen. Das Paket ließ sich in dieser Umgebung nicht bauen (Download der Electron-Binärdateien scheitert am Proxy), die erzeugte Desktop-Datei ist daher erst im nächsten Release-Lauf sichtbar.

## Nicht umgesetzt

- Paketname, ausführbare Datei und Datenordner unter Linux heißen weiter `de.sketchdraw.io`: Der einmal eingerichtete MCP-Client und vorhandene Daten hängen an diesen Pfaden.
- Der fette Menütitel bei einem Entwicklungsstart unter macOS bleibt „Electron“; macOS liest ihn aus dem Electron-Bundle.
