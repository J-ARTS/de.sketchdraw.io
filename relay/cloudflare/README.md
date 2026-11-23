# Sketchdraw-Relay bei Cloudflare

Ein Cloudflare Worker mit einem Durable Object je Session. Er leitet **ausschließlich Ende-zu-Ende-verschlüsselte Datensätze** zwischen einem Gastgeber und seinen Gästen weiter – dasselbe Protokoll (`sketchdraw-relay.v1`) und derselbe Hub (`../hub.mjs`) wie beim selbst betriebenen Relay und beim Desktop-Helfer. Hintergrund und Entscheidung: [ADR 0010](../../docs/decisions/0010-session-route-cloudflare-relay.md), Ticket [#300](https://github.com/J-ARTS/de.sketchdraw.io/issues/300).

In der App wählt der Gastgeber unter „Zusammenarbeiten“ den **Verbindungsweg „Cloudflare-Relay“** und trägt die Adresse dieses Workers ein. Der Session-Link trägt die Adresse des Raums; Gäste brauchen keine Einstellung.

## Was der Relay tut – und was nicht

- Jede Session hat einen eigenen Raum: `wss://<worker>/v1/<topic>`. Der Topic ist `SHA-256(Label ‖ öffentlicher Sitzungsschlüssel des Gastgebers)`. Ein Raum bedient nur seinen Topic.
- Ein Gastgeber registriert sich nur mit Besitznachweis: Er signiert eine frische Challenge mit seinem Ed25519-Sitzungsschlüssel. Wer nur den Link kennt, kann den Raum weder belegen noch den Gastgeber verdrängen.
- Gäste prüfen den im Link gepinnten Schlüssel des Gastgebers und weisen die PIN **innerhalb** des verschlüsselten Kanals nach. Der Relay kennt weder PIN noch Schlüssel noch Inhalt und kann den Gastgeber nicht imitieren.
- Bis zu 24 Gäste je Session (Gastgeber + 24 = 25, wie in der App). Die Gäste sind sternförmig über den Gastgeber verbunden: Was ein Gast zeichnet, geht verschlüsselt zum Gastgeber und von dort an alle.
- Nichts wird gespeichert. Der Raum hält seine Verbindungen im Arbeitsspeicher und verschwindet, wenn die letzte endet. Der Worker enthält kein Geheimnis; in der App liegen keine Cloudflare-Zugangsdaten.
- Der Worker schreibt keine Logs; `observability` ist in `wrangler.jsonc` ausgeschaltet, damit auch Cloudflare keine Anfrage-Logs (mit Topic im Pfad) ablegt.

**Was Cloudflare als Betreiber der Plattform und du als Betreiber des Workers sehen können:** IP-Adressen der Teilnehmenden, Verbindungszeitpunkte, den Topic (ein Hash, kein Geheimnis) und Datenmengen. Das ist der Preis dieses Wegs; der direkte Weg (P2P) zeigt die IP-Adressen stattdessen den anderen Teilnehmenden und den DHT-Knoten.

## Bereitstellen

Voraussetzung: ein Cloudflare-Konto (der kostenlose Workers-Tarif genügt) und Node.js.

```sh
cd relay/cloudflare
npm ci
npx wrangler login      # öffnet den Browser; die Anmeldung bleibt auf deinem Rechner
npx wrangler deploy
```

`wrangler deploy` nennt am Ende die Adresse, zum Beispiel `https://sketchdraw-relay.<dein-subdomain>.workers.dev`. Prüfen:

```sh
curl https://sketchdraw-relay.<dein-subdomain>.workers.dev/healthz
# {"status":"ok","service":"sketchdraw-relay","protocol":"sketchdraw-relay.v1"}
```

Diese Adresse trägst du in der App als **Relay-Adresse** ein (`https://…`, `wss://…` oder nur der Hostname). Soll die App sie von sich aus kennen, setze `DEFAULT_CLOUD_RELAY_URL` in `src/collaboration/hdht/cloud-relay.ts`; dann bleibt das Feld vorbelegt und „Cloudflare-Relay“ funktioniert ohne Eingabe.

Eigene Domain statt `workers.dev`: in `wrangler.jsonc` eine Route oder Custom Domain ergänzen (`"routes": [{ "pattern": "relay.example.org", "custom_domain": true }]`).

## Kontingente und Kosten

Stand der Cloudflare-Dokumentation vom November 2026 ([Durable Objects – Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Workers – Limits](https://developers.cloudflare.com/workers/platform/limits/)); bitte dort nachsehen, bevor du dich darauf verlässt:

| | Workers Free | Workers Paid |
| --- | --- | --- |
| Anfragen an Durable Objects | 100.000 / Tag | 1 Mio. / Monat inklusive, danach 0,15 $ je Mio. |
| Laufzeit der Durable Objects | 13.000 GB-s / Tag | 400.000 GB-s / Monat inklusive, danach 12,50 $ je Mio. GB-s |
| Speicherklasse | nur SQLite-Klassen (so ist `RelayRoom` deklariert) | beliebig |

- Eingehende WebSocket-Nachrichten zählen 20:1 als Anfragen; ausgehende sind frei. 100.000 Anfragen entsprechen also rund 2 Millionen eingehenden Datensätzen am Tag – über alle Sessions zusammen.
- Ein Raum läuft, solange seine Session läuft. Die Sitzungsteilnehmer senden alle 10 Sekunden einen Herzschlag, deshalb schläft ein Raum während einer Session nicht ein. Abgerechnet wird der Arbeitsspeicher des Objekts über die Zeit; bei den vollen 128 MB wären 13.000 GB-s rund 28 Session-Stunden am Tag, tatsächlich belegt ein Raum weniger. Das ist eine Abschätzung, keine Messung.
- Im kostenlosen Tarif endet der Dienst für den Tag, wenn ein Kontingent erschöpft ist (Fehler statt Rechnung). Laufende Sessions verlieren dann ihren Weg.
- Der Relay ist offen: Wer das Protokoll spricht, kann einen Raum eröffnen. Die Grenzen im Hub (66 KiB je Datensatz, 250 Nachrichten/s und 4 MiB/s je Verbindung, 60 s Leerlauf, 13 h Höchstdauer, 40 Verbindungen je Raum) begrenzen den Schaden, ersetzen aber keine Zugangskontrolle. Wenn das ein Problem wird: Cloudflare-Regeln (Rate Limiting, WAF) vor den Worker setzen.

## Lokal ausprobieren und testen

```sh
cd relay/cloudflare
npm ci
npx wrangler dev          # startet den Worker lokal (workerd), z. B. auf http://127.0.0.1:8787
```

In der App als Relay-Adresse `ws://127.0.0.1:8787` eintragen (unverschlüsselt ist nur für den eigenen Rechner erlaubt).

Tests (im Wurzelverzeichnis des Repos):

```sh
npx vitest run --config vitest.config.ts tests/unit/collaboration/hdht/cloud-relay.spec.ts tests/unit/collaboration/hdht/cloudflare-worker.spec.ts
npx playwright test --config playwright.config.ts --project=ui tests/ui/session-route.spec.ts
```

- `cloud-relay.spec.ts`: Adressen, Raumlogik und eine Session mit vier Gästen – ohne Workers-Laufzeit.
- `cloudflare-worker.spec.ts`: derselbe Worker in der echten Workers-Laufzeit (workerd), gestartet aus `wrangler.jsonc`: Besitznachweis, falscher Topic, eine Session mit vier Gästen, zwei getrennte Sessions. Läuft nur, wenn `npm ci` in diesem Ordner ausgeführt wurde; sonst wird er übersprungen.
- `session-route.spec.ts`: die Oberfläche mit drei Gästen über das selbst betriebene Relay, das dieselben Raumadressen annimmt.
- `tests/electron/session-route.spec.ts`: die gebaute Desktop-App als Gastgeber über den Relay-Weg (läuft mit den übrigen Electron-Tests).

**Nicht geprüft:** der Betrieb im echten Cloudflare-Netz (Bereitstellung, `workers.dev`-Adresse, Verhalten bei erschöpftem Kontingent, Verbindungen durch Firmen-Proxys). Das lässt sich nur mit einem Konto prüfen.
