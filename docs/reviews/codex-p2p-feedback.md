# P2P-Recovery: erreichbare Aktionen bei sichtbaren Meldungen

Ticket: [#14](https://github.com/J-ARTS/de.sketchdraw.io/issues/14), Testkoordination [#15](https://github.com/J-ARTS/de.sketchdraw.io/issues/15). Prüfung und Korrektur durch einen Codex-Subagenten am 17.10.2026; kein Beitrag eines Fremdmodells. Ausgangsrevision `654a416e2f7c66112b751fc1107bae8c4892951a`; die nachfolgende Korrektur ist beim Schreiben dieses Berichts noch lokal.

## Bestätigte Ursache

Die zweite Linux-CI übertrug die Gast-Ellipse in beide bestätigten Dokumentansichten. Der anschließende normale Klick auf „Ausgang prüfen“ konnte den gehaltenen Entwurf jedoch nicht auflösen. Drei lokale Wiederholungen des unveränderten Produkttests reproduzierten denselben Fehler unter macOS/Chromium.

Der Playwright-Trace zeigt den konkreten Grund: Ein `span` innerhalb von `.notices` fängt die Pointer-Ereignisse ab. Meldungen lagen mit `bottom:72px; z-index:30` über dem Aktionsbalken mit `bottom:76px; z-index:15`. Die Ergebnisabfrage wurde deshalb gar nicht ausgelöst. Die begrenzte UI-Diagnostik enthielt ausschließlich die ursprüngliche Synchronisationsmeldung, weiterhin den sichtbaren Prüfbutton und den gehaltenen Entwurf; es gab keine Seitenfehler oder externen HTTP-Anfragen.

Lokaler Fehlerbeleg: `/tmp/sketchdraw-p2p-product-hit-test/native-two-complete-app-pa-a4a88-pendent-local-copy-on-leave/trace.zip`. Der vollständige Trace kann temporäre Pairingtexte enthalten und ist nicht zur ungeprüften Veröffentlichung vorgesehen; für Berichte genügen die eingeschränkte UI-Diagnostik und die oben beschriebene Pointer-Interzeption.

## Korrektur und Regression

`src/renderer/App.vue` ordnet Meldungen und Entwurfs-/Recoveryaktionen in einem gemeinsamen vertikalen Layout an. Normale Layoutabstände verhindern ihre Überlagerung auch bei umgebrochenem Text. Die Aktionsflächen bleiben per Maus erreichbar; der gemeinsame Bereich ist während eines modalen Dokumentübergangs wie die übrige Arbeitsfläche inaktiv. Store, Gateway, Outcome-Prüfung, Mirror-Bedingung und P2P-Timeouts bleiben unverändert.

`tests/ui/feedback.spec.ts` erzeugt über die echte Domäne eine ungültige Breitenänderung. Der Test verlangt eine sichtbare Fehlermeldung und einen gehaltenen Entwurf, prüft deren geometrische Trennung und betätigt „Verwerfen“ sowie „Meldung schließen“ ohne erzwungenen Klick. Er prüft sowohl 1280 × 900 als auch 480 × 720 Pixel. Die gespeicherten Ansichten wurden visuell geprüft.

## Ausgeführte Prüfungen

Umgebung: macOS, ARM64, Node `v22.16.0`, lokales Playwright/Chromium aus dem Projekt.

- `npx playwright test --config tests/p2p/playwright.config.ts --grep 'two complete app pages' --output=/tmp/sketchdraw-p2p-product-fixed`: **1/1 bestanden**, Fall 2,8 s, gesamter Lauf 4,8 s. Der vorher fehlgeschlagene Test prüft weiter normale UI-Kopplung, bestätigte Ellipse auf beiden Seiten, Ergebnisabfrage ohne erzwungenen Klick, entfernten Entwurf, Verlassen mit bestätigter lokaler Kopie und eine weitere unabhängige Bearbeitung.
- `npx playwright test --project=ui tests/ui/feedback.spec.ts --output=/tmp/sketchdraw-feedback-ui-results`: **2/2 bestanden**, letzter Lauf 1,8 s. Screenshots `draft-feedback.png` in den beiden Test-Unterverzeichnissen.
- `npx playwright test --project=ui tests/ui/whiteboard.spec.ts --grep 'keyboard and screen reader structure' --output=/tmp/sketchdraw-feedback-a11y-results`: **1/1 bestanden**, 2,0 s; keine automatisierten Accessibility-Befunde in diesem Testumfang.
- `npx vue-tsc -p tsconfig.app.json --noEmit`: **bestanden**.
- `git diff --check -- src/renderer/App.vue tests/ui/feedback.spec.ts`: **bestanden**.

SHA-256 des geprüften Korrekturstands:

- `src/renderer/App.vue`: `1fb89d9e0ec28b13c462a02bc8797eaacdad7ca09004912de1f2ee5b0bbea735`
- `tests/ui/feedback.spec.ts`: `28f1ddd596331ba5b37f3dd0974dc315b508e0402e434992978ceafe607d8c23`

Grenzen: Der gezielte Produkttest verwendet zwei vollständige Browser-App-Seiten mit echtem lokalem WebRTC. Dieser Bericht behauptet keinen neuen Electron-, Linux-, Windows-, Installer- oder Internet-Nachweis. Die vollständige native P2P-Suite und der nächste CI-Lauf werden separat koordiniert. GitHub-Status und Graphify-Verknüpfungen pflegt die übergeordnete Codex-Instanz.
