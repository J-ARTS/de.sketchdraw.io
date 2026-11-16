# Unabhängige Einordnung des Fable-Gesamtreviews

Geprüft durch Codex Root und Codex live_correction_review; kein zusätzlicher Fable-Beitrag. Statische Prüfung am plugin-service.ts SHA 8b509dd9b25839f682eb52af14413f91f50061ad851737cf16abee80afad3380. Hier keine neuen Tests ausgeführt.

- **B1 bestätigt (P2):** updateLiveLinks/remember wartet beim Datei-I/O; Einstellungen klonen this.config vor Abschluss. Die folgende serielle saveConfig-Mutation ersetzt die inzwischen neu gespeicherten Links durch den alten Snapshot. Fix muss Links innerhalb der Queue aus dem aktuellen Profil erhalten und absichtliche Jira-Deinstallation weiterhin entfernen lassen.
- **B2 bestätigt (P2):** parseConfluenceLinks begrenzt published/pending auf je400 und lehnt Steuerzeichen im Dokumentpfad ab; Writer prüft dies bisher nicht gleichwertig. Gültige Dateipfade mit Zeilenumbruch und kumulativ401 Seiten-IDs können den nächsten Profilladevorgang sperren.
- **B2-Alternative abgelehnt:** Historische Einträge nur auf aktuelle images zu beschneiden verliert bekannte Attachment-ID/Version und damit den strengeren Konfliktzweig. Stattdessen gleichwertige Schreibvalidierung sowie Kapazitätsprüfung vor Remote-POST/PUT; keine stille Löschung von Besitz-/Pending-Nachweisen.
- **B4 bestätigt:** runLivePublish lädt Anhänge hoch, bevor planManagedImages unsafe prüft. Bereits gelesener Body erlaubt Vorprüfung vor Remote-Schreibvorgängen; Frischlese-/Konfliktschutz bleibt nötig.
- **B5 bestätigt:** finally plant bei dirty nur debounceMs, obwohl failed zuvor holdUntil setzt. Dokumentänderungen außerhalb laufender Versuche beachten die Haltezeit bereits. Regression muss während blockiertem Publish ändern und bis Haltefrist keinen Folgeaufruf zulassen.
- **B7 bestätigt:** PNG oberhalb CONFLUENCE_LIVE_MAX_IMAGE_BYTES endet zusammen mit Schemafehlern in einer generischen Meldung. Kleine spezifische validierte/lokalisierte Meldung mit Seite und Limit ist angemessen; kein neuer Rasterpipeline-Entwurf.
- **B3 offen, #219:** #71 versprach produktive Wiederherstellung; neue Cache-/Authority-Trennung darf nicht als vollständige Recovery ausgegeben werden. Datei/Git hat Vorrang; kontrollierte Recovery benötigt eigenen Produktvertrag. In diesem Korrekturlauf kein Cache-/CRDT-Edit.
- **B6 offen, #220:** vorbestehender Crash-/Close-Pfad separat erfasst; keine native Crash-Reproduktion oder Behebung behauptet. In diesem Korrekturlauf kein main/handshake-Edit.

## Umfang / Nachweise

33 geänderte/neue Code-/Testdateien im Integrationsworktree,22 im Original,35 eindeutige Pfade,16 bytegleich. Original noch alter Cache-/Quit-Stand. Bis zum Start der Fable-Korrektur unveränderter Produktcode seit Root-6/6; die einzige zusätzliche Änderung backend-shell.spec.ts wurde separat4/4 geprüft.

Der erste Fable-Lauf ist terminal erfolgreich als Werkzeuglauf, aber mit Befunden und ausdrücklich partieller Dateiabdeckung. Das ist keine Gesamtfreigabe. Folgelauf muss Korrekturen und zuvor ungelesene Abschnitte vollständig bearbeiten; Root prüft anschließend Quellstand, Tests und Abdeckung erneut.
