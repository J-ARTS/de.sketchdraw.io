# Finaler begrenzter Fable-Nachreview: Plugins — 13.11.2026

Unveränderter Originalbericht, tatsächliches Modell `claude-fable-5-2`, `high`, Read-only, nur gezielte aktuelle Quelltextauszüge. Die bedingte P2-Frage wird im Auditbericht anhand von `adoptActiveProfile` aufgelöst.

---

**Ergebnis: Beide gemeldeten Regressionen sind behoben; ein bedingtes P2 bleibt in Korrektur 2 offen, weil der Auszug die Profilprüfung nicht belegt.** Kein eigener Testlauf, nur die eine Datei gelesen (graphify trotz Hook-Hinweis auftragsgemäß nicht ausgeführt).

**1. `credentialRemoteUrl`: behoben, kein P1/P2.**
- `plugin-service.ts:142` prüft den historischen Wert nur noch als begrenzten Text.
- `:553` normalisiert die automatisch erkannte URL im `try`; eine unsichere Bindung entfällt.
- `:138–139` und `:535–536` bleiben strikt.
- Der Test `:517–538` deckt echte `user@host`-Remote, Neustart und historische Datei ab.

**2. Preflight in der Queue: behoben.**
- `:530–532` reiht den Preflight ein und schreibt die Queue fort.
- Der Gate-Test `:493–515` unterscheidet sauber: Ohne Fix läse der Preflight die alten Bytes und würde sperren.

**Bedingtes P2 (Profilwechsel):**
- `profileId` wird in `:527` erfasst, aber vor `:559` nie verglichen; `:533` und `:554` prüfen nur `projectGeneration`.
- Nach den Awaits lesen `:537–540` und `:557` `this.config`.
- Erhöht ein Profilwechsel `projectGeneration` nicht, landen Token und `credentialRemoteUrl` oder der Atlassian-Block des neu aktiven Profils unter der alten `profileId`.
- Die getrennte Doppelprüfung in `:559` spricht dafür, dass beide Werte unabhängig sind; `assertGeneration` und `activateProfile` sind im Auszug nicht enthalten.
- Abhilfe: nach `:533` und `:554` bei `profileId !== this.activeProfileId` abbrechen, oder die Konfiguration aus dem Profil per ID bilden.
- Deckt `assertGeneration` Profilwechsel bereits ab, bleibt hier kein P1/P2.

**3. Renderer `runProfileChange` (`whiteboard.ts:143–146`): kein offensichtlicher Fehler, kein P1/P2.**
- P3: Der veraltete Fehlerpfad in `:153` lädt die Einstellungen nicht neu.
