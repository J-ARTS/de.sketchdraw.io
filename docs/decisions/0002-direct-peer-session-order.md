# ADR 0002 — Direkte Peer-Sessions mit validierter Reihenfolge

Status: Architekturentscheidung für S4, Protokoll und Implementierung noch zu prüfen. Tickets #6/#14; Quelle Antigravity AG-04/AG-08 und Codex-Review.

## Kontext

Strict P2P erlaubt keine zentrale Dokument-, Signaling- oder Relay-Infrastruktur. Gleichzeitig benötigen Containerreferenzen, Rollen, Revisionen und Undo eine eindeutige gültige Änderungsfolge. Eine Signatur oder Lamport-Zeit alleine beweist weder Konvergenz noch, dass später eintreffende frühere Commands korrekt eingearbeitet werden. Der Vorschlag aus AG-04 lässt genau diese Finalität offen.

## Entscheidung

Der Nutzer, der eine Session eröffnet, ist ihr `owner`. Dessen laufende Desktop-App koordiniert die Reihenfolge dieser Session; sie ist ein teilnehmender Peer, kein separat betriebener zentraler Dienst. Jeder Teilnehmer verbindet sich direkt per verschlüsseltem WebRTC-DataChannel mit dem Owner. Keine STUN-/TURN- oder Signaling-Server. Offer und Answer werden vollständig gesammelt und manuell ausgetauscht. Ein Gathering-Timeout liefert einen Fehler und erneutes Pairing; es wird kein verborgenes unvollständiges Paket als erfolgreich ausgegeben.

Schreibvorschläge enthalten Session-/Dokument-ID, Actor, eindeutige Command-ID, Basisrevision und validiertes Command. Der Owner prüft authentifizierte Peer-Identität, Rolle, Größenlimits und Basisrevision vor jeder Anwendung. Er bestätigt ausschließlich eine monotone Commitfolge mit vorheriger/nächster Revision und Zustandshash. Empfänger prüfen die gebundene Owner-Identität, Sequenz und Dokumentinvarianten. Doppelte bestätigte Commands werden nicht erneut angewendet; eine abweichende Wiederverwendung derselben ID wird abgewiesen.

Ein Vorschlag auf alter Basis wird als Konflikt zurückgegeben. Nicht überlappende Änderungen dürfen später gezielt zusammengeführt werden, sobald die dafür nötigen Guards und Tests existieren; es gibt kein stilles Last-Writer-Wins. Lokale, noch nicht bestätigte Arbeit bleibt als Entwurf erhalten. Nach einer Lücke wird anhand der letzten bestätigten Revision nachgeladen oder ein authentifizierter und lokal validierter Snapshot übernommen. Bestehende lokale Entwürfe werden dabei nicht verworfen.

Peer-Schlüssel und DTLS-Fingerprint werden an das Pairing-Paket gebunden und über eine sichtbare Fingerprint-Bestätigung geprüft. Rollenfreigaben sind an Session, Dokument, Peer-Key und aktuelle Berechtigungs-Epoche gebunden. Ein Viewer kann keine Schreiboperationen bestätigen lassen; Rollenänderungen sind Owner-Aktionen. Konkrete Signatur-/Serialisierungsverträge werden vor #14 implementiert und negativ getestet.

## Konsequenzen und Grenzen

Der Owner ist die Autorität dieser laufenden Session. Fällt er aus, stoppen gemeinsame Commits; lokale Arbeit bleibt möglich und wird als getrennt/unbestätigt gekennzeichnet. Automatische Ownerwahl, Split-Brain-Zusammenführung und allgemeine Offline-Merge-Garantien sind nicht Teil dieser ersten Protokollentscheidung. Die App darf sie nicht zusagen. Eine Fortsetzung mit anderem Owner ist eine explizite neue Session mit gewähltem gültigem Stand.

Die Netzwerktopologie enthält direkte Peer-Verbindungen und keinen Relay-Server; sie verspricht nicht, jeden Teilnehmer über jeden anderen Peer zu routen. Wenn die Nutzervorgabe darüber hinaus eine vollkommen symmetrische Replikation ohne Sessionautorität verlangt, muss diese Entscheidung vor S4 ersetzt und mit einem vollständigen Konvergenz-/Rechteprotokoll belegt werden.

## Erforderliche Nachweise

Zwei echte Peers ohne externe ICE-Server; Rollenverletzung; konkurrierende Schreibvorschläge; doppelte/vertauschte Pakete; ungültiger Snapshot; Wiederverbindung mit fehlenden Revisionen; Owner-Ausfall ohne lokalen Datenverlust; Fingerprintabweichung; abgelaufenes und unerreichbares Pairing. Keine dieser Prüfungen ist durch dieses ADR bereits bestanden.
