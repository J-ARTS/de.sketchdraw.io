# #210: enger UI-Integrationsnachreview

## Auftrag und Snapshotgrenze

Lesende Prüfung im Worktree `/Users/jeremyteichmann/.codex/worktrees/210-confluence-integration/de.sketchdraw.io`, registriert durch Root in #210 Kommentar `6902880243`. Vergleichsbasis `c572671f1ba17adf957fe4eff1e53457a4c20fc6` (origin/main beim Integrationsstart).

Fable-Prozess96519 war während der Prüfung noch aktiv. Die unten genannten Dateien waren zwischen dem Anfangs- und Endhash unverändert. Dieser Bericht ist eine Abnahme des genau bezeichneten Snapshots; Root muss nach Prozessende die Hashes vergleichen. Keine Repository-/Git-/Graph-/UI-/Tenantänderung. Keine Tests oder Builds ausgeführt. Ausschließlich Berichte/Hashnachweise unter `/tmp` geschrieben. Die elf bereits von Root abgeglichenen Coredateien wurden nicht erneut inhaltlich geprüft.

## Ein erforderlicher Restfix

### UI-210-INTEGRATION-01 — P2: neue Live-Styles umgehen die verbindlichen Tokens

**Datei:** `src/renderer/design-system/organisms/PluginSettings.vue`, Zeile361 im geprüften Snapshot.

Der vollständig neue `.live-*`-CSS-Block enthält weiter feste Abstände, Radien, Schriften und Größen, unter anderem `.live-copy` margin12px/font-size12px, `.live-card` gap8px/padding14px/radius12px, `.live-target` gap2px/font-size14px, `.live-synced` font-size11px, `.live-dot` width/height8px/margin5px und `.live-note` gap8px/margin12px/font-size11px sowie SVG width/height16px. Die neue Fokusmarkierung verwendet ebenfalls feste Abstände. `tokens.css` ist gegenüber main unverändert.

`AGENTS.md:59` schreibt ausdrücklich vor: „Farben, Abstände, Radien, Schrift und Höhen kommen aus ... tokens.css ... Ein fehlender Wert wird als Token ergänzt, nicht in der Komponente fest eingetragen.“ Das ist neuer #210-Code, kein unveränderter Legacy-Bestand. Die vorhandenen Designsystemtests prüfen diese Tokenregel nicht; ein grüner Unitlauf hebt diesen Restpunkt deshalb nicht auf.

**Kleine konkrete Korrektur:** Nur den neu eingeführten Live-/Fokusblock auf vorhandene Tokens umstellen (`--space-1/2/3/4`, `--radius-*`, `--font-size-*`); bewusst benötigte fehlende Größen als gemeinsame Tokens in tokens.css ergänzen. Farben sind bereits tokenbasiert und können erhalten bleiben. Keine pauschale Neugestaltung der bestehenden Plugin-Styles oder Änderung der Schutztests nötig. Bei neuen allgemeinen Tokens auf sinnvolle wiederverwendbare Namen achten. Danach den neuen Block statisch auf verbliebene harte Designwerte prüfen und betroffene visuelle/fokussierte UI-Nachweise gegen den endgültigen Stand erneuern.

Kein weiterer materieller Funktionsbefund aus diesem engen lesenden Nachreview.

## Bestätigte Integrationspunkte

- **Atomverträge:** AppButton und AppTextField werden über ihre konkreten Designsystem-Pfade verwendet. `confluenceQuery` ist ein Stringref, AppTextField hat type=search und einen aria-label. Der Suchen-AppButton hat ausdrücklich `type="submit"`; Formhandler `@submit.prevent="searchPages"` bleibt erhalten. Neue Live-Aktionen nutzen AppButton mit passenden primary/danger-Intents; aria/data-testid, disabled und Aktionen sind erhalten. Unveränderte Atomwurzeln reichen native Attribute/Listener weiter.
- **Fokus:** Der Remember-Focus-Pfad speichert native Eventtargets statt Komponenteninstanzen. `:disabled` berücksichtigt auch den übergeordneten Fieldset. Busy-/Status-/Link-/Suchergebnisänderungen prüfen den Fokus nach DOM-Aktualisierung. Die vorhandenen showModal-, Dialog-Cancel-, Tab-Fokus- und Opener-Rückgabewege sind erhalten; nach Lösen wird die Überschrift fokussiert. Keine neue funktionale Abweichung bei der Atomübertragung statisch erkannt. Tatsächliche Browser-/native Bedienbarkeit ist kein Ergebnis dieses lesenden Reviews.
- **Workspace:** `behindModal()` und der Keydown-Guard sind in WorkspacePage.vue integriert. App.vue ist identisch mit main und bleibt der dünne Wrapper. Der alte PluginSettings-Komponentenpfad wurde nicht wieder eingeführt.
- **Schutztest:** Einziger Diff im Designsystemtest ist sd-btn15→13. Alle anderen Baselines, Assertions und Allowlisten bleiben unverändert. Unabhängige statische Zählung nach derselben Template-/Klassenregel ergibt sd-btn13, sd-icon-btn34, sd-input5, sd-textarea2. Kein Testlauf und keine Abschwächung der Regeln.
- **Upstream-Erhalt:** Git-Diff gegen c572671 ist leer für App.vue, export.ts, `src/catalog`, package/package-lock, .storybook, Manifestgenerator, Designsystemindex, isometric Unit/UI-Tests, CI-Konfiguration, tsconfig.node und AGENTS/CLAUDE. Alle vier neuen Isometrieübersetzungen sind vorhanden. Die i18n-Änderungen beschränken sich auf die erwarteten #210-Texte/Suchbeschreibung.
- **Stories:** Vier zusätzliche Livezustände im bestehenden panels.stories.ts: unlinked, linked/synced, error und server-requested pause. Gemeinsame Storydateien sind nach dem unveränderten Katalogvertrag zulässig. Der neue Helper injiziert pro Store eine eigenständige In-Memory-Desktopbridge; Jira ist allein installiert, refreshPluginSettings liest dieselbe Linkquelle. Kein Fetch-/Datei-/Credential-/Tenantzugriff im neuen Helper. Der Store wird über den vorhandenen Decorator beim Unmount disposed. Der zusätzliche CreateStoreOptions-Factory-Parameter ist auf Storybook begrenzt.
- **Manifest:** Öffentliche Komponenten-API und Komponenten-/Storydateipfade sind unverändert, daher ist ein unverändertes generiertes Manifest plausibel. Die Erzeugung/Übereinstimmung wurde hier nicht ausgeführt; keine Pflicht, das Manifest kosmetisch von Hand zu verändern. Die Designsystem-README nennt die tatsächlich reduzierten Raw-Counts. Der zusätzliche unabhängige Storyteilbericht bestätigt keinen materiellen Story-/Katalogbefund: `/tmp/sketchdraw-210-final-stories-review.md`.

## Nachweisgrenze

Root meldete1255 Unit- und29 isolierte UI-Prüfungen als bestanden; diese Fremdnachweise wurden in diesem Review nicht neu ausgeführt oder als eigener Testpass übernommen. Weitere Modal-UI-/native Prüfungen liefen während der Beauftragung noch. Synthetische Storyfixtures, Pixel-/Livebildfunktion, nativer Neustart und tatsächliche LiveDoc-Aktualisierung bleiben getrennte Laufzeitnachweise von Root. Insbesondere gibt dieses Review keine Tenant- oder finale Ticketabschlussfreigabe.

## SHA256 des geprüften Snapshots

Anfang: `2026-11-15T23:05:59.797647+00:00`. Ende: `2026-11-15T23:07:30.614746+00:00`. Geänderte Dateien zwischen diesen Messungen: `[]`.

| Datei | SHA256 |
| --- | --- |
| `src/renderer/App.vue` | `deffd020be8e82b8fe2afcbbdd2a3b40f221bf0aa7b1496c5208e4e0b267aec2` |
| `src/renderer/design-system/organisms/PluginSettings.vue` | `bce03b523f6f7ae1ad243b5bcf1bb3a7352ab6366c5dcc0dac1a94b4e8a62493` |
| `src/renderer/design-system/pages/WorkspacePage.vue` | `cfdfb294fbdec5e8b3b70a22121e39d22d3f30be7e414d71c47609caa3825d60` |
| `src/renderer/design-system/organisms/panels.stories.ts` | `7a6aa0378ad06c452774817a0b3fb7fc12e5951e992fd75ad4b2c6be72fe9576` |
| `src/renderer/design-system/storybook/with-whiteboard.ts` | `e7e5776c00146ff16d0def41537712ee1889cb7980195f84d7af1dd8107368c7` |
| `src/renderer/design-system/storybook/plugin-bridge.ts` | `c0ccd8afe839261bcd2e91496a284c6cf2ea62f53d3c3bfdf39e8469930d7bbe` |
| `src/renderer/i18n/en.ts` | `30886b1cdc03d4b83b404f5002f873564f25b26563df6127cc560066b01e54e4` |
| `src/renderer/styles/tokens.css` | `085ce27d8a88f6b90403f6dd1871ce2f38ec16db4d85b296daafb47643f1914c` |
| `src/interop/export.ts` | `7c217f278c5a09c137ced74978a5740df8b627b43d46148568497cf450c214d0` |
| `tests/unit/renderer/design-system.spec.ts` | `ca8272d1d0a2a34ecf7703230331841c18aeef0477f7365be7d03362c72e269d` |
| `docs/design-system/README.md` | `1d6f8ff57e92ff3f703cf59117cc6625690bd4e935ac0506882c5a0d736a9fa8` |
| `docs/design-system/manifest.md` | `36a4c92ee5441736a7351a3a4003753df63f824a484c11b7817d2cd8840b545d` |
| `tests/ui/confluence-live.spec.ts` | `fe3e7fe70e8bb69dc0f8b375317077d2b6b2c4dd39d2e06dbbce5c0dd5ff42df` |

Maschinenlesbare Originalnachweise: `/tmp/sketchdraw-210-final-integration-before.json`, `/tmp/sketchdraw-210-final-integration-after.json`.
