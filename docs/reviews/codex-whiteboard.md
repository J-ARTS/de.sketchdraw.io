# Codex: Whiteboard, Agentenzugriff, Formataustausch und Guest-Store

Stand: 17.10.2026. [#10](https://github.com/J-ARTS/de.sketchdraw.io/issues/10), Querschnitt [#15](https://github.com/J-ARTS/de.sketchdraw.io/issues/15), Session/Agentenzugriff [#13](https://github.com/J-ARTS/de.sketchdraw.io/issues/13). P2P [#14](https://github.com/J-ARTS/de.sketchdraw.io/issues/14), Interop [#12](https://github.com/J-ARTS/de.sketchdraw.io/issues/12). Run: `codex-whiteboard-takeover-001`.

## Auftrag und tatsächliches Werkzeug

Implementierung durch OpenAI Codex nach der vom Koordinator dokumentierten vorübergehenden Übernahmefreigabe des Nutzers. Dies ist kein Claude-Code- oder Antigravity-Beitrag. Der vorhandene Claude-Teilstand (Werkzeugleiste, Titelleiste, Icons, Gestaltungstokens, Schriftintegration, reine Viewport-/Shortcut-/Statusfunktionen) wurde erhalten und angebunden. Titelentwürfe, Exportmenü und eine schmale Darstellung ergänzen vorhandene Komponenten. Gemeinsame Domain-, Session-, Platform-, Codec- und Catalogimplementierungen werden über öffentliche Einstiegspunkte genutzt. Kein Git-/GitHub-/Graphify-Schreibvorgang durch diesen Subagenten; der Koordinator pflegt diese Nachweise.

## Implementiert

- Vue-Einstieg, App-Komposition und gemeinsamer Store mit deutscher Bedienung; echtes Dokument statt UI-Mock. Rechteck, Ellipse, Raute, Freihand, Text, Bild, Verbindung, Container und Katalogkomponente werden dargestellt und bearbeitet.
- Zeichnen, Einzelauswahl/Mehrfachauswahl, Auswahlrahmen, Verschieben, Größenänderung, Rotation, Pan/Zoom, Tastaturbewegung, Gruppieren/Lösen, Reihenfolge, Duplizieren, Verbinden und actorbezogenes Undo/Redo. Containerbewegung delegiert Nachfahrenbehandlung an die Domain.
- Eigenschaften, Objektliste, Theme, native Textbearbeitung/IME, Konflikterhaltung, sichere lokale Bildauswahl sowie zugängliche Toolbar, Dialoge und Tastaturhilfe. Alle Bildbytes bleiben eingebettet. Katalogicons werden ausschließlich aus dem geprüften Safe-SVG-Baum erzeugt; kein v-html.
- Neu, Öffnen, Speichern/Speichern unter und native JSON-Kopie über die echte DesktopBridge bzw. den Browseradapter. Browserdownload heißt ausdrücklich „Als Download übergeben“; nur bestätigte native Speicherung setzt savedRevision. Bei späteren Änderungen bleibt ein laufender Save auf seine erfasste Revision begrenzt.
- Codebereich mit pinned baseRevision, explizitem Übernehmen, Diagnosepositionen, erhaltenen ungültigen/veralteten Entwürfen und ausdrücklich bestätigtem Verwerfen. Katalogsuche/Anbieterfilter, reale Komponenteninsertion, eigene JSON-Sets und Metadatenwidgets.

- AgentAccessPanel mit expliziten Read-/Write-Freigaben, Liste, lokal zuerst wirksamem Widerruf, ausdrücklich angezeigter/kopierter Client-Konfiguration und synchroner Löschung privater UI-Daten beim Dokumentwechsel. Die eigentliche Main/Preload/MCP-Implementierung und der Manager stammen aus der getrennten Koordinatoraufgabe. Browseransicht erklärt die Desktopvoraussetzung; Gastdokumente erteilen keinen lokalen MCP-Zugriff.
- SVG-/draw.io-Import mit begrenzter Dateiauswahl, expliziter Auswahl bei mehreren Seiten, sicherer Vorschau des konvertierten Domainmodells, Diagnosebericht und erforderlicher Verlustannahme vor dem Dirtydialog. Abbruch erhält das ursprüngliche Dokument. Revision null eines Imports bleibt ohne native Datei ungespeichert.
- SVG-/draw.io-Export über reale vorbereitende Interop-APIs und DesktopBridge. Einbettung des vollständigen Modells ist ausdrücklich auswählbar und erklärt enthaltene unsichtbare Metadaten. Verlustannahme ist an die Vorschau gebunden; spätere Dokument-/Entwurfsänderungen sperren den vorbereiteten Export. Der Austausch-Download markiert die native Datei nicht als gespeichert.
- GuestSession-Anbindung im Store, einschließlich rollen-/verbindungsabhängiger Writer-Sperre, Gast-Undo/Redo und Code-/Komponenten-/Bildwrites über das vom Transport gelieferte Gateway. Die P2P-Oberfläche und reale Transportabnahme übernimmt der Koordinator bzw. dessen separate Teilaufgabe.

## Gemeinsame Schreib- und Lifecyclegrenze

Ein lokales bzw. Owner-Dokument besitzt genau eine DocumentAuthority. Ein Gast besitzt ausschließlich die gelieferte GuestSession mit Readonly-Mirror, gebundenem Gateway und lokalem LifecycleGate; es wird kein zweiter Controller für Gastschreibvorgänge erzeugt. Human-, Code- und Importbindungen teilen die menschliche Actor-ID, besitzen jedoch getrennte Grants/Gateways. Canonical writes, Undo und Redo benutzen ausschließlich diese Gateways. Controlleraufrufe beschränken sich auf initiale bzw. neue Komposition. Pure applyCommand wird nur für eine nichtkanonische Gestenvorschau eingesetzt.

`getAuthority()` und `subscribeAuthority(listener)` sind vertrauenswürdige lokale Kompositionshooks für Agenten-/Peeradapter. Bei jedem Dokumentwechsel wird synchron die neue Authority oder bei einer Gastsitzung `null` gemeldet; die vorherige wird beendet, auch wenn die Dokument-ID gleich bleibt. Diese Hooks dürfen nicht direkt an untrusted IPC weitergereicht werden.

Close/Neu/Öffnen/Import/Join/Leave sperren synchron neue Gatewaywrites über die gemeinsame Barrier und sperren zugleich die Bedienung. Abbruch löst den eigenen Token. Speichern aus dem Dirtydialog löst die vorläufige Barrier bei weiterhin gesperrter UI, übernimmt gültige Titel-/Text-/Eigenschaften-/Zeichen-/Codeentwürfe über die Gateways und erwirbt anschließend eine neue finale Barrier. Nach asynchroner Dateiauswahl/-ausgabe werden Session, Token, Revision und Entwurfsgeneration erneut geprüft. IME blockiert das Übernehmen während laufender Zusammensetzung. Ein abgebrochener oder fehlgeschlagener Save/Import erhält das Dokument und entsperrt einen klaren Fortsetzungsweg.

`joinGuestSession(guest)` und `leaveGuestSession()` liefern erst nach tatsächlicher Übernahme bzw. Dialogabbruch ihr boolesches Ergebnis. Leave verwendet den eingefrorenen, bestätigten Mirrorstand als neue ungespeicherte lokale Kopie. Unbestätigte Requests werden niemals darin eingerechnet. Ein verspätetes Ergebnis der alten Sitzung kann weder einen neuen Entwurf anlegen noch die neue lokale Schreibwarteschlange blockieren.

## Lifecycle-Selbstprüfung und behandelte Befunde

Dies ist ein Codex-Selbstreview, kein unabhängiger Claude-/Antigravity-Nachweis. Der Koordinator führt die unabhängige Integrationsprüfung aus.

| Fall | Ergebnis im Store / Regression |
| --- | --- |
| Close kommt während Neu-/Import-Dirtydialog | Native Anfrage übernimmt den Dialog; Abbruch antwortet ausdrücklich mit cancel. Ein laufendes Join-/Leave-Versprechen wird dabei abgebrochen. |
| Barrier belegt oder nach asynchronem Schritt ungültig | UI entsperrt den eigenen Übergang, Antwortpfad an Main bleibt vollständig; keine stille offene Close-Anfrage. |
| Leerer bzw. nicht normalisierter Titelentwurf | Leerer Titel blockiert Save ohne Verlust; gültiger Titel wird nach bestätigtem Commit normalisiert. |
| Unknown Peer-Outcome | Originale Request-ID und Payload sowie der konkrete Draft bleiben erhalten; neue Writes und Save sind gesperrt. „Ausgang prüfen“ fragt nur dieselbe ID ab, ohne automatische Wiederholung. |
| Owner committed vor installiertem Gast-Mirror | Das Ergebnis bestätigt zuerst die Ownerrevision. Solange diese Revision lokal fehlt, bleiben Draft und Schreibsperre erhalten. Die explizite Prüfung löst erst bei lokal bestätigtem Mirror >= Ergebnisrevision. Der Transportimplementierer bestätigte diese Trennung als erwartete API-Semantik. |
| Bestätigung einer einzelnen Aktion bei weiteren offenen Entwürfen | Recovery entfernt nur den genau zugehörigen Draft. Eine bestätigte Titeländerung löscht keinen unabhängigen Eigenschaftenentwurf. |
| Leave bei ausstehender Antwort | Dialog erklärt den unbestätigten Ausgang. Verwerfen behält nur den Barrier-Snapshot als lokale Kopie; verspätete Antworten ändern diese nicht. |
| Viewer, Disconnect oder Widerruf | Eingaben und Gatewaywrites sind gesperrt; bestehende Entwürfe bleiben erhalten. Ansicht, Auswahl, Kopie/Verlassen bleiben möglich. |

## Nachweise

Umgebung: macOS 14.6.1 (23G93), arm64, Node v22.16.0, npm 10.9.2, Vue 3.5.44, Playwright 1.64.1/Chromium; lokale Browserprüfung gegen Vite. Keine abgeschalteten Sicherheitsflags. DesktopBridge wird in Unitprüfungen kontrolliert injiziert; Browserprüfungen benutzen den tatsächlichen Datei-/Downloadadapter und Domain/Session/Codec/Catalog.

| Prüfung | Tatsächliches Ergebnis |
| --- | --- |
| `npm run build:renderer` | Bestanden; Vite-Produktionsbundle einschließlich lokaler Fonts erstellt. Warnung: gemeinsamer JS-Chunk ca. 646 kB minifiziert; keine Performanceabnahme daraus abgeleitet. |
| `npx tsc -p tsconfig.node.json --noEmit` | Bestanden nach Korrektur einer separaten Interop-Testfixture durch deren Bearbeiter. |
| `npx vue-tsc -p tsconfig.app.json --noEmit` | Bestanden. Frühere unvollständige parallele Collaboration-Dateien sind kein aktueller Typecheckblocker mehr. |
| `npx vitest run tests/unit/renderer` | 66/66 bestanden: 41 bestehende Viewport-, 18 Whiteboard-/Lifecycle- und 7 Guest-Koordinationsfälle. |
| `npx playwright test --project=ui tests/ui/whiteboard.spec.ts tests/ui/agent-access.spec.ts tests/ui/interop.spec.ts --output=/tmp/sketchdraw-renderer-ui-results` | 14/14 bestanden; letzter vollständiger Browserlauf 11,7 s. |
| Axe in leerem Canvas, Eigenschaftenauswahl und Exportpanel | Keine Verletzungen der aktivierten wcag2a/wcag2aa/wcag21aa-Regeln. Dies ersetzt keinen manuellen Assistive-Technology-Test. |

Neue Unitfälle prüfen reale Gateway-/Controllerinteraktion: Gestenhistory, Defaultgröße, Containerbewegung genau einmal, IME/Close-Abbruch, Save-Revision bei späteren Änderungen, ehrliche Browserhandoff-Semantik, ungültigen/veralteten Code, fremde Text-/Gestenänderung, Close-Barrier gegen Agentwrites, neue Authority bei gleicher Dokument-ID, defekte geöffnete Datei, abgebrochenen Save, Titel-/Text-/Eigenschaftenentwürfe beim Close, Nudge-Erhaltung sowie Close während bereits offenem Dirtydialog.

Die sieben Whiteboard-Browserfälle prüfen Größenänderung/Rotation/Undo/Redo/Zoom, acht primitive Elementarten einschließlich echter PNG-Einbettung, native JSON-Download-/Open-Rundreise, Dirty-Abbruch, die neunte Elementart aus dem realen Katalog, Codeübernahme/Fehlererhaltung, native Text-Undo-Isolation, Tastaturhilfe/Theme, Axe sowie erreichbare Datei-/Werkzeug-/Codebedienung bei 480 px. Visuell kontrolliert wurden Startzustand und ausgewähltes Rechteck bei 1280 px sowie schmale Ansichten. Laufartefakte liegen in `test-results/whiteboard-properties.png`, `whiteboard-code.png` und `whiteboard-compact.png`; sie sind lokale, durch spätere Testläufe überschreibbare Artefakte.

Drei weitere Agenten-Browserfälle nutzen eine kontrollierte native Bridge und den echten Renderer-Manager/Handler/Authority: Read-/Write-Durchsetzung, explizites Anzeigen/Kopieren, Widerruf, neue Sitzung und Löschung bei Dokumentwechsel. Sie beweisen keinen nativen IPC-/MCP-Prozessstart. Vier Interopfälle prüfen realen SVG-Download/eigenen Metadatenroundtrip, veraltete Exportvorschau, warnenden Import mit Zustimmung und Abbruch, Mehrseitenwahl, Zurückweisung unsicherer XML-Quelle und Axe.

Sieben Guest-Unitfälle ersetzen ausschließlich die Transportgrenze durch eine Fixture; Canonical writes, Actor-History und lokale Lifecyclechecks verwenden die echte Session-Authority. Sie prüfen Join-Abbruch, ausschließliches Guest-Gateway, Viewer/Disconnect, bestätigte lokale Kopie, unbekannten Ausgang/kein automatisches Retry, verspätete Antworten, Save/Leave, getrennte Draft-Recovery und Antwort-vor-Mirror-Race. Sie sind kein WebRTC-/Internetverbindungsnachweis.

Im Verlauf behobene Integrationsfehler: Vue markRaw fügte __v_skip zum streng validierten Dokument hinzu (jetzt eingefrorener abgetrennter Snapshot), Historyanzeige fehlte eine reaktive Revisionabhängigkeit, Dispose nach abgeschlossener Close-Barrier warf SESSION_CHANGED, Tastaturnudges verloren bei Konflikt ihre Vorschau, native Close-Anfrage innerhalb eines anderen Dirtydialogs hatte keinen klaren Antwortpfad, noch fokussierte Eigenschaftenfelder hatten keinen erfassten Entwurf. Die jeweils betroffenen Prüfungen wurden danach wiederholt.

## Geprüfter Dateistand

Lokale, noch nicht durch diesen Run veröffentlichte Änderungen. Hashes sind ein enger Snapshot vor anschließender Integration durch den Koordinator; spätere Änderungen benötigen erneute Prüfungen.

| Datei | SHA256 |
| --- | --- |
| `src/renderer/state/whiteboard.ts` | `d491d23daf7608a173a6f58d07d19d772872b59d92fcc29c4775dbc4f7161fab` |
| `src/renderer/state/contract.ts` | `54d9c5e71fa9aaa6bdd0a8a378758ba7621a61463fb9b2e913d2b2d24ad260f2` |
| `src/renderer/components/AgentAccessPanel.vue` | `4b5df2c8e53204f3911ad5e2537e50c2efb4bcf870ab9f97d9c883eae6b97dcb` |
| `src/renderer/components/InteropPanel.vue` | `17712f850046957d6c583d4450067f6086f814c03876ea7007c4fe53d65193ca` |
| `tests/unit/renderer/whiteboard.spec.ts` | `322b86542fa99139426b59beee417c95b5b1711f69f8acb23d940c7430dae133` |
| `tests/unit/renderer/guest-store.spec.ts` | `87b5795f7bb20514ef50c50b295deb2d5ee06df8195f0f9432bcf757bc28b3a2` |
| `tests/ui/whiteboard.spec.ts` | `86d9c84117eff1efb965b09fc6d7c403fd0bb425d278ed6d9a1a15dc55e18fc8` |
| `tests/ui/agent-access.spec.ts` | `ef84ebf5a76616957045729e80db751f13e5b699a0c02fb2c63a55b2babe5233` |
| `tests/ui/interop.spec.ts` | `e04e0c23d3a7652a9f15d37903f87940397e18514225f69a7535582f40a7853b` |

## Offene Integration und Aussagegrenzen

- P2P-Panel, tatsächliche Zwei-App-Verbindung und native MCP-Produktprüfung sind eigenständige Nachweise des Koordinators bzw. des Transportbearbeiters. Dieser Bericht meldet diese nicht als bestanden. App.vue wird zur P2P-Einbindung anschließend vom Koordinator weitergeführt; die obigen Hashes begrenzen diesen Store-/Panelnachweis.
- Dieser Bericht enthält keinen Packaging-, Signatur-, Windows-/Linux- oder allgemeinen Internet-P2P-Nachweis. Der frühere minimale Electron-Backend-Fixturenachweis in `electron-backend-validation.md` bleibt getrennt.
- Peer-Reconnect wird vom Transport/Panel geführt. Bleibt der Ausgang eines Requests unbekannt, bietet der Store Abfrage und ein ausdrücklich bestätigtes Verlassen mit bestätigter lokaler Kopie; er erzeugt keine neue Request-ID für dieselbe unklare Aktion. Gast-MCP ist weiterhin gesperrt.
- Native draw.io-/SVG-Kompatibilität ist eine unterstützte Teilmenge mit Diagnose-/Verlustanzeige, keine Behauptung vollständiger Fremdproduktgleichheit. Eigene unveränderte Metadatenroundtrips werden zusätzlich geprüft.
- Keine vollständige Accessibility-Zertifizierung, keine große 10.000-Elemente-Performanceabnahme und kein pixelidentischer Textlayoutnachweis. SVG-Textdarstellung bricht anhand expliziter Bounds deterministisch um und wird darin abgeschnitten; Textdaten bleiben vollständig im Modell erhalten.
- Nächster Schritt: unabhängiger Store-/Lifecycle-Review und vollständige Produktprüfung des Koordinators, anschließend Integration in den Zielbranch. Keine Ticket-Schließung oder Veröffentlichung durch diesen Subagenten.
