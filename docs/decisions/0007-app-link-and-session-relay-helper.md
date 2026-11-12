# ADR 0007 — App-Link für Sessions, Relay-Helfer mit der Session, keine Gateway- und WebRTC-Oberfläche

Status: angenommen und umgesetzt ([#162](https://github.com/J-ARTS/de.sketchdraw.io/issues/162)). Nutzerentscheidung vom 11./12.11.2026. Ändert Punkt 2 und 6 der Entscheidung in `docs/reviews/149-decentralized-relay-decision.md` und löst die Oberfläche aus [ADR 0003](0003-trystero-proxy-assisted-collaboration.md) ab.

## Anlass

Ein im Entwicklungsmodus erzeugter Link begann mit `http://127.0.0.1:5173/`. Die bisherige Standardadresse `https://de.sketchdraw.io/` war nicht erreichbar, die App registrierte keinen Link-Handler, und ein Browser kann ohne WSS-Gateway nicht beitreten. Der Link war damit nur Text zum Einfügen; die Adresse davor trug nichts bei.

## Entscheidung

1. **Link-Format.** Session-Links lauten `sketchdraw://join#sketchdraw-hdht=<Einladung>`. Die Einladung bleibt unverändert (Session-ID, Host-Schlüssel, HyperDHT-Direktschlüssel, Dokument-ID, Ablaufzeit; das Feld `r` bleibt aus Kompatibilitätsgründen im Format und ist im Produkt leer). Die PIN steht nie im Link. Der Parser wertet weiterhin nur das Fragment aus; ältere `https://…#sketchdraw-hdht=…`-Links bleiben beim Einfügen gültig.
2. **Link-Handler.** Nur die paketierte App registriert das Schema `sketchdraw` (`protocols` in `electron-builder.json`, `setAsDefaultProtocolClient`). macOS reicht den Link an die laufende App weiter (`open-url`); unter Windows und Linux startet der Link einen eigenen Prozess mit eigenem Fenster, weil die App weiterhin mehrere Instanzen erlaubt und das Dokument einer laufenden Instanz so unberührt bleibt. Der Hauptprozess akzeptiert ausschließlich das exakte Muster aus `src/collaboration/hdht/app-link.ts`, hält den validierten Fragmenttext bis zur Abholung vor und meldet dem Renderer nur „Link liegt vor“ (`INVITE_LINK_EVENT` ohne Nutzlast, Abholung über `INVITE_LINK_TAKE` mit Absenderprüfung). Der Renderer öffnet „Zusammenarbeiten“ und füllt den Link vor; der Beitritt verlangt weiterhin die getrennt geteilte PIN. Entwicklungs- und Testläufe registrieren nichts.
3. **Relay-Helfer.** Solange eine Session dieses Geräts läuft (als Gastgeber oder Gast), bietet die Desktop-App ihre begrenzte Weiterleitung auch anderen Sessions an. Es gibt keinen Schalter. Der Helfer endet mit der Session; ein Helferfehler wird angezeigt und beendet die Session nicht. Grenzen und Verschlüsselung des Helfers (`relay/README.md`) bleiben unverändert.
4. **Kein Gateway, kein WebRTC in der Oberfläche.** Die Felder „Optionales WSS-Gateway“ und „Adresse der Web-App für Einladungslinks“ sowie der Abschnitt „Alternative Verbindung (WebRTC)“ entfallen. „Manuell ohne Server verbinden“ bleibt als letzter Ausweg. Die Browservorschau kann keine Session starten oder beitreten und sagt das.

## Folgen und Grenzen

- Zusammenarbeit ist Desktop-zu-Desktop: HyperDHT direkt, sonst freiwillige Helfer. Ist UDP auf einer Seite vollständig gesperrt, entsteht keine Verbindung; es gibt dafür keinen Produktweg mehr. Feldnachweise über echte Internet-NATs bleiben offen (#72).
- Jede laufende Session trägt Bandbreite zum Helfernetz bei (höchstens 48 Verbindungen, 8 Sessions, 12 MiB/s). Helfer sehen IP-Adressen, Zeitpunkte, Topics und Datenmengen, aber keine Inhalte oder PINs. Das ist für Nutzer im Panel beschrieben, aber nicht abwählbar.
- Der Relay-Transport (`relay/`, WSS-Adapter in `src/collaboration/hdht`) bleibt als Bibliothek und Testweg erhalten: Die Browser-UI-Tests richten den Renderer über den Entwicklungsschlüssel `localStorage['sketchdraw.hdht-relay-url.v1']` auf ein lokales Relay. Das ist keine Produkteinstellung.
- `src/collaboration/automatic.ts` (Trystero/MQTT/WebRTC) und `src/collaboration/session-link.ts` haben keinen Aufrufer in der Oberfläche mehr. Ihre Unit-Tests laufen weiter; das Entfernen von Code und Abhängigkeit `@trystero-p2p/mqtt` ist ein eigener Schritt.
- Die Schema-Registrierung ist nur im paketierten Build wirksam und auf den Zielplattformen noch nicht von Hand geprüft.
