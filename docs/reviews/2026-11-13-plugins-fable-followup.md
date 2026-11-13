# Begrenzter Fable-Nachreview: Plugins — 13.11.2026

Unveränderter Originalbericht, tatsächliches Modell `claude-fable-5-2`, `high`, read-only. Die zwei Befunde wurden anschließend korrigiert; Auflösung im Auditbericht.

---

Nachreview nur gelesen, nichts ausgeführt. Graphify konnte ich mit dem Read-Werkzeug nicht aufrufen. Es bleiben ein P1 und ein P2, beide in den Korrekturen selbst.

## Verbliebene Befunde

**P1 – Der Loader ist strenger als der Schreiber: ein von der App selbst geschriebener Store sperrt nach Neustart alle Profile** (`electron/plugin-service.ts:141` gegen `:548`)

- **Ursache:** `configureGit` übernimmt `credentialRemoteUrl` ungeprüft aus `git remote get-url` (Zeile 548). Beim Laden läuft derselbe Wert durch `normalizeGitRemoteUrl` (Zeile 141).
- **Fehlerfall:** Token-Modus, kein Remote-URL-Feld, bestehendes Repo mit `https://user@bitbucket.org/team/repo.git` (Bitbuckets Standard-Clone-URL) oder `http://gitlab.intern/...`. Speichern gelingt, die Variante mit Benutzername funktioniert sogar zur Laufzeit.
- **Auswirkung:** Beim nächsten Start wirft der Loader, der gesamte Store gilt als `invalid-data`, und alle Profile erscheinen als Standard und sind gesperrt, bis jemand das JSON von Hand repariert. Das trifft auch bereits vorhandene Stores mit solchen Werten.
- **Korrektur:** Die erkannte URL in Zeile 548 mit derselben Funktion prüfen und bei Verstoß nicht binden oder vor dem Speichern ablehnen. In Zeile 141 `credentialRemoteUrl` nur als begrenzten String prüfen, da es ein reiner Vergleichsschlüssel ist.
- **Regressionstest:** `runGit` liefert `https://user@host/repo.git`, konfigurieren, neue Service-Instanz lädt ohne `configurationIssue`.

**P2 – Die Vorprüfung in `configureGit` läuft außerhalb der `storeQueue` und kann eine falsche, klebrige `external-change`-Sperre auslösen** (`:527`, `:295-304`)

- **Fehlerfall:** Die Vorprüfung liest die Datei, während eine eigene `mutateStore` läuft (Legacy-Übernahme beim Dokumentöffnen, Profilwechsel, Doppelauslösung). Sie liest den alten Inhalt vor dem Rename und vergleicht erst nach Zeile 353 mit der neuen `storeRevision`.
- **Auswirkung:** Die Instanz meldet „außerhalb dieser App-Instanz geändert“ und bleibt bis zum Neustart gesperrt, obwohl nur sie selbst geschrieben hat. Das Fenster ist klein (Millisekunden), es gibt keinen Datenverlust.
- **Korrektur:** Die Vorprüfung als eigenen Schritt in die Queue einreihen und dabei `this.storeQueue` neu zuweisen. Ein bloßes `.then` auf dem aktuellen Ende reicht nicht, weil ein nachfolgender Mutator sonst parallel startet.

**Zwei Hinweise unterhalb P2:**
- Jeder vorübergehende Lesefehler in `assertStoreCurrent` (`:300`, z. B. EBUSY/EPERM unter Windows) wird dauerhaft als `read-error` mit dem Rat „repariere die Datei“ gemeldet.
- Falls eine veröffentlichte Version am selben Pfad einen Store mit anderer Versionsnummer schrieb, führt das jetzt zur Sperre statt wie bisher zum stillen Ersetzen. Das sollte Root gegen v0.1.1 abgleichen; ich habe es nicht recherchiert.

## Abnahme je behobenem Befund

- **Grenzen beim Laden (v2/v3):** abgenommen, mit Ausnahme des P1. Options-Remote, URL als Remote-Name und unsichere Atlassian-URLs werden verworfen. Alle übrigen Felder sind deckungsgleich mit `configureGit`/`configureAtlassian`, auch nach Deinstallation, daher sehe ich dort keine weitere Selbstsperre.
- **Kein Überschreiben defekter oder künftiger Stores (#161):** abgenommen. Die `.unreadable`-Kopie entfällt, ENOENT und Lesefehler sind getrennt, `activeProfileId` wird strikt geprüft, die Sperre greift vor Git-Seiteneffekten. `selectProfile`/`deleteProfile` werfen vor `adoptActiveProfile`, es entsteht also keine Divergenz im Speicher.
- **Legacy-Meldung (#168):** abgenommen. `legacyIssue` wird erst nach der Generationsprüfung gesetzt, bei Projekt- und Profilwechsel gelöscht und blockiert nicht. Die automatische Übernahme gültiger Dateien bleibt gemäß Entscheidung unverändert und ist nicht erneut bewertet.
- **Optimistischer Abgleich (#181) in `mutateStore`:** abgenommen. Geprüft wird vor der Mutation und vor dem Rename, die Revision wird erst nach erfolgreichem Rename fortgeschrieben, die Temp-Datei wird in allen Pfaden entfernt. Das Rest-Rennen zwischen Check und Rename ist als dokumentierte Grenze akzeptiert.
- **Tests zu #181 und Rename-Fehler:** logisch schlüssig. Der Rename-Fehler tritt jetzt wirklich nach erfolgreichem Laden auf, Temp-Cleanup und fehlende Zieldatei werden geprüft. Der P2-Fall ist nicht abgedeckt.
- **Englische Meldung:** abgenommen. Alle fünf Gründe und vier Wiederherstellungstexte stimmen zeichengenau mit den Schlüsseln in `en.ts` überein. Ende-zu-Ende getestet ist nur die Kombination `unsupported-version`.
- **Renderer-Test:** in sich plausibel (letzter Aufruf `getSettings(null)`, leerer `projectFolder`). Der Fix selbst liegt nicht im Diff und ist daher nicht abgenommen.
