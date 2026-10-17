# Unabhängiger Domain-Review — Reparaturauftrag

Issues #9/#15, Folgebugs #18–#21. Lokale Basis17.10.2026; Node22.16/Vitest5.0.5. Antigravity-Domain-Erstlauf abgeschlossen. Keine Src-Änderungen durch Reviewer.

- 18 ursprüngliche Abnahmetests bestanden; Konfigurations-/Test-Typecheck bestand.
- #18: Eigene Connectorrotation fehlt in Welt→Lokal-Ankerumrechnung. `tests/unit/geometry-acceptance.spec.ts` fehlgeschlagen. Endpunkt muss bei eigener Rotation, Bewegung und Abkopplung auf sichtbarem Welt-Anker bleiben.
- #19: replace kann kind ändern, History ignoriert kind. Undo meldet Erfolg ohne Wiederherstellung.
- #20: Validierung/Commit erlaubt JSON oberhalb32MiB; erst Serialisierung scheitert. Größenbudget muss vor erfolgreichem Commit gelten, auch für Controllerstart/Undo/Redo und direkte applyCommand/validateDocument-Einstiege. Kanonische Ausgabe mit Einrückung/JSON-Escaping berücksichtigen; keine Rekursionsschleife validation→serialize→validation.
- #21: Revision2**53 und Inkremente überMAX_SAFE_INTEGER brechen CAS. Sichere nichtnegative Ganzzahl und Überlaufschutz vor Mutation/Historyänderung erforderlich; semantische NoOps erhöhen nicht und bleiben am Limit erlaubt.

`tests/unit/domain-review.spec.ts` enthielt drei reproduzierte Fehlschläge; Root ergänzte MAX_SAFE_INTEGER-Commit/Undo/Redo-Regressionsfall. Diese unabhängigen Tests nicht abschwächen. Geprüfte Ersthashes im GitHub-Review, Reparatur erhält eigenen Stand.

Prüfbefehle nach Reparatur: `npx vitest run tests/unit/domain.spec.ts tests/unit/domain-review.spec.ts tests/unit/geometry-acceptance.spec.ts tests/unit/domain/`; `npm run typecheck:config`. Shell führt Codex aus.
