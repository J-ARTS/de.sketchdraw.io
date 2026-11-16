# Korrekturlauf und Restabdeckung – Review #210 / #217 / #218

B1, B2, B4, B5 und B7 sind im Integrations-Worktree korrigiert und mit gezielten Tests belegt; die Quellabdeckung ist geschlossen. Gezielte Unit-Tests, Typecheck und Build sind grün. Native Tests, UI-Steuerung, Tenant, Zielbranch-Integration und Live-Abnahme habe ich nicht ausgeführt und behaupte sie nicht.

**Identität:** Modell laut Systemkontext `claude-fable-5-2` (Claude Agent SDK), dieselbe Sitzung wie der Erstreview. CLI-Version und Effort-Stufe sind für mich nicht einsehbar. Kein Codex-Review ist hier eingeflossen.

## Korrekturen

### B1 – Einstellungs-Speichern überschreibt den Verknüpfungsstand
- **Änderung:** `saveConfig` (`electron/plugin-service.ts:563-574`) übernimmt die Live-Links in der eingereihten Mutation aus dem gespeicherten Profil, nicht mehr aus dem vorab geklonten `next`. Danach wird `this.config` aus dem tatsächlich gespeicherten Profil gelesen.
- **Jira-Deinstallation:** entfernt die Links weiterhin ausdrücklich (`:773`, `liveLinks: 'drop'`); Git-Deinstallation lässt sie stehen.
- **Tests (`tests/unit/confluence-live-service.spec.ts:927`):**
  - Der Profil-Schreibvorgang des abschließenden `remember()` wird per `vi.spyOn(fsPromises, 'rename')` angehalten, ohne Test-Abstraktion im Produkt.
  - Währenddessen laufen vier echte Einstellungsoperationen: `installPlugin('git')`, `configureAtlassian`, `configureGit`, `uninstallPlugin('git')`.
  - Geprüft: `published` (Version 2), kein `pending`, `lastSyncedAt` auf Platte und in den Settings; die folgende geänderte Veröffentlichung ist `synced`, auch nach Neustart.
  - Zusätzlich eine Pending-Phasen-Variante und die Deinstallations-Semantik.
- **Gegenprobe:** Mit temporär wieder aus `next` gelesenen Links schlägt der neue Test bei „plugin installed“ mit dem veralteten `pending` fehl, zusammen mit sechs bestehenden. Die Mutation ist wieder entfernt.

### B2 – Unlesbare Profildatei durch den eigenen Schreibpfad
Nicht gekürzt, wie vorgegeben: Historische Besitznachweise bleiben erhalten.
- **Gleiche Prüfung beim Schreiben und Lesen:** `updateLiveLinks` (`:749`) schickt jeden zu speichernden Linkstand durch `parseConfluenceLinks`. Bei Verstoß wird nichts geschrieben, und der gespeicherte Stand bleibt.
- **Pfad:** `setConfluenceLiveLink` (`:1099`) lehnt Steuerzeichen oder Überlänge im Dokumentpfad ab, bevor Confluence gefragt oder die Datei berührt wird.
- **Kapazität:** `MAX_LINK_RECORDS = 400` (`:48`) gilt jetzt für beide Pfade. Vor jeder Anfrage reserviert `runLivePublish` (`:1280`) Platz für `published` und `pending`: vorhandene Schlüssel vereinigt mit den aktuellen Dateinamen. Jeder Zwischenstand eines gestarteten Laufs ist eine Teilmenge davon. Reicht der Platz nicht, endet der Lauf mit einer Kapazitätsmeldung, ohne Anfrage und ohne Schreibzugriff.
- **Tests (`:1030`):**
  - 399 Einträge plus eine neue Seite ergeben 400 und funktionieren; die 401. wird in drei Varianten abgelehnt, ohne einen einzigen Request und mit bytegleicher Profildatei. Nach Neustart ist der Store gültig mit 400 Einträgen.
  - Lese-/Schreibsymmetrie: 400 Einträge laden, 401 nicht.
  - Zurückkehrende Seite: Nach Entfernen und Wiederkehr mit fremder Folgeversion bleibt es beim Konflikt, ohne Überschreiben, auch nach Neustart.
  - Pfade mit Zeilenumbruch, Tab oder Überlänge werden abgelehnt; der Store bleibt unverändert und nach Neustart lesbar.
- **Nicht eigens getestet:** die Rückfallprüfung in `updateLiveLinks`. Nach den vorgelagerten Prüfungen gibt es dafür keinen natürlichen Auslöser.

### B4 – Uploads vor der Lesbarkeitsprüfung
- **Änderung:** Der Seitenplan wird direkt nach dem ersten Lesen berechnet (`:1286-1288`). `unsafe` und Budget-Überschreitung brechen vor Anhangsabfragen und Uploads ab. Frisches Lesen, Ruhefenster, Vergleich und Versions-PUT in Schritt 4 (`:1339`) sind unverändert.
- **Tests (`:1144`):** Bei unsicherem Markup gibt es pro Versuch genau einen GET, keinen POST/PUT und keine Records; nach der Reparatur läuft die Veröffentlichung normal. Bei zu großem Ergebnis gibt es keinen Upload.

### B5 – Haltezeit bei Änderung während eines fehlgeschlagenen Laufs
- **Änderung:** Das `finally` in `src/renderer/state/confluence-live-sync.ts:186-191` plant mit `Math.max(debounceMs, holdUntil - now())`.
- **`syncNow`:** Ein ausdrückliches „Jetzt synchronisieren“ während des Laufs wird über das neue Flag `asked` (`:76`, `:203`) nicht zurückgehalten. Die Server-Pause greift weiterhin über `schedule()`.
- **Tests (`tests/unit/renderer/confluence-live-scheduler.spec.ts:103-170`, Fake-Clock):**
  - Änderung während eines blockierten Laufs, Ergebnis `failed`: kein Versuch bis zum Ablauf der Haltezeit, dann genau einer mit dem neuesten Stand.
  - `syncNow` wird nicht gehalten.
  - Der Erfolgsfall läuft mit normaler Pause.
  - Retry-After bleibt vorrangig.
- **Gegenprobe:** Mit `hold = 0` schlägt der erste dieser Tests fehl. Die Mutation ist entfernt.

### B7 – Zu großes PNG
- **Änderung:** Eigene Meldung mit Seitenname und 10 MiB (`:1158`). Steuerzeichen im Namen werden bereinigt; ein leerer Name wird durch die Position ersetzt. Keine neue Bildpipeline.
- **Übersetzungen:** Drei neue Einträge in `src/renderer/i18n/en.ts` (Bild zu groß, Kapazität, Dateipfad). Der bestehende `i18n-coverage`-Test verlangt sie.
- **Tests (`:1181`):** 10 MiB + 1 Byte wird mit Seitenname und Limit abgelehnt, ohne Request, auch für die passenden Seiten. Exakt 10 MiB wird veröffentlicht.

## Geänderte Dateien
- `electron/plugin-service.ts`
- `src/renderer/state/confluence-live-sync.ts`
- `src/renderer/i18n/en.ts`
- `tests/unit/confluence-live-service.spec.ts`
- `tests/unit/renderer/confluence-live-scheduler.spec.ts`

Unverändert: `confluence-live-image.ts`, CRDT, `main.ts`, Handshake, alle Originaldateien, Ledger, Graph, Concerns. `npm run build` hat die unversionierten Ausgaben `dist/`, `dist-electron/` und `dist-mcp/` neu erzeugt.

## Prüfläufe

| Befehl | Ergebnis |
|---|---|
| `npx vitest run --config vitest.config.ts tests/unit/renderer/confluence-live-scheduler.spec.ts tests/unit/confluence-live-service.spec.ts` | 2 Dateien, 57/57 bestanden |
| derselbe Befehl mit den zwei temporären Mutationen | 8 fehlgeschlagen, 49 bestanden (erwartet) |
| `npx vitest run --config vitest.config.ts` mit Service-, `plugin-service`-, Scheduler-, Image-, Store-, Domain- und `i18n-coverage`-Spec | 7 Dateien, 137/137 bestanden |
| `npm run typecheck` | ohne Fehlerausgabe beendet |
| `npm run build` | Renderer, Electron und MCP gebaut; nur die bekannte Chunk-Größen-Warnung |

Nicht ausgeführt: native Electron-Tests, UI-/Storybook-Tests, CRDT-, Security- und Design-System-Suiten, vollständiger Unit-Lauf.

## Abdeckung

**Integration, 33 Einträge:** Jede Änderung jeder Datei ist gelesen.
- **Vollständig als Datei gelesen:** `close-handshake.ts`, `plugin-service.ts`, `persistence.ts`, `confluence-live.ts`, `confluence-live-image.ts`, `confluence-live-sync.ts`, `plugin-bridge.ts`, `PluginSettings.vue`, `confluence-fixture.ts`, `tests/electron/confluence-live.spec.ts`, `tests/ui/confluence-live.spec.ts`, `confluence-live-service.spec.ts`, alle vier Renderer-Confluence-Specs, `document-cache.spec.ts`, `tests/unit/domain/confluence-live.spec.ts`.
- **Alle Änderungshunks gelesen, unveränderter Rest nicht:** `main.ts` (Zeilen 1–379 außerhalb der Hunks), `whiteboard.ts` (zusätzlich Close-, Plugin- und Install-Pfade), `preload.ts`, `types.ts`, `atlassian.ts`, `index.ts`, `plugins.ts`, `panels.stories.ts`, `WorkspacePage.vue`, `with-whiteboard.ts`, `en.ts`, `contract.ts`, `backend-shell.spec.ts`, `crdt.spec.ts`, `security-and-ipc.spec.ts`, `design-system.spec.ts`.
- **Ausnahmen:** keine ungelesene Änderung. `integration-source-diff.txt` habe ich nicht separat gelesen, weil ich die Dateien selbst gelesen habe.

**Original, 22 Einträge:** Grundlage ist ausschließlich Roots `original-source-diff.txt`; direkter Zugriff war gesperrt.
- **16 hash-identische Einträge** erben die jetzt vollständige Prüfung. Die fünf oben geänderten Dateien sind im Original nicht mehr bytegleich: Dort bestehen B1, B2, B4, B5 und B7 unverändert fort.
- **Sechs abweichende Einträge, vollständig verglichen:**

| Datei | Befund |
|---|---|
| `electron/main.ts` | Alle #210-Zeilen sind im Kandidaten enthalten. Das Aufräumen in `before-quit` ist durch `will-quit` (#218) bewusst ersetzt. |
| `src/renderer/App.vue` | `behindModal` steht funktionsgleich in `WorkspacePage.vue`. |
| `src/renderer/components/PluginSettings.vue` | Skript gleich bis auf Import und Kommentare. Template durch `AppButton`/`AppTextField`, CSS durch Tokens ersetzt. Alle Test-IDs und Aktionen vorhanden. |
| `src/renderer/i18n/en.ts` | Alle 64 Einträge im Kandidaten vorhanden; die langen Zeilen sind per Suche bestätigt. |
| `src/renderer/state/whiteboard.ts` | Alle Hunks identisch; der Kandidat ergänzt nur den #217-Kommentar. |
| `tests/electron/confluence-live.spec.ts` | Per `diff` exakter Präfix des Kandidaten. Dieser ergänzt nur zwei Importe und die Zeilen 376–735. |

Verlorene Funktionalität: keine gefunden.

**Neue Beobachtungen aus der Restlektüre, ohne Änderung:**
- Die Jira-Deinstallation entfernt alle Live-Links des Profils ohne Hinweis in der Oberfläche (`PluginSettings.vue:295`). Das ist der festgelegte Vertrag, aber eine UX-Lücke.
- Der Knopf „Externe Version laden“ (`:310`) ist bei ungespeichertem Stand gesperrt. Damit kann er einen offenen Schließen-Dialog nicht unbeantwortet verwerfen; das stützt die frühere Einschätzung zu B6.
- `confluence-live-store.spec.ts` und `tests/ui/confluence-live.spec.ts:150` arbeiten mit echten Wartezeiten und können unter Last schwanken.
- `confluence-live-image.spec.ts:62` behauptet im Kommentar ein `<title>`, prüft es aber nicht.

## Grenzen
- **B3 / #219:** Unverändert. Datei und Git haben Vorrang vor dem Cache; die explizite Recovery ist weiterhin nicht an die Oberfläche angebunden. Nicht als erledigt beansprucht.
- **B6 / #220:** Unverändert und nicht nativ reproduziert. Nicht als erledigt beansprucht.
- **Die #217-Registrierungsbeobachtung** bleibt offen.

## Verbleibende Lücken
- Die native Abnahme muss mit frischem Build wiederholt werden, weil Main-Bundle und Renderer geändert sind. Der Schritt „Jira speichern“ bei laufender Veröffentlichung wäre ein passender nativer Fall für B1.
- Der Ausweg bei erreichter Kapazität ist das Neuverknüpfen. Das setzt die Besitznachweise bewusst zurück; eine feinere Bereinigung gibt es nicht.
- B7 wird erst im Main-Prozess abgelehnt. Der Renderer rastert und überträgt das zu große Bild vorher weiterhin.
- Zwei Einstellungsoperationen gleichzeitig können sich weiterhin gegenseitig überschreiben, weil sie denselben Schnappschuss von `this.config` nutzen. Das ist vorbestehend und betrifft die Live-Links nicht mehr.
- Die Tenant-Punkte aus dem Erstreview bleiben offen: Layout-Seiten, Zwei-Geräte-Konflikt, Neustart mit bestehender Verknüpfung.
