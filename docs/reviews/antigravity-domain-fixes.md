# Antigravity Domain-Reparaturbericht — Issues #18, #19, #20, #21

## Lauf- und Werkzeugmetadaten

- **Verantwortlicher Agent:** Google Antigravity (`logic`, `interface`)
- **Modell / Modus:** Gemini 4 Argon (High)
- **Zugeordnete Tickets:** [Issue #9](https://github.com/J-ARTS/de.sketchdraw.io/issues/9), [Issue #15](https://github.com/J-ARTS/de.sketchdraw.io/issues/15), Folgebugs `#18`, `#19`, `#20`, `#21` gemäß `docs/reviews/codex-domain-findings.md`
- **Werkzeugeinsatz:** Ausschließlich Dateiwerkzeuge (`view_file`, `replace_file_content`, `write_to_file`) innerhalb des freigegebenen Schreibbereichs (`src/domain/` außer `types.ts`, `tests/unit/domain/`, `docs/reviews/antigravity-domain-fixes.md`). Keine Änderungen an `src/domain/types.ts` oder den unabhängigen Testdateien `tests/unit/domain.spec.ts`, `tests/unit/domain-review.spec.ts` und `tests/unit/geometry-acceptance.spec.ts`.

---

## 1. Behobene Befunde und geprüfte Folgepfade

### #18 — Inverse Rotation für gebundene Endpunkte rotierter Connectoren
- **Ursache:** `syncConnectorEndpoints` (`src/domain/geometry.ts`) und der Abkopplungspfad in `delete` (`src/domain/commands.ts`) rechneten den Welt-Ankerpunkt (`resolveAnchorWorldPoint(target, anchor)`) lediglich per Translation (`world.x - connector.x`, `world.y - connector.y`) in lokale Connector-Koordinaten um, ohne die eigene Rotation des Connectors um sein Bounding-Box-Zentrum `(connector.x + connector.width / 2, connector.y + connector.height / 2)` zu invertieren.
- **Lösung & Folgepfade:**
  - In `src/domain/geometry.ts` wurde die browserreine Funktion `worldToElementLocalPoint(element, world)` ergänzt, die bei `rotation !== 0` die Uhrzeigersinn-Rotation des Connectors um sein Box-Zentrum `(x + width / 2, y + height / 2)` exakt invertiert (`R(-theta)`) und Kardinalwinkel (`0°`, `90°`, `180°`, `270°`) verlustfrei behandelt, während die Zieltransformation `resolveAnchorWorldPoint(target, anchor)` unverändert bleibt.
  - `syncConnectorEndpoints` (`src/domain/geometry.ts`) nutzt `worldToElementLocalPoint` sowohl für `from` (`points[0]`) als auch für `to` (`points[last]`). Damit greift die inverse Transformation bei `add`, bei direktem `update` (Verschiebung, Größenänderung oder Rotation von Connector oder Ziel) sowie bei impliziter Bewegung durch verschobene Eltern-Container.
  - Der Abkopplungspfad beim direkten oder kaskadierenden Löschen eines Zielelements in `delete` (`src/domain/commands.ts`) nutzt ebenfalls `worldToElementLocalPoint(el, world)`, sodass der sichtbare Welt-Endpunkt nach dem Entfernen von `from`/`to` exakt erhalten bleibt.

### #19 — Wiederherstellung von `ElementKind` nach `replace` im Per-Actor Undo/Redo
- **Ursache:** `SCALAR_ELEMENT_FIELDS` in `src/domain/controller.ts` enthielt `kind` nicht, weil `update`-Patches `kind` nicht verändern dürfen. Da `replace` (oder `delete` + `add` derselben Element-ID in einem `batch`) jedoch `kind` bei gleicher Element-ID valide ändern kann, ignorierte `evaluateTransition` die `kind`-Differenz zwischen `expectedDoc` und `targetDoc`.
- **Lösung & Folgepfade:**
  - `'kind'` wurde in `SCALAR_ELEMENT_FIELDS` (`src/domain/controller.ts`) aufgenommen, ohne valide `replace`-Transaktionen einzuschränken.
  - Unbeteiligte Felder anderer Actoren (z. B. fremde Positions- oder Textänderungen am selben Element) bleiben bei Undo/Redo einer `kind`-Änderung unangetastet; konkurrierende `kind`-Änderungen eines anderen Actors werden als `HISTORY_CONFLICT` erkannt.
  - In `evaluateTransition` wurden die Connector- und Container-Konsistenzprüfungen auf `expEl.kind`, `curEl.kind` und `tgtEl.kind` sowie auf die Eigengeometrie gebundener Connectoren (`hasSameGeometry(nextEl, tgtEl)`) ausgeweitet; ungültige Merkmalskombinationen nach `kind`-Wechsel (z. B. fremde `points`, `rotation !== 0` auf Container oder fremde Kind-Referenzen auf Nicht-Container) werden über die abschließende `validateDocument(candidateDoc)`-Prüfung als `HISTORY_CONFLICT` abgewiesen.

### #20 — Kanonisches JSON-Bytebudget (`MAX_DOCUMENT_JSON_BYTES`) an allen Validierungs- und Commit-Grenzen
- **Ursache:** `validateDocument` prüfte zwar Einzelgrenzen (Elementanzahl, Textlängen, Asset-Bytes), nicht jedoch die UTF-8-Bytegröße der kanonischen JSON-Serialisierung (`32 MiB`). Dadurch konnten `validateDocument`, `applyCommand`, `createController` und `controller.dispatch` Dokumente akzeptieren, die erst beim anschließenden `serializeDocument` mit `DOCUMENT_JSON_TOO_LARGE` scheiterten.
- **Lösung & Folgepfade:**
  - In `src/domain/validation.ts` wurden `canonicalizeValue`, `formatCanonicalDocument` und `validateAndSerializeDocument` als browserreine, eingabeerhaltende Hilfsfunktionen zusammengeführt.
  - `validateDocument` prüft nun für jedes strukturell gültige Dokument die exakte kanonische JSON-Ausgabe (rekursiv sortierte Schlüssel, `-0 -> 0`, 2 Leerzeichen Einrückung, `LF`-Zeilenumbrüche inkl. abschließendem `\n`, JSON-String-Escaping wie `\"`/`\\`/`\uXXXX` und UTF-8-Bytekodierung via `TextEncoder`) gegen `DOMAIN_LIMITS.MAX_DOCUMENT_JSON_BYTES`.
  - `serializeDocument` (`src/domain/serialization.ts`) nutzt `validateAndSerializeDocument(document).serialized` direkt ohne wechselseitige Rekursion (`validation -> serialize -> validation`) und ohne doppelte Serialisierung.
  - Damit greift das Budget vor jeder Zustands-, Revisions- oder History-Mutation bei direktem `validateDocument`, `applyCommand`, `createController`, `controller.dispatch`, `deserializeDocument` sowie bei `controller.undo` / `controller.redo` / `controller.getHistoryState` (über `evaluateTransition`).

### #21 — Sichere Ganzzahl-Revisionen (`Number.isSafeInteger`) und Überlaufschutz für `dispatch`, `undo`, `redo`
- **Ursache:** `createController` und `validateCommandContext` prüften Revisionen mit `Number.isInteger` statt `Number.isSafeInteger`, wodurch `2 ** 53` akzeptiert wurde und `revision + 1 === revision` die CAS-Invariante brach. Zudem fehlte bei `currentRevision === Number.MAX_SAFE_INTEGER` eine Überlaufprüfung vor dem Inkrementieren in `dispatch`, `undo` und `redo`.
- **Lösung & Folgepfade:**
  - `createController` und `validateCommandContext` (`src/domain/controller.ts`) verlangen nun `Number.isSafeInteger(...)` und `>= 0` (mit `-0 -> 0`-Normalisierung) und weisen `2 ** 53` mit `DomainValidationError` (`code: 'INVALID_REVISION'`) ab.
  - Semantische No-Ops in `dispatch` (einschließlich mehrstufiger `batch`-Befehle ohne Nettoänderung) kehren vor der Inkrementprüfung zurück und bleiben bei `Number.MAX_SAFE_INTEGER` uneingeschränkt zulässig.
  - Zustandsverändernde `dispatch`-, `undo`- und `redo`-Aufrufe prüfen `Number.isSafeInteger(currentRevision + 1)` vor jeder Mutation von `currentDoc`, `currentRevision`, `undoStack`/`redoStack` und vor Subscriber-Benachrichtigungen; bei drohendem Überlauf wird `DomainConflictError` (`code: 'REVISION_OVERFLOW'`) geworfen.
  - `getHistoryState(actorId)` berücksichtigt `Number.isSafeInteger(currentRevision + 1)` ebenfalls und meldet an `Number.MAX_SAFE_INTEGER` konsistent `canUndo: false` bzw. `canRedo: false` inklusive Konfliktbegründung.

---

## 2. Geänderte Dateien

- `src/domain/geometry.ts`: `worldToElementLocalPoint` ergänzt und in `syncConnectorEndpoints` eingebunden.
- `src/domain/commands.ts`: `worldToElementLocalPoint` beim Abkoppeln in `delete` verwendet; redundante Zweitvalidierung in `add` ohne angepasste Connectoren vermieden.
- `src/domain/validation.ts`: Kanonische JSON-Serialisierung und UTF-8-Bytebudgetprüfung (`MAX_DOCUMENT_JSON_BYTES`) in `validateAndSerializeDocument` / `validateDocument` integriert.
- `src/domain/serialization.ts`: `serializeDocument` auf `validateAndSerializeDocument` umgestellt (keine Rekursion).
- `src/domain/controller.ts`: `'kind'` in `SCALAR_ELEMENT_FIELDS` ergänzt, Connector-/Container-Übergangsprüfungen geschärft, `Number.isSafeInteger`-Prüfung und `REVISION_OVERFLOW`-Schutz vor State-/History-/Revisionsmutation in `dispatch`, `undo`, `redo` und `getHistoryState` umgesetzt.
- `tests/unit/domain/domain-extended.spec.ts`: Zusätzliche Unit-Tests für `#18`, `#19`, `#20` und `#21` einschließlich Folgepfaden ergänzt.
- `docs/reviews/antigravity-domain-fixes.md`: Dieser Reparaturbericht.

---

## 3. Prüfungen

- **Geprüfter Stand:** Lokale Reparatur von `src/domain/` und `tests/unit/domain/domain-extended.spec.ts` gegen `docs/reviews/codex-domain-findings.md`, `tests/unit/domain.spec.ts`, `tests/unit/domain-review.spec.ts` und `tests/unit/geometry-acceptance.spec.ts`.
- **Statische Code- und Vertragsprüfung:** Alle vier reproduzierten Fehlerszenarien und ihre Folgepfade wurden gegen die unabhängigen Regressionstests und `tsconfig.app.json`-Anforderungen geprüft.
- **CLI-Test- und Typecheck-Ausführung (`npx vitest run tests/unit/domain.spec.ts tests/unit/domain-review.spec.ts tests/unit/geometry-acceptance.spec.ts tests/unit/domain/`, `npm run typecheck:config`):** **nicht ausgeführt** (Grund: Shell-/RunCommand-Werkzeuge sind in diesem Lauf auftragsgemäß untersagt; die Ausführung erfolgt durch Codex).
