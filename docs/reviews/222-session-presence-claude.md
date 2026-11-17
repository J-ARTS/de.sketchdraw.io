# Session: Teilnehmerliste, Mauszeiger, Entfernen und Wiederverbinden

Issue #222, Claude Code (Fable 5.2), 17.11.2026. Auftrag: Teilnehmende unter „Zusammenarbeiten" auflisten, Mauszeiger der anderen mit Initialen und Farbe zeigen, Personen entfernen können, Meldung beim Entfernen und beim Beenden, Zeitfenster von fünf Minuten zum Wiederverbinden.

## Entscheidungen

| Frage | Entscheidung | Grund |
| --- | --- | --- |
| Wie erfahren Gäste voneinander? | Der Gastgeber schreibt die Liste und reicht Zeiger weiter (`src/collaboration/presence.ts`). | Gäste erreichen nur den Gastgeber. Die Yjs-Awareness-Bindung lässt einen Peer nur für sich selbst sprechen; der Gastgeber könnte fremde Zustände nicht weitergeben. |
| Woran erkennt der Gastgeber einen zurückkehrenden Gast? | An einem Geheimnis, das der Gast je Teilnahme würfelt und nur dem Gastgeber nennt. | Gäste haben keine dauerhafte Identität; `peerId` und Schlüsselbindung wechseln mit jeder Verbindung. |
| Was heißt „Timeout fünf Minuten"? | Zeitfenster zum Wiederverbinden (Rückfrage beantwortet). | Vorher gab der Gast nach acht Versuchen auf, also nach rund 50 Sekunden. |
| Wo steht der Name? | Feld „Dein Name" im Bereich Zusammenarbeiten, gespeichert auf dem Gerät. | Es gibt keine Nutzerprofil-Einstellung für einen Namen. Ohne Angabe: „Gast 1", „Gast 2", … |
| Wann erscheint zusätzlich eine Meldung über der Zeichenfläche? | Nur solange der Bereich „Zusammenarbeiten" geschlossen ist (Beitritt, entfernt, Session beendet, Verbindung verloren). | Bei offenem Bereich steht es dort bereits. Die Meldungen liegen unten rechts über dem Bereich und verdeckten im ersten Stand „Session beenden" (Windows-CI, natives Fenster). |
| Wie wird entfernt? | Schaltfläche je Zeile, eine Rückfrage in der Zeile, kein eigener Dialog. | Die Handlung ist folgenreich, aber schnell wiederholbar; ein Dialog wäre für eine Liste zu schwer. |

## Gestaltung

- Acht Teilnehmerfarben als Tokens (`--presence-1` … `--presence-8`, `--presence-ink`) mit eigenen Werten für hell und dunkel; Kontrast Schrift auf Farbe mindestens 5,0 (hell) bzw. 8,1 (dunkel).
- Ein Zeichen für eine Person: Abzeichen mit einer eckigen Ecke (`AppAvatar`). Dieselbe Form hängt auf der Zeichenfläche am Pfeil, sodass Liste und Zeiger als dieselbe Person lesbar sind.
- Zeiger stehen in Dokumentkoordinaten und behalten beim Zoomen ihre Größe; Bewegung wird über 90 ms geglättet, bei reduzierter Bewegung nicht.
- Unterbrochene Einträge: Abzeichen nur als Umriss, zweite Zeile „Verbindung unterbrochen".

## Bedenken und Grenzen

| Nr. | Fehlerfall | Auswirkung | Umgang |
| --- | --- | --- | --- |
| 1 | Eine entfernte Person tritt mit Link und PIN erneut bei. | Entfernen wirkt nur, bis sie es wieder versucht. | Die Oberfläche sagt das nach dem Entfernen und verweist auf „Neue PIN". Eine echte Sperre braucht eine dauerhafte Gastidentität – Architekturfrage für Codex. |
| 2 | „Neue PIN" während Gäste verbunden sind. | Bricht eine Verbindung danach ab, scheitert das automatische Wiederverbinden dieser Gäste mit `PIN_INVALID`. | Bestehendes Verhalten, jetzt wegen des längeren Fensters sichtbarer. Offen. |
| 3 | Gast ist bis zu fünf Minuten im Zustand „unterbrochen". | So lange schreibgeschützt; lokale Eingaben sind nicht möglich. | Hinweis im Bereich Zusammenarbeiten. Bisher endete der Zustand nach rund 50 Sekunden mit einem Fehler. |
| 4 | Viele Teilnehmende über Relay-Helfer. | Zeigerdaten: bis zu 12 Bündel je Sekunde und Gast. | Gebündelt, je Sender begrenzt, bei Rückstau verworfen. Unter realer Last nicht gemessen. |
| 5 | Zeiger auf einer leeren Zeichenfläche. | Der Starthinweis in der Mitte liegt über der Zeichenfläche und kann einen Zeiger verdecken. | Verschwindet mit dem ersten Element; nicht geändert. |
| 6 | Laserpointer-Geste. | Während des Ziehens mit dem Laser meldet die Fläche keine Zeigerposition; der geteilte Zeiger bleibt stehen. | Offen, klein. |
| 7 | Ein fehlgeschlagener Versand (auch einer Zeigerposition) beendet den verschlüsselten Kanal; der Gast verbindet sich neu. | Verliert ein Gast mitten im Ziehen die Verbindung, wird die begonnene Form verworfen (bestehendes Verhalten, `pointerUp` ohne Schreibrecht). Mit geteilten Zeigern gibt es mehr Sendevorgänge. | Im UI-Test für Sendefehler berücksichtigt; im Produkt unverändert. Offen. |

## Prüfung

Siehe Issue #222 (Befehle und Ergebnisse als Kommentar). Nicht geprüft: die gebaute Electron-App auf einem echten Gerät und Verbindungen über echte Relay-Helfer.
