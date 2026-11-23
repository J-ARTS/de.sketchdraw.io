# Review: Verbindungsweg „Cloudflare-Relay“ (#300)

Stand 23.11.2026, Cloud-Sitzung Claude Code (Modell Claude Fable 5.2). Entscheidung: [ADR 0010](../decisions/0010-session-route-cloudflare-relay.md). Dieser Bericht nennt Bedenken mit Fehlerfall, Auswirkung und Alternative sowie das, was nicht geprüft ist.

## Was gebaut ist

- Auswahl „Direkt (P2P)“ / „Cloudflare-Relay“ im Panel „Zusammenarbeiten“, Relay-Adresse, Texte dazu (Deutsch/Englisch).
- `relay/cloudflare/`: Worker und Durable Object `RelayRoom` (ein Raum je Session) auf dem vorhandenen Hub.
- Hub: `acceptTopic`; Node-Relay: Raumadressen `/v1/<topic>`; Relay-Client: Keep-alive des wartenden Gastgebers.

## Bedenken

| ID | Fehlerfall | Auswirkung | Umgang / Alternative |
| --- | --- | --- | --- |
| CR-01 | Das Zielbild sagt „ohne … Relay-Server“; die App bietet jetzt einen an. | Aussage in `CLAUDE.md`, `AGENTS.md` und Werbetexten stimmt nicht mehr uneingeschränkt. | Direkt bleibt Voreinstellung, der Relay ist eine ausdrückliche Wahl je Session und wird im Panel erklärt. Zielbild anpassen (Owner/Codex). |
| CR-02 | Ein Session-Link nennt einen beliebigen Relay (`r`). Wer dem Link folgt, öffnet eine Verbindung dorthin. | Der genannte Server erfährt IP-Adresse und Zeitpunkt des Gasts, sobald dieser auf „Mit PIN beitreten“ klickt – keinen Inhalt und keine PIN. Das Einfügen des Links allein öffnet nichts. | Das Panel nennt den Relay unter dem Link, bevor beigetreten wird. Alternative: nur bekannte Relays ohne Rückfrage zulassen (Allowlist) – verworfen, weil selbst betriebene Relays dann nicht gingen. |
| CR-03 | Offener Relay: Jeder mit einem Schlüsselpaar kann einen Raum eröffnen und Daten durchleiten. | Kontingent des Betreibers wird von Fremden verbraucht; im kostenlosen Tarif endet der Dienst für den Tag. | Grenzen des Hubs je Verbindung; Cloudflare-Regeln (Rate Limiting) vor dem Worker. Alternative: Zugangsschlüssel im Link – würde ein Geheimnis in jede Einladung legen und Missbrauch durch Gäste nicht verhindern. |
| CR-04 | Kontingent erschöpft oder Worker neu bereitgestellt. | Laufende Sessions verlieren den Weg. Gastgeber und Gäste versuchen es erneut (Gast fünf Minuten); danach „Verbindung … ließ sich nicht wiederherstellen“. Die lokale Zeichnung bleibt. | Meldung nennt den Relay. Kein automatischer Wechsel auf P2P (ADR 0010, Punkt 2). |
| CR-05 | Workers melden nicht, wie viel auf einer Verbindung zum Senden ansteht (`bufferedAmount` ist dort 0). | Die Rückstau-Grenzen des Hubs („slow consumer“) greifen im Worker nicht; ein sehr langsamer Gast lässt Daten im Speicher des Raums anwachsen. | Begrenzt durch die Raten je Sender (4 MiB/s, Burst 10 MiB) und die Fristen der Clients (Herzschlag 30 s). Ein Objekt hat laut Cloudflare 128 MB Speicher; was bei Überschreitung genau geschieht, ist nicht geprüft. Alternative: eigene Quittungen im Raum – nicht gebaut. |
| CR-06 | Die Workers-Laufzeit (Kompatibilitätsdatum 2026-11-01) liefert Binärnachrichten nicht als `ArrayBuffer`, solange `binaryType = 'arraybuffer'` nicht gesetzt ist. | Ohne die Einstellung leitete der Raum leere Datensätze weiter; der Handshake blieb hängen. Im Laufzeittest gefunden. | Behoben: Der Raum setzt den Typ und beendet eine Verbindung, die trotzdem etwas anderes liefert (1003). Test in beiden Spezifikationen. |
| CR-07 | Ein Gastgeber wartet ohne Gäste. | Der Hub trennt nach 60 s Leerlauf; im Laufzeitversuch ohne Keep-alive nach 85 s: `RELAY_CLOSED:idle`, Neuregistrierung. In der Lücke bekäme ein Gast „Gastgeber nicht da“. | Behoben: `ping` alle 20 s. Im selben Versuch blieb der Gastgeber registriert und ein Gast trat nach 85 s bei. |
| CR-08 | Firmen-Proxys mit TLS-Inspektion oder gesperrten WebSockets. | Auch der Relay-Weg kommt dann nicht zustande. | Meldung nennt WebSocket-Verbindungen als Ursache. Nicht geprüft; ein HTTP-Rückfall (Long Polling) wäre ein eigenes Vorhaben. |
| CR-10 | Das Formular vor dem Start wurde durch die Auswahl länger; im Standardfenster (1280×800) rutschte „Mit PIN beitreten“ unter den sichtbaren Bereich. | Gäste hätten scrollen müssen; im Test lag der Zeiger danach auf der Meldung „Session beigetreten“, die deshalb stehen blieb. | Behoben: Link und PIN stehen in einer Zeile, der Relay-Hinweis unter der Schaltfläche. Ein Test prüft, dass „beitreten“ ohne Scrollen erreichbar ist. |
| CR-09 | `wrangler` ist eine neue Entwicklungsabhängigkeit (nur in `relay/cloudflare/`, nicht in der App). | Größerer Werkzeugbestand, eigene Sperrdatei. | Getrenntes Paket; die App und ihr Installer enthalten nichts davon. |

## Geprüft

- Echte Workers-Laufzeit (workerd 4.166.0 über `wrangler`, lokal): Besitznachweis mit Ed25519 über `node:crypto`, falscher Topic, Gast ohne Gastgeber, eine Session mit Gastgeber und vier Gästen mit Abgleich in beide Richtungen, zwei getrennte Sessions, Sitzungsende erreicht alle Gäste.
- Gebaute Desktop-App (Electron, lokal unter Linux) als Gastgeber über das selbst betriebene Relay: Link ohne Direktschlüssel, zwei Gäste erhalten die Zeichnung, der Relay-Helfer des Geräts läuft nicht, keine CSP-Verstöße (`tests/electron/session-route.spec.ts`).
- Oberfläche im Browser gegen das selbst betriebene Relay: Auswahl, Adressprüfung, drei Gäste zeichnen mit dem Gastgeber, Relay nicht erreichbar, beendete Session, Englisch, dunkles Thema.

## Nicht geprüft

- Bereitstellung und Betrieb im Cloudflare-Netz (kein Konto in dieser Sitzung), `workers.dev`-Adresse, erschöpftes Kontingent, mehrere Regionen.
- Die installierte Desktop-App auf macOS und Windows über den Relay-Weg (der Electron-Test lief lokal unter Linux; die anderen Plattformen prüft CI).
- Zwei Desktop-Apps gegeneinander über den Relay – im Electron-Test sind die Gäste Bibliotheksclients.
- Lasttests (24 Gäste, große Bilder) über den Worker.

## Nachtrag 23.11.2026: Voreinstellung, Feldhöhe, TURN-Erprobung

| ID | Fehlerfall | Auswirkung | Umgang / Alternative |
| --- | --- | --- | --- |
| CR-11 | Die Voreinstellung der Relay-Adresse zeigt auf den Worker des Herausgebers. | Alle Nutzer teilen sich dessen Kontingent; ist es erschöpft, fällt der Relay-Weg für alle aus. | Feld bleibt änderbar; eigener Relay möglich. Beobachten, bevor das Release breit verteilt wird. |
| CR-12 | Textfelder des Panels wurden auf die Höhe der Auswahlfelder gebracht (42 px, Wunsch des Owners). | Das Formular wird 16 px höher. | Der Test, dass „Mit PIN beitreten“ ohne Scrollen erreichbar bleibt, läuft weiter mit. |
| CR-13 | Der zuletzt bereitgestellte Worker stammt aus der TURN-Erprobung und gibt mit gesetzten Secrets TURN-Zugangsdaten an jede Raumverbindung aus. | Fremde können darüber Datenverkehr auf das Konto des Betreibers legen (oberhalb von 1.000 GB/Monat kostenpflichtig). | Owner: TURN-Schlüssel löschen, Secrets entfernen, Worker vom aktuellen Stand neu bereitstellen. |

Cloudflare TURN als dritter Weg wurde erprobt und wieder ausgebaut ([ADR 0011](../decisions/0011-poc-cloudflare-turn.md), #303). Im Cloudflare-Netz geprüft ist der Worker-Relay mit drei Gästen (#302).
