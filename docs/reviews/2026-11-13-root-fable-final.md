# Fable 5.2 / high — abschließender MCP-Quellreview

Fortsetzung nach dokumentiertem Tool-Turnlimit; tatsächliches Ergebnis `is_error=false`. Originalbericht, Gegenprüfung/Tests durch Codex separat.

# Abschlussreview F1–F7 (#176)

**Urteil:** Nach Quellprüfung abgenommen, keine verbliebenen Blocker. Zwei niedrige Restpunkte und eine Benennungskorrektur unten. Tests und Integration bleiben separat nötig; ich habe nichts ausgeführt, „48 MCP-Tests grün, Typecheck grün“ ist eure Angabe.

## Status der Befunde

| Befund | Stand | Beleg |
|---|---|---|
| F1/F2 `documentId` Pflicht | behoben | `schema.ts:71` gilt für beide Schreibtools. Ein wartender Schreibaufruf mit altem Dokument endet in `DOCUMENT_MISMATCH` (`schema.ts:102`) oder `SESSION_CHANGED` (`tooling.ts:70`), bevor gesendet wird. Tests: `tooling.spec.ts:46,68`, `backend.spec.ts:199`. |
| F3 konkurrierende Reconnects | Hauptfall behoben | `server.ts:25` schließt nur, wenn die zwischengespeicherte Verbindung noch die fehlgeschlagene ist. Restfall R1. |
| F5 `BUSY` bei Transition | behoben | `renderer-handler.ts:147,151`, Test `mcp-review-boundaries.spec.ts:45`. |
| F6 Revision vor Vervollständigung | behoben | Prüfung in `renderer-handler.ts:127` liegt vor `prepareAgentCommand` (`:137`) und vor `parseDiagram`. Test `mcp-review-boundaries.spec.ts:57`. |
| F6 Zweitfall Move+Add | Endpunkte behoben | `commands.ts:236-248`, Test `agent-commands.spec.ts:88`. Restfall R2. |
| F7 Limiter | behoben | `tooling.ts:35-38` übergibt den Platz ohne Herunterzählen; `BUSY` wird vor der Slotnahme geworfen. |
| F4 Skill im Paket | nicht geprüft | Außerhalb der gelesenen Dateien. |

## Verbliebene Punkte

**R1 – Niedrig: `getClient` schließt eine fremde frische Verbindung, wenn schon der Erstaufbau scheiterte**
- **Ort:** `src/mcp/server.ts:25`, Bedingung `!failed ||`; `failed` bleibt leer, wenn `connect` selbst wirft (`tooling.ts:68-69`).
- **Trigger:** Zwei parallele Aufrufe ohne zwischengespeicherte Verbindung, deren Erstaufbau mit `ACCESS_DENIED` scheitert, während der Aufbau über die Runtime-Datei gelingt. Das trifft einen Adapter mit veraltetem Grant in den Umgebungsvariablen (`client.ts:26`) nach einer Rotation.
- **Auswirkung:** Der zweite Aufruf schließt die Ersatzverbindung des ersten. Der erste endet mit `ACCESS_REVOKED`, ein Schreibaufruf mit `OUTCOME_UNKNOWN`, obwohl die App läuft.
- **Korrektur:** `(!failed || client === failed)` durch `failed !== undefined && client === failed` ersetzen. Ein abgelehnter Erstaufbau räumt sich über `server.ts:33` selbst ab.
- **Einordnung:** Aus der Lektüre abgeleitet, nicht nachgestellt. `backend.spec.ts:199` deckt nur den Fall mit bestehender Verbindung ab.

**R2 – Niedrig, kosmetisch: Ankerwahl im Batch aus der alten Position**
- **Ort:** `src/agent-access/agent-commands.ts:98-99,117-118`; `known` wird durch `update` im selben Batch nicht fortgeschrieben.
- **Trigger:** Batch aus Verschieben über das Ziel hinweg (links nach rechts) und schlanker Verbindung ohne Anker.
- **Auswirkung:** Die Endpunkte sitzen korrekt am Element, aber auf den abgewandten Seiten; die Route läuft außen herum. Das Dokument bleibt gültig und editierbar.
- **Korrektur:** In `completeCommand` numerische `x/y/width/height/rotation`-Patches eines `update` auf `known` anwenden. Alternativ als bekannte Grenze in `docs/concerns.md` vermerken.

**R3 – Nachweistext:** Ein Symbol `canonicalizeConnector` habe ich in `src/` nicht gefunden. Wirksam ist `syncConnectorEndpoints` (`src/domain/geometry.ts:94`, Aufruf `commands.ts:240`). Im Ticket und in `concerns.md` so benennen.

**Testschärfe (kein Blocker):** `backend.spec.ts:216` prüft bei `stale` und `unbound` nur `isError`; die erwarteten Codes zu prüfen wäre genauer.

## Beweisgrenzen

- **Nicht ausgeführt:** Tests, Typecheck, Build und die Graphify-CLI (kein Shell-Werkzeug).
- **Nicht gesehen:** die nachträgliche Änderung der `BUSY`-Meldung bei fehlender `nextRequestId`. Mein Lesestand von `renderer-handler.ts:143` enthielt noch den alten Text.
- **Nur in Auszügen gelesen:**
  - `agent-commands.ts`, `commands.ts` (232-248), `guide.ts`, `SKILL.md`
  - `backend.spec.ts` (ab Zeile 138), `agent-commands.spec.ts` (bis 104), `mcp-review-boundaries.spec.ts` (bis 75)
- **Nicht gelesen:** `errors.ts`, `types.ts`, Session, Gateway und `lifecycleGate`, die Host-Seite in `electron/`, das Release-Audit-JSON.
- **Nicht erneut geprüft:** F8, F9, #177, #178, #122.
