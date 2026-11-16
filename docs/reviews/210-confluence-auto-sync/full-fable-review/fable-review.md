# Unabhängiger Review #210 / #217 / #218 – Integrations-Worktree

**Ergebnis:** Keine Blocker gefunden, aber zwei mittlere Defekte in `electron/plugin-service.ts`, die ich vor dem Merge beheben würde, und eine offene Architekturfrage zu #217. Keine pauschale Freigabe: Mehrere Testdateien und der Original-Checkout sind nur teilweise geprüft (Tabelle unten).

**Prüfbasis:** Rein statisch, nur Lesen, Suchen und `git diff`/`git status` im Integrations-Worktree. Keine Tests, kein Build, keine App, kein Netz. `graphify query` wurde vom Harness verweigert. Jeder Bash-Zugriff auf den Original-Checkout wurde ebenfalls verweigert; dort habe ich nur Manifest-Hashes und gezielte Suchen verwendet.

**Identität:** Modell laut Systemkontext `claude-fable-5-2` (Claude Agent SDK). CLI-Version und Effort-Stufe sind für mich nicht einsehbar.

## Befunde

### B1 (Mittel) – Einstellungs-Speichern kann den Anhangs-Stand einer Verknüpfung zurücksetzen
- **Ort:** `electron/plugin-service.ts:543-546` (`saveConfig`), Aufrufer `:729-731`, `:737-739`, `:774-775`, `:789-792`; Gegenstück `:710-724` (`updateLiveLinks`).
- **Ursache:** `saveConfig` schreibt `next.atlassian` samt `confluenceLinks` aus einem Schnappschuss von `this.config`. `updateLiveLinks` aktualisiert `this.config` aber erst nach Abschluss seiner Store-Mutation. Der Schutz gilt also nur in eine Richtung.
- **Auslöser:** Git- oder Atlassian-Einstellungen speichern oder ein Plugin (de)installieren, während das `remember()` einer Veröffentlichung (`:1220`, `:1316`) noch auf die Datei schreibt. Das Fenster ist wenige Millisekunden breit; bei `configureGit` reicht es, dass ein Git-Kommando (`:766-771`) genau dann zurückkehrt.
- **Auswirkung:** `published`, `pending` und `lastSyncedAt` fallen auf den alten Stand zurück. Bei der nächsten inhaltlich geänderten Veröffentlichung greift `:1264-1267`: Die eigene, neuere Version gilt als „von anderer Stelle geändert“. Die Verknüpfung bleibt blockiert, bis der Nutzer den Anhang in Confluence löscht.
- **Korrektur:** In der `saveConfig`-Mutation `confluenceLinks` aus dem gespeicherten Profil übernehmen, nicht aus `next`. Danach `this.config` aus dem gespeicherten Profil ableiten. Deinstallation löscht die Verknüpfungen weiterhin ausdrücklich.
- **Testlücke:** `confluence-live-service.spec.ts:181` prüft nur den sequenziellen Fall.

### B2 (Mittel, latent) – Schreibpfad kann eine Profildatei erzeugen, die der Lesepfad komplett verwirft
- **Ort:** Lesen `electron/plugin-service.ts:219-228`, `:234-235`; Schreiben `:1056`, `:1071`, `:1215-1224`, `:1229`; Folge `:504-510`.
- **Auslöser a:** `published` wächst um jede je veröffentlichte Diagrammseite. Einträge werden nur bei `remote === null` einer aktuellen Seite gelöscht (`:1257`). Ab 401 Dateinamen wirft `records()` beim nächsten Start.
- **Auslöser b:** `documentPath` wird ungeprüft gespeichert. Ein Pfad mit Steuerzeichen, auf macOS/Linux zulässig, wird beim Laden abgelehnt.
- **Auswirkung:** `PROFILE_STORE_INVALID` für die ganze Datei. Alle Profile erscheinen als Standard, und alle Plugin-Änderungen sind gesperrt – nicht nur die betroffene Verknüpfung.
- **Korrektur:** Vor `remember()` `published` und `pending` auf die Dateinamen der aktuellen `images` beschränken. Zusätzlich jeden neuen oder geänderten Link vor dem Persistieren durch dieselbe Validierung wie `parseConfluenceLinks` schicken und bei Verstoß mit einer Nutzermeldung ablehnen.

### B3 (Mittel, Architektur) – Der neue Cache-Schreiber hat keinen Leser im Produkt
- **Ort:** `src/crdt/persistence.ts:53-177`, `:187-217`; `src/renderer/state/whiteboard.ts:131-141`.
- **Befund:** `createPersistedCrdtController` hat keine Aufrufstelle in `src/` außer Definition und Export. Nur Tests lesen den Cache.
- **Auswirkung:** Rund 170 Zeilen Schreiblogik (Writer-Marke, Sequenz, Kompaktierung, Reconnect) plus eine IndexedDB-Transaktion pro Änderung ohne Produktnutzen. Bei zwei wechselnden Haltern wird je Änderung der Vollstand geschrieben.
- **Vertragsänderung:** Die bisherige implizite Wiederherstellung ungespeicherter Änderungen entfällt. Das ist gewollt und getestet (`tests/unit/renderer/document-cache.spec.ts:213-235`), aber nirgends als Produktentscheidung benannt.
- **Vorbestehend, nicht neu:** Auch Raum-Dokumente von P2P-Gästen landen in diesem Cache (`whiteboard.ts:917`), ohne Aufräumpfad.
- **Entscheidung nötig:** Entweder eine explizite Recovery mit Nutzerentscheidung anbinden, oder den Cache als bewusst ungenutzt dokumentieren und für Raum-Dokumente abschalten.

### B4 (Niedrig) – Anhänge werden hochgeladen, bevor feststeht, dass die Seite lesbar ist
- **Ort:** `electron/plugin-service.ts:1273-1290`.
- **Auslöser:** Der Seitenkörper ist für den Scanner `unsafe`.
- **Auswirkung:** Neue Anhänge oder Versionen liegen auf einer Seite, die Sketchdraw dann nicht anfasst; Status „fehlgeschlagen“.
- **Korrektur:** `planManagedImages(before.body, …)` und die `unsafe`-Prüfung vor Schritt 2 ziehen; `before` liegt dort schon vor.

### B5 (Niedrig) – Fehler-Haltezeit wird durch Änderungen während eines Laufs umgangen
- **Ort:** `src/renderer/state/confluence-live-sync.ts:134`, `:170-172`, `:183-186`.
- **Auslöser:** Dauerhaft fehlschlagende Verknüpfung (z. B. 403) und eine Bearbeitung, die in einen laufenden Versuch fällt. `finally` plant dann mit `debounceMs` neu, ohne `holdUntil`.
- **Auswirkung:** Rendern, IPC und HTTP etwa alle drei Sekunden statt alle 60.
- **Korrektur:** `schedule(Math.max(debounceMs, holdUntil - now()))`.

### B6 (Niedrig, vorbestehend) – Fenster mit abgestürztem Renderer lässt sich nicht schließen oder beenden
- **Ort:** `electron/main.ts:512-518`, `:538`; `electron/close-handshake.ts:61-66`.
- **Auslöser:** Renderer-Absturz, danach Schließen oder Cmd+Q. `isCrashed()` führt zu „abgelehnt“, und `quitRequested` wird gelöscht.
- **Auswirkung:** Nur Force-Quit hilft. Das war vor #218 faktisch genauso, ist jetzt aber ausdrücklich so kodiert.
- **Korrektur:** Bei abgestürztem oder zerstörtem `webContents` das Schließen erlauben; nur „lädt noch“ ablehnen.
- **Restrisiko:** Eine nie beantwortete Frage blockiert alle späteren Versuche, weil keine neue Anfrage mehr gesendet wird. Einen erreichbaren Renderer-Pfad dafür habe ich in `whiteboard.ts:937-990` und `:2304-2316` nicht gefunden.

### B7 (Niedrig) – Zu großes Bild liefert nur eine generische Meldung
- **Ort:** `electron/plugin-service.ts:1117-1119`; `src/renderer/lib/confluence-live-image.ts:77-97`.
- **Auslöser:** Eine Seite mit großen eingebetteten Fotos ergibt ein PNG über 10 MB.
- **Auswirkung:** „Ungültige Confluence-Veröffentlichung.“ für das ganze Diagramm, ohne Seite oder Grenze zu nennen.
- **Korrektur:** Eigene Meldung mit Seitenname und Limit, oder im Renderer mit kleinerem Maßstab neu rastern.

## Erwartete Vertragsänderungen (kein Defekt)
- **Close-ID:** Eine wiederholte Schließanfrage behält ihre ID; nach Cancel gibt es eine neue ID, die alte Antwort wird abgelehnt. Die Root-Änderung in `tests/electron/backend-shell.spec.ts:373-387` bildet das korrekt ab.
- **Aufräumen bei Quit:** Plugins und P2P-Verbindungen enden erst in `will-quit`. Ein abgebrochenes Beenden lässt sie jetzt weiterlaufen.
- **Manuelles Senden:** `updateConfluencePage` verlangt `expectedBodyHash` und verweigert verlustbehaftetes Senden. Alte Einbindungen müssen einmal neu geladen werden.
- **Fremde Anhangsversion:** Bei bekanntem Anhang ist eine fremde Folgeversion mit anderem Inhalt ein harter Konflikt (getestet in `confluence-live-service.spec.ts:351`, `:398`).
- **Grenze daraus:** Zwei Geräte mit divergierendem Stand desselben Diagramms blockieren sich gegenseitig. Der Löschhinweis in der Meldung löst das nicht dauerhaft.

## Abdeckung: Integrations-Worktree

| Datei | Status | Anmerkung |
|---|---|---|
| `electron/close-handshake.ts` | geprüft | vollständig |
| `electron/main.ts` | geprüft | Diff vollständig, Zeilen 380–674 gelesen; unveränderter Rest nicht |
| `electron/plugin-service.ts` | geprüft | vollständig (1419 Zeilen) |
| `electron/preload.ts` | geprüft | Diff |
| `src/crdt/persistence.ts` | geprüft | Diff vollständig |
| `src/crdt/types.ts` | geprüft | Diff |
| `src/domain/atlassian.ts` | geprüft | Diff; #209-Codec nicht vertieft |
| `src/domain/confluence-live.ts` | geprüft | vollständig |
| `src/domain/index.ts` | geprüft | Diff |
| `src/domain/plugins.ts` | geprüft | Diff |
| `organisms/PluginSettings.vue` | teilweise | Diff gelesen; `runOperation` und Altbestand nicht; keine visuelle Prüfung |
| `organisms/panels.stories.ts` | geprüft | Diff |
| `pages/WorkspacePage.vue` | geprüft | Diff |
| `storybook/plugin-bridge.ts` | geprüft | vollständig |
| `storybook/with-whiteboard.ts` | geprüft | Diff |
| `src/renderer/i18n/en.ts` | geprüft | Diff; Schlüssel nicht maschinell abgeglichen |
| `src/renderer/lib/confluence-live-image.ts` | geprüft | vollständig |
| `src/renderer/state/confluence-live-sync.ts` | geprüft | vollständig |
| `src/renderer/state/contract.ts` | geprüft | Diff |
| `src/renderer/state/whiteboard.ts` | geprüft | Diff vollständig plus Close-/Plugin-/Install-Pfade; Rest der Datei nicht |
| `tests/electron/backend-shell.spec.ts` | geprüft | Diff und Zeilen 335–399 |
| `tests/electron/confluence-fixture.ts` | geprüft | vollständig |
| `tests/electron/confluence-live.spec.ts` | teilweise | Zeilen 556–735 (#218) und alle Titel; 1–555 nicht |
| `tests/ui/confluence-live.spec.ts` | geprüft | vollständig |
| `tests/unit/confluence-live-service.spec.ts` | teilweise | Zeilen 1–260, 334–412 und alle Titel; rund 60 % nicht zeilenweise |
| `tests/unit/crdt.spec.ts` | geprüft | Diff |
| `tests/unit/domain/confluence-live.spec.ts` | geprüft | vollständig |
| `tests/unit/platform/security-and-ipc.spec.ts` | geprüft | Diff |
| `tests/unit/renderer/confluence-live-image.spec.ts` | nicht geprüft | nur Testtitel |
| `tests/unit/renderer/confluence-live-scheduler.spec.ts` | geprüft | vollständig |
| `tests/unit/renderer/confluence-live-store.spec.ts` | nicht geprüft | nur Testtitel |
| `tests/unit/renderer/design-system.spec.ts` | geprüft | Diff (Baseline 15 → 13) |
| `tests/unit/renderer/document-cache.spec.ts` | geprüft | vollständig |

## Abdeckung: Original-Checkout

Kein Diff möglich. „Duplikat“ heißt: Manifest-Hash identisch mit der geprüften Integrationsdatei.

| Datei | Status | Anmerkung |
|---|---|---|
| `electron/main.ts` | teilweise, veraltet | enthält #210, aber nicht #218: Aufräumen noch in `before-quit` (`:635`), kein `coordinator.reset`, kein `quitRequested` |
| `electron/plugin-service.ts` | Duplikat | B1, B2, B4, B7 gelten identisch |
| `electron/preload.ts` | Duplikat | |
| `src/domain/atlassian.ts` | Duplikat | |
| `src/domain/confluence-live.ts` | Duplikat | |
| `src/domain/index.ts` | Duplikat | |
| `src/domain/plugins.ts` | Duplikat | |
| `src/renderer/App.vue` | teilweise, altes Layout | nur `behindModal` (`:127-132`) als Gegenstück zu `WorkspacePage.vue` bestätigt |
| `src/renderer/components/PluginSettings.vue` | teilweise, altes Layout | Live-Abschnitt und Fokuslogik per Suche vorhanden; nicht zeilenweise verglichen |
| `src/renderer/i18n/en.ts` | teilweise | 5 von 5 Stichproben-Schlüsseln vorhanden; Hash weicht ab |
| `src/renderer/lib/confluence-live-image.ts` | Duplikat | |
| `src/renderer/state/confluence-live-sync.ts` | Duplikat | B5 gilt identisch |
| `src/renderer/state/contract.ts` | Duplikat | |
| `src/renderer/state/whiteboard.ts` | teilweise | #210-Teile per Suche vorhanden; übrige Abweichungen nicht aufgelistet |
| `tests/electron/confluence-fixture.ts` | Duplikat | |
| `tests/electron/confluence-live.spec.ts` | teilweise, veraltet | nur die zwei #210-Tests; #217- und #218-Tests fehlen |
| `tests/ui/confluence-live.spec.ts` | Duplikat | |
| `tests/unit/confluence-live-service.spec.ts` | Duplikat | teilweise geprüft wie oben |
| `tests/unit/domain/confluence-live.spec.ts` | Duplikat | |
| `tests/unit/renderer/confluence-live-image.spec.ts` | Duplikat | selbst nicht geprüft |
| `tests/unit/renderer/confluence-live-scheduler.spec.ts` | Duplikat | |
| `tests/unit/renderer/confluence-live-store.spec.ts` | Duplikat | selbst nicht geprüft |

Der Original-Checkout enthält weder die #217-Persistenz noch den #218-Handshake; `src/crdt/persistence.ts:37` bindet dort weiterhin `y-indexeddb` direkt an den Controller. Er trägt also CF-217-01 und CF-218-01 noch in sich. Das ist ein veralteter Stand, kein Integrationsdefekt, taugt aber nicht als Produktbasis.

## Akzeptierte Aspekte
- **Fremdinhalt:** Der Scanner serialisiert nie neu, gibt bei jeder Unsicherheit `unsafe` zurück und erkennt Fremdcontainer, Mehrfachquellen und Zeichenreferenzen. Die Domain-Tests decken das ab.
- **Autorität:** Unwiderrufliche Epoche plus Abbruch laufender Requests plus Wertvergleich in `assertLiveJob`. Jeder Wechsel von Dokument, Profil, Site, Konto, Verknüpfung oder Fenster widerruft.
- **Lokalität der Verknüpfung:** Sie liegt nur im Profil auf dem Gerät, wird bei Profilkopie und Ordner-Altkonfiguration nicht übernommen, und Gäste oder ungespeicherte Dokumente veröffentlichen nie.
- **Geheimnisse:** Weder Token noch Link-Token erreichen den Renderer; Weiterleitungen sind gesperrt.
- **Quit-Ablauf:** `before-quit` → Handshake → `window-all-closed` → `will-quit` ist schlüssig, einschließlich Cancel, Reload und macOS ohne Fenster.
- **Cache-Richtung:** Der Cache schreibt nie in den Controller. Der Zwei-Halter-Fall ist transaktional sauber gelöst.
- **UI:** Der neue Abschnitt nutzt `AppButton`, `AppTextField` und Tokens; der Altbestand sinkt.

## Offene Lücken
- Der Neustart mit persistierter Verknüpfung gegen den echten Tenant ist nicht belegt.
- Der Body-Schreibpfad hat ein Restfenster zwischen letztem Lesen und PUT, und Anhänge haben kein „nur wenn noch Version N“ (im Code dokumentiert).
- Das Anhängen am Seitenende bei Seiten mit `ac:layout` ist nur gegen Fakes geprüft, die nicht normalisieren.
- Die #218-Pfade für Windows und Linux sind nur als Unit-Test abgedeckt; zwei native Tests werden außerhalb von macOS übersprungen.
- Eine Verknüpfung hängt am Pfad. Verwaiste Einträge verschobener Dateien lassen sich nicht entfernen und zählen gegen das Limit von 200 (`plugin-service.ts:1072-1076`).
- #209, #215, #183/#211, die #217-Registrierungsbeobachtung und Ledger/Graph habe ich nicht bewertet.

## Empfohlene nächste Prüfungen
1. **B1:** Unit-Test mit `gate` auf den Profil-Schreibvorgang: `configureGit` und `installPlugin` während des abschließenden `remember()`. Danach muss `published` den neuen Stand halten, und eine Veröffentlichung mit geändertem Inhalt muss `synced` liefern.
2. **B2:** Unit-Test mit mehr als 400 nacheinander veröffentlichten Seiten-IDs und einem Dokumentpfad mit Zeilenumbruch, jeweils mit Neustart des Dienstes. Erwartung: kein `configurationIssue`.
3. **B3:** Entscheidung im Ticket #217 dokumentieren (Recovery anbinden oder Cache reduzieren).
4. **B4, B5:** Je ein gezielter Unit-Test: `unsafe`-Seite ohne POST; Änderung während eines fehlgeschlagenen Laufs ohne zweiten Versuch vor Ablauf der Haltezeit.
5. **Tenant:** Erstverknüpfung auf eine Seite mit Layout-Abschnitten; Neustart mit bestehender Verknüpfung; Zwei-Geräte-Konflikt.
6. **B6:** Nativ den Renderer per `forcefullyCrashRenderer` abstürzen lassen, dann Schließen und Quit prüfen.