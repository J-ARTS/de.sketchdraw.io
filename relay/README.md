# Sketchdraw: dezentrale Helfer und optionales WSS-Gateway

## Ohne eigenen Server: freiwillige Desktop-Helfer

Die Desktop-App sucht Teilnehmer über HyperDHT. Eine Sitzung versucht zuerst den direkten Weg; bei Bedarf findet der Gast über ein sitzungsspezifisches DHT-Topic Helfer, bei denen der Gastgeber seinen Sitzungsschlüssel bereits nachgewiesen hat. Der Gastgeber registriert sich möglichst bei zwei Helfern. Beim Ausfall wird neu verbunden und Yjs gleicht den Dokumentstand ab.

Solange eine Session dieses Geräts läuft, bietet die Desktop-App die Weiterleitung automatisch an; es gibt keinen Schalter (ADR 0007, #162). Der Helfer benutzt einen eigenen flüchtigen Schlüssel, endet mit der eigenen Sitzung oder beim Schließen des App-Fensters. Es gibt keine gespeicherten Fremddokumente. Die angebotene Anwendungsweiterleitung ist auf 48 Verbindungen, 8 Sitzungen, 24 Gäste je Sitzung und insgesamt 12 MiB/s (24-MiB-Burst) begrenzt. Grenzen der darunterliegenden HyperDHT-Handshakes sind davon getrennt.

Das ist ein implementiertes Protokoll, keine vorhandene öffentliche Relay-Flotte. Es braucht tatsächlich erreichbare und eingeschaltete Helfer. Bei ungünstigem NAT oder vollständig blockiertem UDP kann auch ein Helfer unerreichbar bleiben. Die lokale DHT-Testumgebung belegt keine Internet-NAT-/Proxy-Abdeckung; siehe Issue #72 und `docs/reviews/149-decentralized-relay-decision.md`.

## Optionales WSS-Gateway

**Seit #162 hat die App keine Gateway-Einstellung mehr.** Der folgende eigenständig betreibbare Dienst bleibt als Bibliothek und für die Browser-UI-Tests erhalten (Entwicklungsschlüssel `localStorage['sketchdraw.hdht-relay-url.v1']`); er ist kein Produktweg.

Leitet **ausschließlich Ende-zu-Ende-verschlüsselte Datensätze** zwischen einem Gastgeber und seinen Gästen weiter, wenn eine direkte HyperDHT-Verbindung (UDP) nicht zustande kommt oder ein Browser teilnimmt. Der Relay

- speichert nichts (nur Arbeitsspeicher, kein Dokument, keine privaten Sitzungsschlüssel, keine PIN),
- kann den Gastgeber nicht imitieren (Gäste prüfen den im Link gepinnten Schlüssel) und nichts mitlesen,
- loggt weder URLs noch Topics noch Inhalte (nur Start/Ende und Zähler über `/healthz`),
- erlaubt die Registrierung eines Gastgebers nur mit Besitznachweis: der Topic ist `SHA-256(Label ‖ Gastgeber-Schlüssel)`, und der Gastgeber signiert eine frische, pro Verbindung erzeugte Challenge mit seinem Ed25519-Schlüssel. Link-Inhaber ohne privaten Schlüssel können einen laufenden Gastgeber weder verdrängen noch einen Topic vorab belegen,
- sieht Metadaten: IP-Adressen, Verbindungszeitpunkte, einen aus dem öffentlichen Sitzungsschlüssel abgeleiteten Topic-Hash und Datenmengen.

**Es gibt keinen mitgelieferten oder öffentlichen Produktiv-Endpunkt.** Die App bietet dafür keine Einstellung mehr; ein selbst betriebenes Gateway lässt sich nur über den Entwicklungsschlüssel ansprechen. Der Relay garantiert nicht, dass jede Firewall oder jeder Proxy durchlässig ist; ein Netzwerk, das WebSockets nach außen blockiert, bleibt ohne Verbindung.

## Starten

```sh
cd relay
npm ci --omit=dev
RELAY_HOST=127.0.0.1 RELAY_PORT=8787 node server.mjs
curl http://127.0.0.1:8787/healthz   # {"status":"ok",...}
```

Docker:

```sh
docker build -t sketchdraw-relay relay
docker run -d --restart=unless-stopped -p 127.0.0.1:8787:8787 sketchdraw-relay
```

## TLS (Pflicht außerhalb von Loopback)

Die App akzeptiert nur `wss://` (ohne Zugangsdaten, Query oder Fragment); `ws://` ist nur für Loopback erlaubt. IPv6-Literale `[::1]` werden auf `localhost` normalisiert, weil Chromium IPv6-Literale in CSP-Hostquellen nicht unterstützt; es wird keine allgemeine `ws:`-Freigabe benötigt. TLS terminiert ein Reverse-Proxy auf Port 443. Beispiel nginx:

```nginx
server {
  listen 443 ssl http2;
  server_name relay.example.org;
  ssl_certificate     /etc/letsencrypt/live/relay.example.org/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/relay.example.org/privkey.pem;
  access_log off;                       # keine URLs/IPs protokollieren, wenn nicht nötig
  location /healthz { proxy_pass http://127.0.0.1:8787; }
  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_read_timeout 120s;
  }
}
```

Hinter einem Proxy `RELAY_TRUST_PROXY=1` setzen, damit das Verbindungslimit pro IP die echte Client-Adresse nutzt (nur wenn der Proxy `X-Forwarded-For` selbst setzt und nicht durchreicht).

## Konfiguration (Umgebungsvariablen)

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `RELAY_HOST` / `RELAY_PORT` | `127.0.0.1` / `8787` | Bind-Adresse |
| `RELAY_MAX_CONNECTIONS` | 2000 | gleichzeitige Verbindungen gesamt |
| `RELAY_MAX_CONNECTIONS_PER_IP` | 40 | je Client-IP |
| `RELAY_MAX_TOPICS` | 1000 | gleichzeitige Sessions |
| `RELAY_MAX_GUESTS_PER_TOPIC` | 24 | Gäste je Session (Gastgeber + 24 = 25) |
| `RELAY_TRUST_PROXY` | `0` | `1`: letzte `X-Forwarded-For`-Adresse nutzen |
| `RELAY_ALLOWED_ORIGINS` | leer (alle) | kommagetrennte Origin-Allowlist für Browser |

Feste Grenzen im Code (`DEFAULT_LIMITS`): Datensatz max. 66 KiB, Beitritt binnen 5 s, 60 s Leerlauf (Ping/Pong), 13 h maximale Verbindungsdauer, 250 Nachrichten/s und 4 MiB/s je Verbindung (Burst 10 MiB, deckt eine 8-MiB-Nachricht ab; Clients takten darunter), 12 MiB Sendepuffer je verbundenem Ziel (einschließlich Steuernachrichten), 64 KiB vor dem Beitritt und 64 MiB gemeinsames Ausgangspufferbudget. Das gemeinsame Budget umfasst die von den Adaptern gemeldeten Puffer einschließlich Framingreserve, nicht den gesamten Prozess-/Kernel-/UDX-Speicher. Langsame Empfänger werden begrenzt getrennt. Verbindungen, die ein Limit verletzen, werden mit den Codes 4408/4429/4503 geschlossen.

## Betrieb

- `GET /healthz` liefert Status und Zähler (keine Session-Daten) für Monitoring/Healthchecks.
- Bei Neustart verlieren Sessions ihren Relay-Weg; Gastgeber und Gäste verbinden sich automatisch erneut (begrenzter Backoff) und handeln frische Schlüssel aus.
- Schlägt der Gastgeber-Link fehl, prüft in dieser Reihenfolge: Relay erreichbar (`/healthz`), TLS-Zertifikat gültig, Proxy leitet `Upgrade` durch, Gastgeber-App läuft.

## Bilder und vollständige Dokumente

Bilder liegen mit ihren Daten im gemeinsamen Yjs-Dokument, ebenso Zeichnungselemente, Seiten, Notizen, Annotationen, Kommentare und Aufgaben. Ein normaler Delta-Datensatz bleibt auf 4 MiB begrenzt. Größere vollständige Zustände oder Bildänderungen werden als versionierte, geordnete 48-KiB-Pakete übertragen, mit Längen-/Offsetprüfung und SHA-256 vollständig zusammengesetzt und anschließend durch die gleichen Rollen- und Dokumentschemaprüfungen übernommen. Yjs-Identitäten bleiben erhalten, damit spätere Änderungen und Wiederverbindungen konvergieren.

Pro Binding gelten höchstens 64 MiB gleichzeitig reservierte Empfangsdaten, acht Transfers, eine Leerlauffrist von 30 Sekunden und eine Gesamtfrist von zwei Minuten; der Beitritt besitzt zusätzlich seine eigene Frist. Der Sender begrenzt wartende Daten ebenfalls auf 64 MiB und 32 Aufträge. Die vorhandenen Dokument- und Bildlimits des Dateiformats bleiben unverändert. Ein zu großer oder fehlgeschlagener Abgleich wird sichtbar beendet. Keine unbeschränkte Dokumentgröße und keine sofortige Übertragung über beliebig langsame Netze zugesagt.

Nachweise für echte große PNGs, mehrere Seiten, Notizen und Folgeänderungen stehen in `tests/unit/collaboration/hdht/session-rich-document.spec.ts`. Der Relay leitet auch diese Inhalte ausschließlich verschlüsselt weiter.
