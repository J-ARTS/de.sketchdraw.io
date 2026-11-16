# Abschlussklärung zum Review #210 / #217 / #218 (nur lesend)

Alle geänderten Hunks in den 33 Integrations- und 22 Original-Einträgen sind jetzt gelesen; kein Hunk ist ungelesen oder nur abgeschnitten gesehen. Drei Aussagen meiner früheren Berichte waren überzogen und sind unten korrigiert. In diesem Lauf habe ich nichts editiert und keine Tests oder Builds ausgeführt.

**Identität:** Modell laut Systemkontext `claude-fable-5-2` (Claude Agent SDK), dieselbe Sitzung. CLI-Version und Effort-Stufe sind für mich nicht einsehbar.

## Korrekturen an meinen früheren Aussagen
- **`PluginSettings.vue`:** Die Angabe „vollständig gelesen“ war falsch. Belegt waren die Zeilen 1–325 und der Diff. Die Zeilen 325–366 habe ich jetzt nachgelesen; die Datei ist damit ganz gelesen. Neuer Befund daraus: keiner.
- **`src/crdt/persistence.ts`:** War nur als Diff geprüft, nicht ganz gelesen. Jetzt habe ich die Zeilen 1–217 gelesen. Neuer Befund: keiner; B3 bleibt wie beschrieben.
- **Übersetzungsvergleich:** Die Aussage „alle 64 Einträge verifiziert“ war nicht gedeckt. Die Bash-Vergleiche waren abgelehnt, und ich hatte nur sieben Suchtreffer auf Satzenden.
- **„16 hash-identische Einträge“:** Das galt nur zum Zeitpunkt des ersten Manifests und ist nicht der aktuelle Stand.

## Übersetzungen
- **Roots Nachweis:** Der AST-Vergleich in `original-translations-comparison.json` meldet 64 von 64 identisch. Das ist Roots Maschinenvergleich, nicht meiner.
- **Meine Lektüre:**
  - Ich habe alle 64 Einträge dieser JSON-Datei gelesen (Schlüssel, Original, Integration).
  - Von `original-translations-readable.txt` habe ich die ersten fünf Einträge gelesen und die Zahl 64 bestätigt.
  - Zusätzlich habe ich `src/renderer/i18n/en.ts` Zeile 285 und 818–884 ungekürzt direkt gelesen. Das sind die 64 Einträge plus meine drei neuen.
- **Ergebnis:** Keine Abweichung und nichts übersehen. Die in den Texten zitierten Bezeichnungen „Pull automatically“, „Sync now“ und „Link live“ stimmen mit den englischen Labels in `en.ts:1110`, `:268` und `:824` überein.

## Aktueller Hash-Stand laut `source-manifest-final.json`
- **Seit dem Erstreview geändert (Integration):** `electron/plugin-service.ts`, `src/renderer/i18n/en.ts`, `src/renderer/state/confluence-live-sync.ts`, `tests/unit/confluence-live-service.spec.ts`, `tests/unit/renderer/confluence-live-scheduler.spec.ts`. Im Original ist nichts geändert.
- **Aktuell identisch zwischen beiden Checkouts:** 12 Pfade, nicht 16. Die übrigen 10 Original-Einträge weichen ab: die sechs von Anfang an abweichenden und die vier korrigierten Dateien, die im Original auch vorkommen.
- **B8-Umfang:** Meine Änderung betrifft nur `updateLiveLinks` (`plugin-service.ts:737-762`) und einen Testblock (`confluence-live-service.spec.ts:927`). Die Stelle habe ich eben noch einmal gelesen. Den SHA `91b4310e…` hat Root ermittelt; ich konnte keine Hashes berechnen.

## Abdeckung der geänderten Hunks

**Integration, 33 Einträge:**
- **Ganz gelesen (17):**
  - `electron/close-handshake.ts`, `electron/plugin-service.ts`
  - `src/crdt/persistence.ts`, `src/domain/confluence-live.ts`
  - `src/renderer/lib/confluence-live-image.ts`, `src/renderer/state/confluence-live-sync.ts`
  - `storybook/plugin-bridge.ts`, `organisms/PluginSettings.vue`
  - `tests/electron/confluence-fixture.ts`, `tests/electron/confluence-live.spec.ts`, `tests/ui/confluence-live.spec.ts`
  - `tests/unit/confluence-live-service.spec.ts`, `tests/unit/domain/confluence-live.spec.ts`
  - `tests/unit/renderer/`: `confluence-live-image.spec.ts`, `confluence-live-scheduler.spec.ts`, `confluence-live-store.spec.ts`, `document-cache.spec.ts`
- **Nur Änderungshunks gelesen (16):**
  - `electron/main.ts` (zusätzlich Zeilen 380–674), `electron/preload.ts`
  - `src/crdt/types.ts`, `src/domain/atlassian.ts`, `src/domain/index.ts`, `src/domain/plugins.ts`
  - `organisms/panels.stories.ts`, `pages/WorkspacePage.vue`, `storybook/with-whiteboard.ts`
  - `src/renderer/i18n/en.ts`, `src/renderer/state/contract.ts`, `src/renderer/state/whiteboard.ts` (zusätzlich Close-, Plugin- und Install-Pfade)
  - `tests/electron/backend-shell.spec.ts`, `tests/unit/crdt.spec.ts`, `tests/unit/platform/security-and-ipc.spec.ts`, `tests/unit/renderer/design-system.spec.ts`
- **Abgeschnittene Ausgaben:** Die Diffs von `crdt.spec.ts` und `security-and-ipc.spec.ts` hatte ich auf 330 Zeichen gekürzt. Eine Suche zeigt in beiden Dateien keine längere Zeile, also ging nichts verloren. Den auf 260 Zeichen gekürzten `en.ts`-Diff habe ich durch die direkte Lektüre ersetzt.

**Original, 22 Einträge** (Grundlage `original-source-diff.txt`; direkter Zugriff war gesperrt):
- **Sechs abweichende, Hunks direkt gelesen:** `main.ts`, `App.vue`, `components/PluginSettings.vue`, `en.ts`, `whiteboard.ts`, `tests/electron/confluence-live.spec.ts`. Letztere ist per `diff` ein exakter Präfix des Kandidaten.
- **Fünf getrackte identische, Hunks abgeleitet:** `preload.ts`, `atlassian.ts`, `index.ts`, `plugins.ts`, `contract.ts`. Die Blob-Paare in beiden Diff-Dateien sind gleich, also sind es dieselben Hunks wie in der Integration.
- **Vier mit dem Stand vor meiner Korrektur:** `plugin-service.ts`, `confluence-live-sync.ts` und die Service- und Scheduler-Spec. Deren Hashes entsprechen dem ersten Integrationsmanifest, und diesen Stand hatte ich ganz gelesen.
- **Sieben ungetrackte identische:** erben die Ganzlektüre der Integrationsdatei.
- **Ausnahme:** Die Abschnitte dieser 16 Einträge in `original-source-diff.txt` selbst habe ich nicht erneut gelesen. Die Gleichheit stützt sich auf Hashes und Blob-IDs.

Unveränderte Dateibereiche außerhalb der Hunks sind bei den 16 Hunk-Dateien nicht geprüft und nicht beansprucht.

## Urteil zum aktuellen Stand
- **B1, B2, B4, B5, B7, B8:** Im Integrations-Worktree korrigiert, jeweils mit Regression; für B1, B5 und B8 ist der Fehlschlag gegen den Stand ohne Korrektur gezeigt. Mein letzter eigener Lauf war 139 von 139 in sieben Dateien. Einen weiteren materiellen Defekt sehe ich in den gelesenen Änderungen nicht.
- **Roots Ergebnisse, nicht meine:** B8 mit der Originalprobe bestätigt; Typecheck und Build mit Exit 0 auf dem genannten SHA; nativ 5 von 6, der fehlgeschlagene Fall (Drag durch `lostpointercapture` unterbrochen) wird wiederholt.
- **Offen und getrennt geführt:**
  - B3 / #219: Die explizite Recovery ist nicht an die Oberfläche angebunden.
  - B6 / #220: Schließen bei abgestürztem Renderer, nativ nicht reproduziert.
  - Die Sichtbarkeit von Registrierungsfehlern aus #217.
- **Original-Checkout:** Älterer Stand ohne #217, #218 und ohne die sechs Korrekturen.
- **Integrationsstatus:** Die Korrekturen sind lokal, uncommittet und nicht in den Zielbranch integriert.
- **Nicht von mir geprüft:** native Abnahme, UI, Tenant und Neustart mit echter Verknüpfung. Weiter offen sind die früher genannten Grenzen: Layout-Seiten, Zwei-Geräte-Konflikt, Restfenster vor dem Seiten-PUT und der stille Linkverlust bei Jira-Deinstallation.
