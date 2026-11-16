# #210: lesender Integrationsabgleich mit origin/main

## Geprüfter Stand und Grenze

- Lokale Ausgangsbasis: `96c0039431dcee973ff94f80ce1e4a707d07abcb`.
- Zielstand: `origin/main` = `c572671f1ba17adf957fe4eff1e53457a4c20fc6`.
- Auftrag in Issue #210, Kommentar `6902675711`, durch Root registriert. Prüfung ausschließlich lesend; Dreiweg-Vorschauen und Berichte unter `/tmp`. Keine Repository-, Git-, Graph-, UI- oder Tenantänderung, kein Build/Test. Die bereits unabhängig geprüfte Backendlogik wurde nicht nochmals breit geprüft.
- `origin/main:AGENTS.md` gelesen. Graphify gezielt befragt; dessen Ergebnisse lieferten keinen ausreichenden Kontext für das neue Designsystem. Anschließend direkte Git-/Quellprüfung.
- Diese Prüfung bezieht sich auf die ursprünglichen lokalen #210-Dateien und den genannten Zielcommit. Root hat anschließend einen separaten Integrationsworktree angelegt; dessen noch laufende Integration ist hier nicht abgenommen.

## Konkrete Datei- und Konfliktliste

| Lokale Änderung | Ziel / Vorgehen | Nachweis und Risiko |
| --- | --- | --- |
| `src/renderer/App.vue` | Wrapper aus main unverändert erhalten; lokalen `behindModal()`-Helper und den zusätzlichen Guard in `keydown()` nach `src/renderer/design-system/pages/WorkspacePage.vue` übertragen. | Dreiweg-Vorschau gegen den Wrapper: ein großer Konflikt. Dieselbe Änderung gegen WorkspacePage: konfliktfrei. Alte App-Lifecycle-/Store-Implementierung im Wrapper wieder einzufügen würde die neue Struktur beschädigen. |
| `src/renderer/components/PluginSettings.vue` | Änderungen nach `src/renderer/design-system/organisms/PluginSettings.vue` übertragen, alten Pfad nicht wiederherstellen. | Dreiweg-Vorschau: ein Importkonflikt. `AppButton` aus main und `intlLocale` aus #210 zusammenführen. Zusätzlich semantische Umstellung auf Atome erforderlich. |
| `src/renderer/i18n/en.ts` | Union der #210-Live-Sync-Texte und main-Isometrieübersetzungen behalten. | Dreiweg-Vorschau konfliktfrei. Ganze Datei nicht durch lokalen Stand ersetzen. |
| `src/interop/export.ts` | Ausschließlich upstream geändert; vollständig erhalten. | Neuer `figureLayout`-/`isIconFigure`-Pfad verändert SVG-Komponentenpositionen und Icon-Beschriftung. #210 `renderLivePages()` verwendet `prepareSvgExport()`: relevante Laufzeitabhängigkeit trotz fehlendem Textkonflikt. |
| `electron/{main,plugin-service,preload}.ts`, lokale Domain-/Store-/Live-Sync-Dateien | Lokale #210-Patches und neue Dateien mitführen. | Keine gleichzeitige Änderung dieser Pfade im geprüften main-Diff; kein Anlass für erneutes vollständiges Backendreview. |
| `package.json`, `package-lock.json`, `.storybook/*`, `scripts/design-system-manifest.mjs`, `docs/design-system/*`, `src/renderer/design-system/*`, `tsconfig.node.json`, `.github/workflows/ci.yml` | Neue main-Struktur, Abhängigkeiten, Manifestgenerator und CI-Storybookschritt erhalten. | Storybook und neue Komponenten benötigen den vollständigen Abhängigkeits-/Konfigurationssatz; bloßer Vue-Dateitransfer reicht nicht. |
| `AGENTS.md`, `CLAUDE.md`, main-Catalog-Dateien und aktualisierte UI-/Unit-Tests | main-Versionen und deren neue Regeln/Prüfungen erhalten. | Keine Rückmigration auf alte Komponentenpfade und keine Entfernung neuer upstream-Tests. |
| Lokale neue #210-Tests und Hilfsdateien | Mitführen, danach gegen integrierten Stand prüfen. | Keine untracked Pfadkollisionen mit main festgestellt. Die untersuchten neuen Tests importieren die verschobenen alten App-/Komponentenpfade nicht direkt. |

Temporäre Dreiweg-Vorschauen: `/tmp/sketchdraw-210-integration-readonly/summary.json` und die zugehörigen `*-preview`-Dateien. `git merge-file -p --diff3` wurde ausschließlich auf Kopien unter `/tmp` verwendet; keine Aussage über einen bereits ausgeführten Repositorymerge.

## Komponenten-, Manifest- und Storyliste

Ausführlicher unabhängiger Designsystem-Teilbericht: `/tmp/sketchdraw-210-design-system-integration-review.md`. Lokale dort geprüfte PluginSettings-SHA256: `57ab3b895f9b799378a026fd1ecd7f10e91c39135c37aa55bb0520a206fcb034`.

1. **WorkspacePage:** main-Imports, WorkspaceLayout, AppButton-Verwendung und Lifecycle erhalten. Nur den #210-Modal-Tastaturschutz an der bestehenden `keydown()`-Stelle ergänzen. `App.vue` bleibt der dünne Wrapper.
2. **PluginSettings:** `AppButton` importieren/erhalten; `AppTextField` ergänzen; AppIcon und useWhiteboard aus den neuen Designsystem-Pfaden importieren; i18n-Import `{ intlLocale, t, tm }`. Kein Produktimport über das Designsystem-Barrel.
3. **Confluence-Bedienelemente:** Jetzt synchronisieren → AppButton intent=primary; Öffnen → AppButton; Verknüpfung lösen → AppButton intent=danger; Suchfeld → AppTextField type=search; Suchen, Live verknüpfen und Einbinden → AppButton. Alle aria/data-testid-, disabled-, Klick-/Modell-Verträge erhalten. **Suchen ausdrücklich `type="submit"` geben**, da AppButton standardmäßig type=button verwendet. Sonst funktioniert der sichtbare Suchknopf nicht mehr wie bisher.
4. **Fokus:** showModal(), remembered-focus, busy-Watch, Fokusziel nach Lösen, native Tastatur-/Escape-Verträge erhalten. Die Atome reichen Attribute/Listener an ihre nativen Wurzeln durch. Layoutklasse für den Unlink-Abstand statt kopiertem Textbutton-Styling verwenden.
5. **Tokens:** Neue Livepanel-Abstände, Rundungen, Schrift- und Punktgrößen auf vorhandene Tokens abbilden oder fehlende gemeinsame Tokens ergänzen. Bereits tokenbasierte Farben erhalten. Keine pauschale Neugestaltung unveränderter Legacy-Stile nötig.
6. **Raw-Primitiv-Test:** main hat globale Baselines sd-btn=15, sd-icon-btn=34, sd-input=5, sd-textarea=2 und prüft exakte Gleichheit. Mechanischer Transfer erhöht sd-btn auf18. Die minimale oben genannte Migration senkt die Baseline auf13 (zwei bestehende rohe Knöpfe werden mit umgestellt). Endstand zählen und die Baseline nur entsprechend realer Umstellung senken; niemals erhöhen oder abschalten.
7. **Stories:** Bestehendes `organisms/panels.stories.ts` zeigt PluginSettings lediglich im Browser-/Unavailable-Zustand. Eine eigene `organisms/PluginSettings.stories.ts` für bereit/Suchergebnis, verknüpft pending/syncing, synced+Zeitpunkt, Retry-After, paused, conflict/error ergänzen. Fixtures synthetisch und ohne Credentials/Tenant; open-Watch/refreshPluginSettings berücksichtigen, damit die Seed-Daten nicht überschrieben werden. Narrow-/Light-/Dark-Zustände prüfen. Vorhandene WorkspacePage-Story erhalten.
8. **Manifest/Exports:** Erstzeilenbeschreibung und öffentliche Props/Events dokumentieren. Beide Komponenten sind schon im index exportiert: keine Doppel-Exports. Manifest mit `npm run design-system:manifest` erzeugen, nicht manuell ändern. Neue eigene Story wird dadurch referenziert; eine rein interne WorkspacePage-Änderung kann am Manifest korrekt nichts ändern.

Die vier neuen main-Übersetzungen sind „Isometrische Icons“, „Dienste und Daten“, „Rechnen und Netz“, „Clients und Umgebung“; sie müssen neben den lokalen Confluence-Strings erhalten bleiben.

## Passende Prüfungen nach tatsächlicher Integration

**In diesem Review nicht ausgeführt.** Die Liste beschreibt erforderliche bzw. sachlich passende Prüfungen, keine bestandenen Ergebnisse:

- `npm run design-system:manifest`, anschließend `npm run design-system:check`.
- `npx vitest run --config vitest.config.ts tests/unit/renderer/design-system.spec.ts`: Struktur, Schichten, Exporte, Stories, Manifest, primitive Baselines.
- `npm run typecheck` und `npm run build:storybook` gemäß neuer main-Regeln.
- Vorhandene #210-Domain-/Service-/Renderer-Prüfungen gegen den integrierten Stand, insbesondere `tests/unit/renderer/confluence-live-image.spec.ts`, Scheduler/Store und Service. Nicht unverändert bestandene historische Ergebnisse als neue Ergebnisse ausgeben.
- `tests/unit/catalog/isometric.spec.ts` sowie die Livebild-Tests zusammen prüfen: export.ts/catalog ist eine konkrete gemeinsame Abhängigkeit. Main-SVG-Verhalten und daraus resultierende #210-Renderings müssen erhalten bleiben.
- `npm run test:ui -- tests/ui/confluence-live.spec.ts tests/ui/plugins.spec.ts`: Suchknopf und Enter, Fokus während/nach busy, Tab/Shift-Tab/Escape, Lösen, Fehler-/Statusanzeigen, schmale Ansicht, Light/Dark. Falls der Testdateiname im Integrationsstand abweicht, vorhandene Plugin-Suite verwenden.
- Neue upstream-Suite `tests/ui/isometric-icons.spec.ts` erhalten und im regulären UI-Nachweis berücksichtigen.
- Nach frischem Build die passende native `tests/electron/confluence-live.spec.ts` gegen den integrierten Stand prüfen. Ein vorheriger nativer Pass des alten App-/Komponentenstands belegt die Integration von WorkspacePage/Atomen nicht. Die echte Browser-LiveDoc-Abnahme bleibt Rootaufgabe.

Reguläre vollständige CI-Prüfungen richten sich nach dem endgültigen Diff und der neuen main-Konfiguration. Graph-/Ledger-/Issue-Nachführung erfolgt durch Root nach tatsächlicher Integration, nicht durch diesen lesenden Reviewer.

## Materielle Integrationsrisiken und Ergebnis

- **Verlorener Modal-Tastaturschutz**, wenn App.vue als Wrapper übernommen wird, ohne den lokalen Guard nach WorkspacePage zu portieren.
- **Nicht auslösender Suchknopf**, wenn AppButton ohne type=submit die alte implizite Formsubmission ersetzt.
- **Designsystem-Regression**, wenn alte Komponentenpfade/raw Knöpfe wieder eingeführt oder Baselines erhöht werden.
- **Ungeprüfte Livebildabweichung**, wenn upstream export.ts/catalog-Verhalten beim Übertragen verloren geht oder nur alte Render-Testresultate übernommen werden.
- **Unzureichender Zustandsnachweis**, wenn PluginSettings nur in der bisherigen leeren Browserstory geprüft wird.

Kein zusätzlicher unveränderter Backendbefund aus diesem begrenzten Integrationsabgleich. Integration ist anhand der konkreten Dateiübertragungen überschaubar, aber eine konfliktfreie Textübernahme allein erfüllt die neuen Designsystem- und Abnahmeverträge nicht.
