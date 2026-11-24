# Datenschutzerklärung für Sketchdraw

Stand: 24. November 2026. Gilt für Sketchdraw 0.1.10 und neuer. Die englische Fassung steht in [PRIVACY.md](PRIVACY.md); bei Abweichungen gilt für Nutzerinnen und Nutzer in Deutschland der deutsche Text.

Diese Erklärung beschreibt, welche personenbezogenen Daten Sketchdraw (die Desktop-App für Windows, macOS und Linux sowie das Session-Relay) verarbeitet. Grundlage ist der Quellcode dieses Repositorys.

## Kurzfassung

- Sketchdraw hat **keine Benutzerkonten**, **keine Werbung** und **keine Analyse-, Telemetrie- oder Absturzberichtsfunktion**. Der Herausgeber erhält deine Dokumente nicht.
- Deine Dokumente und Einstellungen liegen **auf deinem Gerät**.
- Die App öffnet Netzwerkverbindungen **nur** für: die **Update-Prüfung**, **Zusammenarbeits-Sessions**, die du startest oder denen du beitrittst, **Plugins** (Jira, Azure Boards, Confluence, Git), die du selbst einrichtest, und **Web-Einbettungen**, die ein Dokument enthält.
- Daten der Zusammenarbeit sind **Ende-zu-Ende-verschlüsselt**. Die beteiligten Netzbetreiber und Helfer-Peers sehen technische Verbindungsdaten (etwa IP-Adressen), nicht deine Zeichnung.

## Verantwortlicher

Jeremy Teichmann (J-ARTS) veröffentlicht Sketchdraw und ist Verantwortlicher für die hier beschriebene Datenverarbeitung, die der Herausgeber selbst durchführt (das Relay in Abschnitt 3 und das Repository auf GitHub). Kontakt: über die [Issues des Repositorys](https://github.com/J-ARTS/de.sketchdraw.io/issues) oder das Profil [J-ARTS](https://github.com/J-ARTS).

## 1. Daten auf deinem Gerät

| Was | Wo | Inhalt |
| --- | --- | --- |
| Dokumente | Dateien, die du speicherst, und ein Wiederherstellungs-Zwischenspeicher im Browserspeicher der App (IndexedDB) | Deine Diagramme und ihr Verlauf |
| Einstellungen | Browserspeicher der App (`localStorage`) | Voreinstellungen, Werkzeug-Standards, eigene Komponenten, der Anzeigename für Sessions, der gewählte Verbindungsweg und die Relay-Adresse |
| Plugin-Einstellungen | `plugins.json` im Datenordner der App | Serveradressen und Benutzernamen deiner Plugins. **Zugriffstoken und Passwörter werden mit dem sicheren Speicher des Betriebssystems verschlüsselt** (Electron `safeStorage`); ist er nicht verfügbar, speichert die App sie nicht. |
| Update-Einstellungen | `updates.json` im Datenordner der App | Ob die automatische Prüfung an ist, und eine verworfene Version |

Diese Daten verlassen dein Gerät nur, wenn du ein Dokument weitergibst, einer Session beitrittst oder ein Plugin nutzt. Du löschst sie, indem du die Dateien löschst, den Datenordner der App leerst und die App deinstallierst.

## 2. Update-Prüfung

Standardmäßig fragt die App **15 Sekunden nach dem Start und danach alle sechs Stunden** bei GitHub nach der neuesten Version (`https://api.github.com/repos/J-ARTS/de.sketchdraw.io/releases/latest`). Die Anfrage enthält Namen und Version der App (`Sketchdraw/<Version>`) und, wie jede Internetanfrage, deine IP-Adresse. Installierst du ein Update, lädt die App den Installer von `github.com` und prüft Größe und SHA-256. Die automatische Prüfung lässt sich in den Einstellungen der App ausschalten. GitHub verarbeitet die Anfragen nach seiner eigenen [Datenschutzerklärung](https://docs.github.com/de/site-policy/privacy-policies/github-general-privacy-statement); der Herausgeber sieht nur die zusammengefassten Download-Zahlen, die GitHub Repository-Inhabern anzeigt.

## 3. Zusammenarbeits-Sessions

Verbindungen werden nur geöffnet, wenn du **eine Session startest oder ihr beitrittst**. Ein Session-Link enthält die Schlüssel und die Adresse des Raums; wer den Link **und die PIN** kennt, kann beitreten – gib beides mit Bedacht weiter. Inhalt, PIN und Schlüssel sind zwischen den Teilnehmenden Ende-zu-Ende-verschlüsselt. Die anderen Teilnehmenden sehen: deinen **Anzeigenamen**, deinen **Cursor und deine Auswahl** und das Dokument.

Wie sich die Geräte erreichen, hängt vom Weg ab, den der Gastgeber wählt:

- **Direkter Weg (Peer-to-Peer):** Die Geräte verbinden sich direkt über das HyperDHT-Netzwerk. Die Teilnehmenden erfahren **gegenseitig ihre IP-Adressen**. Zum Finden kontaktiert die App die öffentlichen HyperDHT-Bootstrap-Knoten (`node1.hyperdht.org`, `node2.hyperdht.org`, `node3.hyperdht.org`) und weitere Knoten der DHT. Diese sehen IP-Adressen und dass eine Suche nach einem Thema (einem Hash, nicht dem Dokument) stattfand.
- **Freiwillige Helfer-Peers:** Während einer Session kann dein Gerät, wenn kein direkter Weg besteht, **verschlüsselte Datensätze für andere Teilnehmende weiterleiten**; ebenso können Helfer anderer Teilnehmender für dich arbeiten. Ein Helfer sieht IP-Adressen, Zeitpunkte und Datenmengen, nie Inhalt, PIN oder Schlüssel.
- **Weg über das Cloudflare-Relay:** Alle Geräte verbinden sich mit einem Relay (einem Cloudflare Worker), das die verschlüsselten Datensätze weiterleitet. Die App bringt die Adresse des Relays mit, das der Herausgeber betreibt (`sketchdraw-relay.jeremy-teichman74.workers.dev`); du kannst ein anderes Relay eintragen oder ein eigenes betreiben (`relay/` im Repository). Das Relay sieht **IP-Adressen, Verbindungszeitpunkte, das Session-Thema (einen Hash des öffentlichen Schlüssels des Gastgebers) und Datenmengen**. Es speichert nichts: Der Raum lebt im Arbeitsspeicher und verschwindet, wenn die letzte Verbindung endet. Das Relay schreibt keine Logs; die Beobachtungsfunktionen von Cloudflare sind ausgeschaltet. Cloudflare verarbeitet die Verbindungen als Betreiber der Plattform technisch nach der eigenen [Datenschutzerklärung](https://www.cloudflare.com/de-de/privacypolicy/).

Den Weg wählst du je Session. Rechtsgrundlage für die Verarbeitung der IP-Adressen zum Herstellen der Verbindung ist die Erfüllung der von dir gewünschten Funktion (Art. 6 Abs. 1 lit. b DSGVO) und, für den Betrieb des Relays, das berechtigte Interesse des Herausgebers an einem funktionierenden Dienst (Art. 6 Abs. 1 lit. f DSGVO).

## 4. Plugins

Plugins für **Jira, Azure Boards (Azure DevOps), Confluence und Git-Remotes** verbinden sich mit den Servern, deren Adressen und Zugangsdaten **du** einträgst. Die App sendet Anfragen nur an diese Server, mit den gespeicherten Zugangsdaten, und zeigt oder schreibt zurück, was du anforderst (etwa Tickets oder Wiki-Seiten). Die Betreiber dieser Dienste verarbeiten die Daten nach ihren eigenen Datenschutzbestimmungen. Nichts läuft über einen Server des Herausgebers. Zugangsdaten werden wie in Abschnitt 1 beschrieben verschlüsselt.

## 5. Eingebettete Webseiten

Ein Dokument kann eine **Web-Einbettung** enthalten, eine Live-Vorschau einer Webseite (ein `iframe`). Die Seite wird geladen, **sobald das Dokument mit der Einbettung angezeigt wird**, auch wenn das Dokument von jemand anderem stammt; die App sendet dabei keinen Referrer. Der Betreiber der Seite sieht deine **IP-Adresse** und die üblichen technischen Daten der Browser-Engine und kann in der Einbettung Cookies setzen. Sonst lädt die App von sich aus keine Webseiten. Soll eine Seite nicht kontaktiert werden, entferne die Einbettung, bevor du das Dokument öffnest, oder öffne keine Dokumente aus Quellen, denen du nicht vertraust. Für die eingebettete Seite gilt die Datenschutzerklärung ihres Betreibers.

## 6. Agentenzugriff (MCP)

Sketchdraw bietet eine **lokale** Verbindung für KI-Agenten (zum Beispiel Claude Code, OpenAI Codex oder Google Antigravity), die du auf demselben Computer betreibst. Ein Agent, den du verbindest, kann das geöffnete Dokument lesen und ändern. Sketchdraw sendet nichts an den Anbieter des Agenten; was der Agent mit den Daten macht, regeln die Bedingungen dieses Anbieters und deine Einstellungen dort. Dokumente aus dem Browser oder von Session-Gästen erhalten diesen Zugriff nicht.

## 7. Was der Herausgeber nicht tut

Keine Werbung, kein Tracking, kein Profiling, kein Verkauf von Daten. Keine Cookies. Schriften, Symbole und der Diagramm-Renderer werden mit der App ausgeliefert und nicht aus dem Internet geladen; Bilder werden nicht von anderen Seiten geladen. Webseiten werden nur für Einbettungen (Abschnitt 5), Plugins (Abschnitt 4) und die Update-Prüfung (Abschnitt 2) kontaktiert. Das Repository und seine Downloads hostet GitHub.

## 8. Deine Rechte

Verarbeitet der Herausgeber personenbezogene Daten von dir (praktisch: IP-Adressen am Relay), hast du das Recht auf **Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit** und **Widerspruch** sowie das Recht, dich bei einer Datenschutz-Aufsichtsbehörde zu beschweren, zum Beispiel der an deinem Wohnort. Weil das Relay nichts speichert und keine Logs führt, kann der Herausgeber eine Verbindung im Nachhinein in der Regel keiner Person zuordnen. Anfragen richtest du an den Kontakt im Abschnitt „Verantwortlicher".

## 9. Kinder

Sketchdraw ist ein professionelles Werkzeug und richtet sich nicht an Kinder.

## 10. Änderungen

Ändert die App, was sie über das Netzwerk sendet, wird diese Erklärung im selben Release angepasst. Der Verlauf steht in der Git-Historie des Repositorys.
