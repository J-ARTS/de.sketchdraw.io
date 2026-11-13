# Fable 5.2 / high — unabhängiger Ticketreview

Tatsächliches Tool: Claude Code 2.1.323, lesend. Originalbericht; Codex-Gegenprüfung separat.

# Review Ticketabnahme 13.11.2026: #176, #177, #178, #122

**Kurzfazit:** Keines der vier Tickets ist heute abschlussreif. #177 und #122 hängen nur noch an Nachweisen, #176 hat zwei materielle Restlücken beim Dokumentwechsel, #178 ist nicht begonnen.

**Beweisgrenze:** Alles hier ist reine Quelllektüre des Arbeitsbaums (40 Lese-/Suchschritte), nichts wurde ausgeführt. Befunde sind Hypothesen für Codex. Die Graphify-CLI konnte ich nicht ausführen (kein Shell-Werkzeug); der Report enthielt zu den Symbolen nichts.

Nicht gelesen:
- `src/mcp/guide.ts`, `src/agent-access/errors.ts`, `types.ts`, `renderer-session.ts`
- die Host-Seite der Rotation in `electron/`
- `backend.spec.ts` und `agent-commands.spec.ts`
- die Funktionsrümpfe von `scripts/release.mjs`
- der Abschnitt „Agentenergonomie“ in `docs/contracts-mcp.md`

## Befunde

### F1 – Mittel (#176, Befund 4): Wartender Schreibaufruf kann im neuen Dokument landen
- **Ort:** `src/mcp/tooling.ts:61-70`, `src/mcp/server.ts:37`.
- **Fehlerbild:** `acknowledged` wird erst geprüft, wenn der Aufruf die Warteschlange verlässt, nicht bei seinem Eintreffen. Ein Lesezugriff, der inzwischen auf dem neuen Dokument gelingt, setzt `acknowledged = B`; ein vorher abgeschickter, wartender Schreibaufruf ohne `documentId` passiert danach die Prüfung.
- **Reproduktion (Unit):** Limiter(2) und Requester wie in `server.ts:37` koppeln. Erst auf A lesen, dann `connect` auf B umstellen. Im selben Tick zwei Lesezugriffe und einen Schreibaufruf (`expectedRevision: 0`, ohne `documentId`) absetzen. Erwartet `SESSION_CHANGED`, tatsächlich wird an B gesendet.
- **Reale Bedingung:** Paralleler Stapel mit Schreibaufruf hinter mindestens zwei bis drei Lesezugriffen, und die Revisionen stimmen überein. Das ist beim ersten Schreiben plausibel, weil beide Dokumente bei 0 beginnen. Selten, aber der Mensch kann die Änderung nicht rückgängig machen (Befund 7).
- **Kleinste Korrektur:** `documentId` in `mcpWrite` (`src/agent-access/schema.ts:71`) zur Pflicht machen; `parseMcpOperationInput` liefert dann `DOCUMENT_MISMATCH`. Alternativ `acknowledged` beim Eintreffen vor dem Limiter festhalten.

### F2 – Niedrig bis Mittel (#176): Erster Schreibaufruf nach Adapter-Neustart ist ungeprüft
- **Ort:** `src/mcp/tooling.ts:59-66`; als gewollt getestet in `tests/unit/mcp/tooling.spec.ts:139`.
- **Fehlerbild:** Startet der Client den Adapter mitten im Gespräch neu, ist `acknowledged` leer. Ein Schreibaufruf mit gemerkter Revision und ohne `documentId` geht dann an das gerade offene Dokument.
- **Widerspruch:** `docs/concerns.md:289` sagt „kein stilles Mitnehmen“.
- **Korrektur:** Wie F1 (Pflichtfeld), oder die Zeile als akzeptiertes Restrisiko umformulieren.

### F3 – Mittel (#176, Befund 5): Parallele Neuverbindungen reißen sich gegenseitig ab
- **Ort:** `src/mcp/server.ts:20-24`, `src/mcp/client.ts:40`.
- **Fehlerbild:** Nach einer Rotation scheitern zwei aktive Aufrufe und rufen beide `getClient(true)`. Der zweite schließt die Verbindung, die der erste gerade aufgebaut hat.
- **Folge:** Ein Lesezugriff endet mit `ACCESS_REVOKED`, obwohl die App läuft; `SKILL.md:69` lässt den Agenten dann den Nutzer fragen. Trifft es einen Schreibaufruf (gleiches Dokument nach App-Neustart), kommt `OUTCOME_UNKNOWN`, obwohl der Frame schon gesendet sein kann.
- **Wiederholung nicht dedupliziert:** Das Journal hängt am Grant (`src/agent-access/renderer-handler.ts:43`). Die Wiederholung mit gleicher `commandId` wird also neu ausgeführt; nur `expectedRevision` schützt.
- **Reproduktion:** Gebaute App, einmal lesen, Dokument wechseln, zwei oder mehr Lesetools parallel aufrufen. Erwartbar scheitert genau einer.
- **Kleinste Korrektur:** Nur neu verbinden, wenn die zwischengespeicherte Verbindung noch die fehlgeschlagene ist.
- **Kopplung:** Dieser Abriss verdeckt F1 heute bei kleinen Stapeln. F3 allein zu beheben macht F1 leichter auslösbar, also beide zusammen korrigieren.

### F4 – Niedrig bis Mittel (#176, Kriterium 4): Skill-Auslieferung nur an der Konfiguration geprüft
- **Ort:** `tests/unit/release.test.mjs:191-192` prüft nur `electron-builder.json`. `scripts/release-installer-smoke.mjs:137-141` prüft `app.asar` und `dist-mcp`, aber nicht `resources/skills/sketchdraw-desktop/SKILL.md`.
- **Lücke:** `docs/concerns.md:294` verlangt die Prüfung am tatsächlich erzeugten Paket.
- **Kleinste Korrektur:** Existenz und Hash-Gleichheit in `smokeInstalledApp` ergänzen, oder einmalig ein `--dir`-Paket auflisten und im Ticket belegen.
- **Korrekt dokumentiert:** v0.1.3 enthält den Skill nicht (`docs/agent-integration.md:66`).

### F5 – Niedrig (#176): Nicht-fachliche Ablehnungen erscheinen als `VALIDATION_FAILED`
- **Ort:** `src/agent-access/renderer-handler.ts:146-151`.
- **Fehlerbild:** `TRANSITION_PENDING`, `SEQUENCE_GAP` und `HISTORY_*` werden zu `VALIDATION_FAILED`. Der zweite Durchlauf findet nichts, der Agent liest „command is wrong“ (`SKILL.md:64`) und die `commandId` ist verbraucht. Das betrifft gerade Schreibversuche während eines Dokumentwechsel-Dialogs.
- **Korrektur:** `TRANSITION_PENDING` auf `BUSY` abbilden, oder bei leeren `issues` den Originalcode nennen.
- **Validierungsnebenwirkung:** Der zweite Durchlauf (`src/agent-access/agent-commands.ts:125-131`) liegt hinter `check()` und committet nicht, soweit `applyCommand` rein ist. Das hat Codex per Test zu belegen.

### F6 – Niedrig (#176): Vorprüfung arbeitet auf dem aktuellen statt dem erwarteten Stand
- **Ort:** `src/agent-access/renderer-handler.ts:136-143`, `src/agent-access/agent-commands.ts:117-118`.
- **Fehlerbild:** Bei veralteter Revision kann `UNKNOWN_CONNECTOR_TARGET` statt `REVISION_CONFLICT` kommen.
- **Zweiter Fall:** Im `batch` aus Verschieben und neuer Verbindung wird die Route aus der alten Position berechnet. Ob die Domain nachführt, habe ich nicht geprüft.

### F7 – Niedrig (#176): Limiter kann kurz drei Aufrufe zulassen
- **Ort:** `src/mcp/tooling.ts:35-41`.
- **Fehlerbild:** `release` zählt herunter und weckt dann einen Wartenden. Ein Aufruf dazwischen nimmt den Platz, und `src/mcp/client.ts:59` antwortet mit `BUSY`. Theoretisch, nicht nachgestellt.
- **Korrektur:** Den Platz ohne Herunterzählen an den Wartenden übergeben.

### F8 – Niedrig (#176, Befund 1 gegen 8): Leseergebnisse stehen doppelt in der Antwort
- **Ort:** `src/mcp/tooling.ts:13-16`.
- **Fehlerbild:** Clients, die Text und `structuredContent` weiterreichen, zahlen den doppelten Kontext.
- **Korrektur:** In der Zeile MCP-176-08 von `docs/concerns.md` ergänzen.

### F9 – Niedrig (#177): Katalog-Fallback rät die erste Seite
- **Ort:** `src/catalog/index.ts:1171`; die Domain verweigert bei mehreren Seiten das Raten (`src/domain/commands.ts:198-212`).
- **Einordnung:** Ohne Wirkung heute, weil der einzige Aufrufer die aktive Seite übergibt (`src/renderer/state/whiteboard.ts:2091`). Das Ticket hat den Fallback ausdrücklich verlangt.
- **Korrektur:** Im Vertrag als bewusste Abweichung vermerken; kein Blocker.

## Abschlussbewertung

### #176 – nicht abschlussreif
- **Erfüllt im Arbeitsbaum, aber uncommittet:** Kriterium 1 (Entscheidungen MCP-176-01 bis -09, `docs/concerns.md:280-294`) und Kriterium 4 (`extraResources`, Doku, Konfigurationstest).
- **Befund 4:** Der Normalfall ist behoben. F1 und F2 widersprechen aber dem Wortlaut der Entscheidung MCP-176-04. Entweder beheben (ich empfehle das Pflichtfeld `documentId` zusammen mit F3) oder ausdrücklich als Restrisiko eintragen.
- **Vor Abschluss nötig:** Commit, CI auf diesem Stand, Paketnachweis für den Skill (F4).
- **Reichweite der CI:** Lauf 43388981883 deckt `8df3006` ab, nicht die lokalen Änderungen.

### #177 – Fix nach Lektüre korrekt, Nachweise fehlen
- **Fix:** `state.activePageId` wird synchron mit `state.document` übergeben. `onActivePage` bleibt wirkungsgleich, der Batch ergibt einen Commit und einen Undo-Schritt.
- **Tests:** `tests/unit/renderer/whiteboard.spec.ts:47-66` und `tests/unit/catalog/catalog.test.ts:197-224` treffen den Fehlerfall.
- **Testlücken (nicht blockierend):** Revision genau +1 und keine Fehlermeldung werden nicht geprüft; Drop in einen Container auf Seite 2 fehlt.
- **Offen:** Ob `pageId` in den erlaubten Request-Schlüsseln steht, entscheidet der Testlauf (die Definition habe ich nicht gefunden).
- **Geprüft:** Vorschau-Pfade nutzen nur `delete`/`update` und sind nicht betroffen.
- **Vor Abschluss nötig:** Testlauf durch Codex, Commit auf `main`, CI, Live-Abnahme in neu gestarteter Electron-Instanz, Kriterium 5 in GitHub.

### #178 – offen, kein Nachweis
- **Stand:** Keine Kommentare, alle fünf Kriterien offen. Dieser Review ersetzt nichts davon.
- **Voraussetzung:** #177 muss committet sein und die Instanz neu gebaut laufen.
- **Risiko beim Veröffentlichen:** Der Arbeitsbaum enthält fremde uncommittete Änderungen (Relay, Plugin-Service, ProfileDialog). Selektiv committen und HEAD vorher und nachher festhalten.
- **Nachweise:** Jira-Key, `pageId` der eingefügten Komponente in der gespeicherten Datei, Undo live, keine Tokens in Protokollen oder Screenshots.

### #122 – abschließbar, sobald Codex' Asset-Prüfung vorliegt
- **Workflow:** Der Aufbau ist schlüssig. Alle Jobs bauen `commit_sha` aus dem Preflight (`.github/workflows/release.yml:94,203`), Schreibrecht hat nur der Publish-Job, und es wird auf genau drei Assets und hochgeladene Bytes geprüft.
- **Evidenz verfällt:** Smoke-JSON und Manifeste sind nur Actions-Artefakte mit sieben Tagen Aufbewahrung (`release.yml:170-186`). Hashes und Smoke-Ergebnis jetzt dauerhaft im Issue oder Repo ablegen.
- **Unabhängigkeit:** Der Vergleich öffentliches Asset gegen Manifest desselben Laufs belegt Upload-Integrität. Format und Architektur mit fremden Werkzeugen prüfen (`file`, `lipo`, `dpkg-deb`).
- **Signierung:** Status dokumentieren (`electron-builder.json:55`, Signierung optional).
- **Revisionen trennen:** Der Lauf 43282773347 belegt Skript und Workflow auf `c45e892`. Spätere `main`-Änderungen, etwa der Listing-Lag-Zweig in `scripts/release.mjs:1462-1469` und der Skill, sind nur durch Unit-Tests belegt. Den Unterschied mit `git log c45e892..main -- scripts/release.mjs .github/workflows/release.yml` klären.
- **Ticketkörper veraltet:** Er nennt `e3b91bc` und Lauf 39165632342; die Häkchen bei Kriterium 2 und 4 beziehen sich auf eine andere Revision. Vor dem Schließen aktualisieren, dazu Kriterium 1 (#126/#127) und Ledger/Graphify.
- **Aufräumen:** Den temporären Branch `codex/ci-retry-c45e892` und den reservierten Tag `v0.1.2` im Abschluss erwähnen.
