# ADR 0005 — Vite, Sucrase und VueUse

Status: angenommen. Die Evaluierung und ihre Nachweise werden in [#73](https://github.com/J-ARTS/de.sketchdraw.io/issues/73) gepflegt.

## Entscheidung

1. **Vite bleibt der Renderer-Buildpfad.** Sketchdraw verwendet Vite 8 mit dem offiziellen Vue-Plugin für Entwicklung, Vue-SFC-Transformation und Produktionsbundles. Die vorhandene Trennung zwischen schneller Transformation und `vue-tsc`-Typprüfung bleibt bestehen.
2. **Sucrase wird nicht eingeführt.** Für den Renderer würde es die vorhandene Oxc-/Rolldown-Pipeline duplizieren. Für Electron und MCP würde es esbuild nur als TypeScript-Stripper ersetzen, nicht aber dessen Bundling. Es ersetzt außerdem weder `vue-tsc` noch `tsc` und kann die gemessene Typprüfzeit deshalb nicht verkürzen.
3. **VueUse ist für gezielte Renderer-Composables zugelassen und seit [#74](https://github.com/J-ARTS/de.sketchdraw.io/issues/74) als direkte Produktionsabhängigkeit installiert.** Bei neuen oder ohnehin geänderten Vue-Komponenten sollen direkte Imports aus `@vueuse/core` bevorzugt werden, wenn sie manuelle Lifecycle-Nebenwirkungen tatsächlich ersetzen. Eine reine Massenmigration funktionierender Komponenten ist nicht gerechtfertigt.

## Aktueller Buildpfad

| Bereich | Werkzeug | Aufgabe |
| --- | --- | --- |
| Renderer-Entwicklung | Vite 8.3.4 und `@vitejs/plugin-vue` 6.0.10 | Dev-Server, Vue-SFC-Transformation und HMR |
| Renderer-Produktion | Vite 8.3.4 | Rolldown-Bundle, Oxc-Transformation und Minifizierung |
| Renderer-Typen | `vue-tsc` 3.3.13 | projektweite Vue-/TypeScript-Typprüfung |
| Electron | esbuild 0.28.2 | Main- und Preload-Bundle |
| MCP | esbuild 0.28.2 | Node-Bundle des lokalen MCP-Servers |
| Konfigurations-/Node-Typen | TypeScript 6.0.3 | projektweite statische Prüfung ohne Ausgabe |

Vite 8 hat die frühere Kombination aus esbuild im Entwicklungsmodus und Rollup für Produktionsbundles durch Rolldown und Oxc ersetzt. Vite transpiliert TypeScript absichtlich ohne Typprüfung; die separate Typprüfung ist Teil des Geschwindigkeitsmodells und darf nicht durch einen weiteren Transpiler ersetzt werden.

Quellen: [Vite 8 announcement](https://vite.dev/blog/announcing-vite8), [Vite TypeScript features](https://vite.dev/guide/features.html#typescript), [Sucrase README](https://github.com/alangpierce/sucrase), [Sucrase project vision](https://github.com/alangpierce/sucrase/blob/main/docs/PROJECT_VISION.md), [VueUse guide](https://vueuse.org/guide/), [VueUse best practices](https://vueuse.org/guide/best-practice).

## Basismessung

Geprüfter Stand: `46c43d7`, macOS arm64, Node.js 22.16.0, npm 10.9.2. Jeder Build lief in einem eigenen Prozess. Vite leerte dabei sein Ausgabeziel; Betriebssystem- und Dateisystem-Caches wurden nicht künstlich verworfen. Die Werte sind deshalb eine reproduzierbare lokale Prozess-Baseline und keine Hardware-übergreifende Leistungszusage.

| Prüfung | Läufe in Sekunden | Median | Bereich |
| --- | --- | ---: | ---: |
| `npm run build:renderer` | 1,243 / 1,211 / 1,147 / 1,076 / 1,098 | 1,147 s | 1,076–1,243 s |
| `npm run build:electron` | 0,184 / 0,166 / 0,169 / 0,170 / 0,169 | 0,169 s | 0,166–0,184 s |
| `npm run build:mcp` | 0,183 / 0,179 / 0,180 / 0,181 / 0,181 | 0,181 s | 0,179–0,183 s |
| `npm run typecheck` | 8,153 / 8,266 / 8,266 | 8,266 s | 8,153–8,266 s |

Der normale Renderer-Chunk am Messstand ist ungefähr 1,0 MiB unkomprimiert beziehungsweise 323.102 Byte gzip. Die bereits getrennte Automatic-P2P-Datei ist ungefähr 394 KiB unkomprimiert beziehungsweise 122.142 Byte gzip. Diese Größen sind ein eigener Optimierungsbereich; Sucrase verändert sie nicht grundsätzlich.

## Warum Sucrase hier nicht hilft

Sucrase ist ein schneller, dateiweiser Transformator für moderne JavaScript-Laufzeiten. Sein offizieller Vergleich zeigt einen älteren, im Juli 2022 gemessenen Einzelprozess-Benchmark gegen Babel, TypeScript, swc und esbuild. Dieser Vergleich umfasst weder Vite 8 noch Rolldown/Oxc noch Vue-SFCs und ist deshalb kein belastbarer Geschwindigkeitsnachweis für Sketchdraw.

Eine Integration hätte drei Nachteile:

- Vue-SFCs müssten weiterhin durch das offizielle Vue-/Vite-Plugin laufen; Sucrase kann diesen Pfad nicht ersetzen.
- Die projektweite Typprüfung bliebe unverändert bei `vue-tsc` und `tsc`; genau dieser Schritt ist lokal mit rund 8,27 Sekunden der längste gemessene Einzelpfad.
- Electron und MCP benötigen neben der TypeScript-Transformation auch Auflösung, Bundling, Sourcemaps und externe Modulregeln. esbuild erledigt diese vollständigen Builds bereits in jeweils unter 0,2 Sekunden.

Sucrase unterstützt bewusst keine Plugins und priorisiert einen kleinen, modernen Transformationsumfang. Diese Eigenschaften sind für Jest-/Node-Entwicklungspfade nützlich, liefern in der vorhandenen Sketchdraw-Pipeline aber keinen messbaren Ersatzpunkt. Eine erneute Prüfung ist erst sinnvoll, wenn ein neuer, nicht durch Vite oder esbuild abgedeckter Transformationspfad mindestens 20 Prozent einer wiederholbaren Build- oder Testschleife ausmacht.

## VueUse-Befund

Im Renderer wurden folgende Kandidaten gefunden:

- 14 `addEventListener`-Aufrufe in 8 Vue-Dateien;
- 2 `ResizeObserver`-Instanzen in 2 Vue-Dateien;
- 1 eigene, versionierte und validierende Local-Storage-Abstraktion.

Alle langlebigen Listener und Observer haben aktuell eine explizite Bereinigung. Es liegt daher kein bestätigtes Lifecycle-Leck vor. `useEventListener` und `useResizeObserver` können künftige Änderungen dennoch vereinfachen, weil VueUse ihre Nebenwirkungen an den Component-Scope bindet und beim Unmount automatisch beseitigt.

Ein isolierter, minifizierter Browser-Bundleversuch mit `@vueuse/core@15.0.0`, externer Vue-Laufzeit und Tree-Shaking ergab:

| Import | Minifiziert | gzip | Brotli |
| --- | ---: | ---: | ---: |
| `useEventListener` | 2.416 B | 1.200 B | 1.063 B |
| `useResizeObserver` | 2.216 B | 1.127 B | 981 B |
| `useStorage` | 5.821 B | 2.624 B | 2.376 B |
| alle drei zusammen | 6.410 B | 2.880 B | 2.618 B |

Die Messung zeigt einen kleinen Laufzeitpreis, ist aber keine Zusage für die endgültige Rolldown-Ausgabe. Vite tree-shakt direkte ESM-Imports; ein Auto-Import-Plugin wird nicht eingeführt.

### Einsatzregeln

- Direkte Imports aus `@vueuse/core`; keine globale Auto-Import-Konfiguration.
- VueUse bleibt im Renderer. Domain-, CRDT-, Collaboration-, Electron- und MCP-Verträge verwenden weiterhin ihre expliziten, frameworkunabhängigen Lebenszyklen.
- `useEventListener`, `useResizeObserver`, `useElementSize`, `useDebounceFn` und ähnliche Hilfen sind geeignet, wenn sie manuelle Vue-Lifecycle-Verkabelung ersetzen.
- Die bestehende `shape-toolbar-preferences`-Abstraktion bleibt bestehen. `useStorage` allein bildet deren Schema-Versionierung, Allowlist-Validierung, sichere Fallbacks und testbaren `StorageLike`-Vertrag nicht ab.
- Eine Abhängigkeit wird erst mit der ersten konkreten Verwendung aufgenommen. Bei dieser Änderung werden Bundle-Differenz, Typprüfung und die betroffenen UI-Tests dokumentiert.

### Umsetzung in #74

`@vueuse/core` 15.0.0 ist exakt gepinnt. `useEventListener` verwaltet die langlebigen Renderer-Listener in `App.vue`, `AnnotationEditor.vue`, `MainMenu.vue`, `Minimap.vue`, `PageSwitcher.vue`, `PresenterMode.vue` und `SelectionToolbar.vue`. `useResizeObserver` ersetzt die beiden manuellen Observer in `SelectionToolbar.vue` und `WhiteboardCanvas.vue`. Die versionierte Toolbar-Persistenz und die dynamische Pointer-Geste in `TableOverlay.vue` bleiben bei ihren expliziten, fachlich begründeten Lebenszyklen.

Direkt vor der Installation erzeugte Vite 398 Module und meldete für den normalen Renderer-Chunk 1.064,93 kB beziehungsweise 326,05 kB gzip. Nach der gezielten Einführung sind es 400 Module und 1.065,52 kB beziehungsweise 326,41 kB gzip. Die durch denselben Vite-Bericht beobachtete Differenz beträgt damit rund 0,59 kB unkomprimiert und 0,36 kB gzip. Das ist eine lokale Buildbeobachtung, keine plattformübergreifende Größen- oder Laufzeitzusage.

Der integrierte Stand wurde mit Typprüfung, 375 Unit-Tests, 61 Browser-UI-Tests, 6 Electron-Integrationstests, 59 Build-/Lifecycle-Tests, vollständigem Produktionsbuild und einem Produktionsabhängigkeits-Audit ohne bekannte Schwachstellen geprüft. Die ausführlichen Befehle und der genaue Git-Stand werden in #74 dokumentiert.

## Folgen

Der aktuelle Build bleibt einfach und schnell. Es entsteht kein zweiter TypeScript-Transformationspfad, und die statische Typprüfung bleibt vollständig. VueUse standardisiert die ausgewählten Renderer-Lebenszyklen, ohne Kernlogik oder Datenverträge an Vue zu koppeln. Für eine darüber hinausgehende Massenmigration funktionierender Komponenten fehlt weiterhin ein konkreter Nutzen.
