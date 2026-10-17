# Antigravity Domain-Implementierungsbericht — Issue #9 (S1 v2)

## Lauf- und Werkzeugmetadaten

- **Verantwortlicher Agent:** Google Antigravity (`logic`, `interface`)
- **Modell / Modus:** Gemini 4 Argon (High)
- **Zugeordnetes Ticket:** [Issue #9](https://github.com/J-ARTS/de.sketchdraw.io/issues/9) (Vertragsgrundlage: [Issue #6](https://github.com/J-ARTS/de.sketchdraw.io/issues/6), `docs/contracts.md` S1 v2, `docs/decisions/0001-shared-document-contract.md`, Testspezifikation [Issue #15](https://github.com/J-ARTS/de.sketchdraw.io/issues/15))
- **Werkzeugeinsatz:** Ausschließlich Dateiwerkzeuge (`view_file`, `write_to_file`, `replace_file_content`) innerhalb des freigegebenen Schreibbereichs (`src/domain/` außer `types.ts`, `tests/unit/domain/`, `docs/reviews/antigravity-domain.md`).

---

## 1. Umgesetzte Dateien und Modulstruktur

| Datei | Zweck und Vertragsabdeckung |
| --- | --- |
| `src/domain/index.ts` | Stabiler öffentlicher Einstiegspunkt gemäß `docs/contracts.md`: Re-Export von `./types` sowie Export von `DOMAIN_LIMITS`, `DomainValidationError`, `DomainConflictError`, `createDocument`, `createElement`, `validateDocument`, `applyCommand`, `serializeDocument`, `deserializeDocument` und `createController`. |
| `src/domain/limits.ts` | Unveränderliche (`Object.freeze`) Definition von `DOMAIN_LIMITS` mit expliziter Typisierung (`DomainLimits` inkl. Index-Signatur `readonly [key: string]: number` für Kompatibilität mit `noUncheckedIndexedAccess: true` und `Readonly<Record<string, number>>`). |
| `src/domain/errors.ts` | Strukturierte Fehlerklassen `DomainValidationError` (`readonly issues: ValidationIssue[]`) und `DomainConflictError` (`readonly code: string; readonly currentRevision?: number`). |
| `src/domain/geometry.ts` | Browserkompatible Geometrie-, Transformations-, Klon- und Gleichheitsfunktionen: `-0`-Normalisierung (`normalizeZero`), Berechnung transformierter Ankerpunkte im Uhrzeigersinn um die Elementmitte (`resolveAnchorWorldPoint` mit exakten Kardinalwinkeln für 0°/90°/180°/270°), Synchronisation gebundener Connector-Endpunkte (`syncConnectorEndpoints`), rekursive Container-Nachfahren (`collectDescendantIds`) sowie tiefe Klon- und Vergleichsfunktionen (`areDocumentsEqual`, `areElementsEqual`, `cloneDocument`). |
| `src/domain/validation.ts` | Vollständige Laufzeitvalidierung (`validateDocument`, `validateElementIntrinsic`, `validateAsset`, `validateDocumentationUrl`) gegen untrusted Eingaben: Abwehr von Prototype-Pollution (`__proto__`, `constructor`, `prototype`), unbekannten Feldern, `undefined`-Werten, zyklischen Objektgraphen, ungültigen IDs, Dimensions-/Koordinatengrenzen, Containerzyklen/Tiefenüberschreitungen (`MAX_CONTAINER_DEPTH = 32`), ungültigen URLs (ausschließlich absolute `http:`/`https:`-URLs ohne eingebettete Zugangsdaten) sowie Prüfung von Base64-Assets inklusive decodierter Bytegröße (`MAX_ASSET_BYTES`, `MAX_TOTAL_ASSET_BYTES`) und binärer Magic-Bytes für PNG (`89 50 4E 47 0D 0A 1A 0A`), JPEG (`FF D8 FF`) und WebP (`RIFF....WEBP`). |
| `src/domain/serialization.ts` | Deterministische JSON-Serialisierung (`serializeDocument`: rekursiv lexikographisch sortierte Objektschlüssel, erhaltene Arrayreihenfolge, `-0 -> 0`, 2 Leerzeichen Einrückung, `LF` und abschließendes `\n`) sowie größen- und schemageprüfte Deserialisierung (`deserializeDocument` mit UTF-8-Byteprüfung gegen `MAX_DOCUMENT_JSON_BYTES = 32 MiB` via `TextEncoder`). |
| `src/domain/factories.ts` | Browserkompatible Factories `createDocument` und `createElement` für alle neun `ElementKind`-Varianten mit positiven Standarddimensionen (insbesondere direkt auswählbare Text-Standardgeometrie), `fontFamily: 'sans'` und Validierung aller `overrides`. |
| `src/domain/commands.ts` | Unveränderliche (`immutable`) Ausführung aller `DocumentCommand`-Varianten (`add`, `update`, `delete`, `reorder`, `rename`, `set-component-sets`, `set-metadata`, `batch`, `replace`) inklusive `null`-Feldlöschung, feldweiser `style`- und `metadata`-Zusammenführung, einmaliger Verschiebung von Container-Nachfahren in absoluten Koordinaten, Erhalt sichtbarer Connector-Endpunkte beim Abkoppeln/Löschen, Ablehnung abweichender Dokument-IDs bei `replace` sowie atomarer Batch-Ausführung (`MAX_BATCH_COMMANDS = 1000`, `MAX_BATCH_DEPTH = 4`). |
| `src/domain/controller.ts` | Revisionsgeführter `DocumentController` (`createController`): abgekoppelte Snapshots, CAS-Prüfung (`expectedRevision`, `REVISION_CONFLICT` mit `currentRevision`), Ignorieren semantischer No-Ops ohne Revisions-/History-/Subscriber-Seiteneffekt, fehlertolerante Subscriber-Benachrichtigung nach Commit sowie konfliktgeschütztes Undo/Redo pro `actorId` auf Feld-, Referenz- und Z-Ordnungsebene (`HISTORY_CONFLICT` / `HISTORY_EMPTY`). |
| `tests/unit/domain/domain-extended.spec.ts` | Ergänzende anforderungsorientierte Unit-Tests für `createDocument`/`createElement` (alle 9 Elementarten), `replace` mit abweichender Dokument-ID, JPEG-/WebP-Magic-Byte-Prüfung, `reorder`-Permutationen und Undo-Konflikte sowie Abhängigkeits- und Subscriber-Isolation im Controller. |

---

## 2. Abgleich mit den verbindlichen S1-v2-Entscheidungen

1. **Keine Node-Abhängigkeiten in `src/domain/`:**
   Die gesamte Domäne nutzt ausschließlich standardisierte ECMAScript- und Web-APIs (`TextEncoder`, `Uint8Array`, `URL`, `crypto.randomUUID` mit deterministischem Fallback) und ist vollständig kompatibel mit `tsconfig.app.json` (`strict: true`, `noUncheckedIndexedAccess: true`, `verbatimModuleSyntax: true`, `"types": []`).
2. **Patch-Semantik und Null-Löschung (AG-01):**
   `null` entfernt optionale Elementfelder bzw. einzelne Metadatenschlüssel (`metadata: null` entfernt das gesamte Feld). `undefined` wird in Dokumenten, Patches und Metadaten als nicht-JSON-fähiger Wert mit `DomainValidationError` abgewiesen. `points: null` auf Connectoren sowie Änderungen an `id`/`kind` oder doppelte IDs innerhalb eines `update`/`delete` werden abgewiesen.
3. **Container-Weltkoordinaten und Connector-Tracking (AG-02):**
   Verschiebungen eines Containers (`dx`, `dy`) verschieben dessen transitive Nachfahren genau einmal um dasselbe Delta, sofern das Kind im selben `update` keine eigene explizite Positionsänderung besitzt. Größenänderungen verändern ausschließlich die Containergrenze; Reparenting verändert keine Geometrie. Gebundene Connector-Endpunkte (`from`/`to`) werden bei Zielbewegung, Zielrotation und vor kaskadierendem Löschen mit derselben Uhrzeigersinn-Transformation aufgelöst.
4. **Konfliktgeschütztes Per-Actor Undo/Redo (AG-05):**
   `src/domain/controller.ts` wertet für jeden Undo-/Redo-Schritt (`evaluateTransition`) feldgenau aus, ob die vom Actor geänderten Eigenschaften, Container-Elternbeziehungen, Connector-Bindungen und Z-Ordnungs-Nachbarschaften im aktuellen Dokument noch dem erwarteten Zustand entsprechen. Unbeteiligte Elemente und Felder anderer Actoren bleiben unangetastet. Bei konkurrierenden Änderungen am selben Feld, neuen Abhängigkeiten (z. B. fremdes Kind in einem hinzugefügten Container) oder nicht rekonstruierbarer Stapelreihenfolge wird die Operation ohne Seiteneffekt mit `DomainConflictError` (`code: 'HISTORY_CONFLICT'`) abgewiesen und in `getHistoryState(actorId)` über `undoConflict`/`redoConflict` ausgewiesen.

---

## 3. Bedenken und Hinweise für Folgesprints

Es bestehen **keine blockierenden Einwände** gegen den verbindlichen Vertrag S1 v2; alle Anforderungen aus `docs/contracts.md` ließen sich widerspruchsfrei umsetzen. Zwei nicht-blockierende Punkte für S2+ zur Kenntnisnahme durch Codex:

1. **Begrenzung der History-Tiefe pro Actor (S2+):**
   Für S1 hält der Controller die Undo-/Redo-Einträge pro `actorId` im Speicher (wobei `dataUrl`-Strings von Assets als unveränderliche JS-Strings keinen doppelten Speicher belegen). Für sehr lange Sitzungen mit vielen groben Geometrie-Transaktionen kann in S2 ein optionales Limit (z. B. `MAX_HISTORY_ENTRIES_PER_ACTOR`) ergänzt werden.
2. **Explizite Asset-Kompaktierung (AG-09 / S2+):**
   Wie in `docs/contracts.md` festgelegt, behält `delete` verwaiste Assets bewusst im Dokument. Sobald in einem späteren Sprint ein expliziter Kompaktierungsbefehl ergänzt wird, sollte dieser mit den aktiven Undo-/Redo-Stacks des Controllers abgeglichen werden, damit kein Undo eines gelöschten `image`-Elements an einer fehlenden `assetId`-Referenz scheitert.

---

## 4. Prüfungen und offene Prüflücken

- **Geprüfter Stand:** Implementierung von `src/domain/*.ts` und `tests/unit/domain/domain-extended.spec.ts` gegen `src/domain/types.ts` und `tests/unit/domain.spec.ts`.
- **Statische Vertrags- und Typprüfung durch Code-Inspektion:** Alle Exporte, Methodensignaturen, Fehlertypen und Grenzwerte wurden Zeile für Zeile gegen `docs/contracts.md`, `tsconfig.app.json` und `tests/unit/domain.spec.ts` abgeglichen.
- **Ausführung von CLI-Prüfungen (`npm run typecheck:config`, `npm run test:unit`):** **nicht ausgeführt** (Grund: Shell-/Prozesswerkzeuge waren in diesem Lauf gemäß Vorgabe gesperrt; die Ausführung der Test- und Typecheck-Befehle erfolgt durch Codex).
