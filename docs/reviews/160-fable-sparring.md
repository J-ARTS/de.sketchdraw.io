# Actual Claude Code Fable 5.2 / high review

Session: `2a9cc72f-5168-475f-a7ef-15c121774535`. Read-only review; no tests or implementation by this run. Repository changed during reading, as disclosed in the original response. Two graphify Bash calls were denied by the run's Read/Grep/Glob-only tool permission; direct source review completed. This is a tool-scope restriction, not a user approval request.

# Sparring #160 (Folge zu #144) – Plugin-Marketplace, rein lesend

Nichts editiert, keine Tests, kein Git/GitHub. Der `graphify`-Aufruf wurde in dieser Sitzung nicht freigegeben, ich habe direkt gelesen. Die Hauptursache (H1) ist eine Hypothese, die erst ein echter Electron-Lauf bestätigt.

**Achtung, bewegliches Ziel:** Während der Prüfung wurden `electron/plugin-service.ts`, `main.ts`, `preload.ts`, `src/domain/plugins.ts`, `whiteboard.ts` und zwei Testdateien parallel geändert (mtime 22:10–22:12). Zeilen in diesen Dateien sind Schnappschüsse. `PluginSettings.vue` und `App.vue` waren unverändert, deren Zeilen sind stabil.

## 1. Warum sich Plugins nicht konfigurieren lassen

**Hoch**

- **H1 (Hypothese, stärkster Kandidat):** `PluginSettings.vue:180` und `:195` übergeben die Vue-Entwürfe `git`/`atlassian` (reaktive Proxys) direkt an den Store. Der reicht sie unverändert an `bridge.plugins.configureGit/configureAtlassian` weiter (`whiteboard.ts` ~1702/1708, `preload.ts:257-258`). Unter `contextIsolation` + `sandbox` (`main.ts:425-426`, Electron 44.9) lehnt `contextBridge` Proxys nach meiner Erinnerung mit „An object could not be cloned" ab.
  - Installieren funktioniert, weil dort nur ein String übergeben wird. Das passt genau zu „installiert, aber nicht konfigurierbar".
  - Kein Test deckt es ab: `tests/ui/plugins.spec.ts:35-53` nutzt eine Fake-Bridge und klickt nie „speichern"; `tests/electron/desktop.spec.ts:74` prüft nur die Schlüssel der Bridge.
  - Repro: echte App, gespeichertes Dokument, Plugins → Git → „Git speichern". Oder in den DevTools: `await window.sketchdraw.plugins.configureGit(new Proxy({}, {}))`.
- **H2 (bestätigt):** Jede Rückmeldung ist unsichtbar. `notice()/fail()` (`whiteboard.ts:337-341`) rendern in `.feedback-stack` (`App.vue:107-108`, z-index 30) und in die Live-Region `App.vue:114`. Der Plugin-Dialog ist ein `showModal()`-Dialog mit Scrim (`PluginSettings.vue:79`, `:213`), liegt also darüber und macht den Rest inert. Fehler wie H1, „E-Mail ist ungültig." oder fehlendes Git wirken wie „nichts passiert". Die genaue Überdeckung bitte im Browser nachmessen.
- **H3 (im Ausgangsstand bestätigt, in Arbeit weitgehend behoben):** Es gab keine Deaktivierung des Projekts. Nach „Neu" blieb der alte Ordner aktiv, Konfiguration und Token landeten im alten Projekt und „verschwanden" beim ersten Speichern. Der Renderer-Stand wurde nach Öffnen/Speichern nicht aktualisiert.
  - Restlücke im aktuellen Stand: Mutationen tragen keine Dokumentidentität. `main.ts:262` und `:283` aktivieren den Ordner, bevor der Renderer das Ergebnis annimmt. Verwirft der Renderer es (z. B. Agent-/Peer-Schreibvorgang während des nativen Dialogs), zeigt die Oberfläche Projekt A und der Hauptprozess schreibt nach B.

**Mittel**

- **M1 Tastatur (bestätigt):** Die Tabs haben wanderndes `tabindex` (`:109-111`), aber keinen Pfeiltasten-Handler. Der inaktive Tab ist per Tastatur nicht erreichbar. Dazu fehlen `tabpanel`/`aria-controls`, `:144` ist eine Schein-Tabliste mit einem Tab, `:132` ein verschachteltes `<main>`. Nach Installieren/Deinstallieren/„Konfigurieren" verschwindet der fokussierte Button (`:141-142`, `:165`), der Fokus geht verloren.
- **M2 Entwürfe (bestätigt):** Der Watcher `:44-67` überschreibt die Entwürfe bei jedem neuen Snapshot. Das passiert nach „Verbindung testen" und im aktuellen Stand nach jedem Dokument-Speichern (`whiteboard.ts` ~698). Getippte URL und Token sind dann weg.
  - Die Auswahl wird nur beim Tabwechsel korrigiert (`:69-72`). Nach einem Projektwechsel kann die Liste ein installiertes Plugin zeigen, während rechts „Plugin nicht installiert" steht (`:205`).
- **M3 Kein Ordner (bestätigt):** `:117` ist nur Text, `:141` nur ein deaktivierter Button, es gibt keine Aktion.
  - Im aktuellen Stand ist `pluginSettings` zeitweise `null`; dann zeigt `:116` auf dem Desktop den Hinweis „nur in der Electron-App".
  - Die Store-Aktionen geben ohne Projekt stumm `false` zurück (~1694/1700/1706).
- **M4 Git-Nebenwirkungen trotz „inaktiv" (bestätigt):** `configureGit` führt `git init` und `remote add/set-url` unabhängig von `enabled` aus (~258-261). Ohne Git-Binary lässt sich nicht einmal eine deaktivierte Konfiguration speichern.
- **M5 Sicherheit, direkt durch das Bearbeiten ausgelöst (bestätigt):** Das gespeicherte Token bleibt erhalten, wenn `siteUrl` oder `remoteUrl` geändert wird (~253, ~280). Die Platzhalter `:176`/`:188` fördern das. Ein Tippfehler in der Domain schickt das echte Token per Basic-Auth an einen fremden Host. Zusätzlich ist `http.extraHeader` global gesetzt, nicht auf den Remote-Host begrenzt.
- **M6 (bestätigt):** „Verbindung testen" ist bei gespeichertem Token aktiv (`:195`), der Dienst wirft aber, solange das Plugin inaktiv ist. Aktivieren verlangt wiederum vollständige Daten.
- **M7 (bestätigt):** Die Konfiguration wird vor `persist()` im Speicher geändert. Schlägt das Schreiben fehl (schreibgeschützter Ordner), arbeitet `afterDocumentSaved` mit einem nie gespeicherten `enabled`.

**Niedrig**

- **L1:** `remote` wird weder beim Speichern noch beim Laden gegen ein führendes `-` geprüft und landet als Argument bei `git push/pull`. Geladene Felder werden nicht typgeprüft.
- **L2:** `configure*` setzt fest `installed: true`, installiert also stillschweigend neu.
- **L3:** `refreshRuntime` (~204) verwirft Repository/Branch/Status bei jeder fremden Änderung, etwa beim Speichern von Jira.
- **L4 (Hypothese):** `.config-actions` und `.section-title` haben kein `flex-wrap`; bei 360 px vermutlich Überlauf.
- **L5:** `crypto.randomUUID()` (~221) ohne Import; bitte im Typecheck prüfen.
- **L6 (Hypothese):** IPC-Fehler erscheinen mit dem Präfix „Error invoking remote method …", weil `tm()` nur exakt abgleicht (`i18n/index.ts:47-55`).

Im Ausgangsstand außerdem bestätigt und im aktuellen Stand offenbar behoben: Der verschlüsselte Git-Token gelangte per Spread in den Snapshot an den Renderer, und Laufzeitwerte von Projekt A blieben in Projekt B stehen. Beides sollte ein Test festhalten.

## 2. Semantik „gebündelt installiert"

Empfehlung: Version 2 beibehalten, keine Migration.

- **Standard:** Fehlt die Datei oder der Abschnitt, gilt `installed: true, enabled: false`.
- **Gespeicherter Wert gewinnt:** Ein altes `installed: false` ist nicht von „nie installiert" unterscheidbar und wird als Deinstallation respektiert. Der Preis: In Altprojekten braucht das zweite Plugin einen Klick auf „Installieren".
- **Deinstallieren:** schreibt ausdrücklich `{...DEFAULT, installed: false}`, löscht also Konfiguration und Token.
- **Konfigurieren:** lehnt ab, wenn `installed === false` (L2).
- **Aktivierung:** schreibt nie und startet weder Git noch Netzwerk.
- **Laden:** `enabled` nur bei striktem `true` übernehmen.

Die Alternative (Version 3, altes `false` als „unbestimmt") würde bewusst deinstallierte Plugins einmalig wiederbeleben. Das widerspricht deiner Präferenz.

## 3. Lecks und Sicherheit

- **Ordner-Leck:** siehe H3. Die Wiederverwendung für Geschwisterdiagramme stimmt: gleicher Ordner, kein Neuladen. Die App kopiert keine Zugangsdaten zwischen Ordnern.
- **Pflicht:** die Restlücke aus H3 schließen und M5 beheben.
- **Gastdokumente:** `currentPluginHandle` liefert im aktuellen Stand für Gast/Raum `null`. Das ist richtig so.

## 4. Minimaler Vertrag und Tests

**Vertrag**

1. `install/uninstall/configureGit/configureAtlassian` erhalten die `handleId`. Der Hauptprozess prüft `dirname(handle) === projectFolder` und bricht sonst ab. Die Aktivierung im Öffnen-Handler kann dann entfallen; `getSettings(handle|null)` aus dem Renderer ist der einzige Umschaltpunkt.
2. Der Store baut ein reines Objekt per Feldauswahl (H1).
3. `configureGit`: Repository-Operationen nur bei `enabled`; `ENOENT` als klare Meldung; Zuweisung erst nach erfolgreichem Schreiben (M7).
4. Bei geändertem Host ohne neues Token: Token verwerfen und bei `enabled` ablehnen. Der Header wird auf den Remote-Ursprung begrenzt, `remote` per Regex geprüft.
5. Oberfläche:
   - Beide Tabs bleiben; „Installiert" ist Standard.
   - Rückmeldungen erscheinen in einer Statuszeile im Dialog.
   - Ohne Ordner gibt es einen Hinweis mit Hauptaktion „Dokument speichern…", die Formulare bleiben sichtbar, aber gesperrt.
   - Entwürfe werden nur bei Projektwechsel oder nach erfolgreichem Speichern zurückgesetzt.
   - Tabs bekommen Pfeiltasten/Home/End, der Fokus springt auf die Detail-Überschrift.

**Fokussierte Tests**

- **Dienst:**
  - Ohne Datei sind beide Plugins installiert und inaktiv, es gibt keine Datei und keinen Git-Aufruf.
  - Altes `installed: false` bleibt; Deinstallieren übersteht eine erneute Aktivierung.
  - Der Snapshot enthält kein `encrypted*`.
  - Eine Mutation mit fremder `handleId` schreibt nichts.
  - Deaktiviertes Speichern ruft kein `git init`.
  - Ein Hostwechsel verwirft das Token.
- **Store:**
  - Das Argument von `configure*` übersteht `structuredClone` (fängt H1).
  - „Neu" führt zu `getSettings(null)`; eine veraltete Antwort wird verworfen.
- **Oberfläche:**
  - Pfeiltasten wechseln die Tabs.
  - Der Speichern-Schritt ohne Ordner ist bedienbar.
  - Ein Fehler ist im Dialog sichtbar; die Entwürfe überleben „Verbindung testen".
  - 360 px und Hell/Dunkel bleiben ohne Überlauf.
- **Electron:** ein echter Durchlauf Speichern → Git konfigurieren.

## Restrisiken

- Jira-/Confluence-Aufrufe bleiben ohne `handleId` an den Renderer-Abgleich gebunden.
- Der Geheimtext ist nicht an Ordner oder Host gebunden. Eine kopierte oder manipulierte `.sketchdraw-plugins.json` funktioniert auf demselben Rechner weiter.
- Ein fremder Projektordner mit `.git` und `enabled: true` löst beim Speichern Git samt Hooks aus.
- Eine unlesbare oder neuere Konfigurationsdatei wird beim nächsten Speichern überschrieben.

## Codex disposition

- H1: independently reproduced with actual Electron44.9 sandbox/contextIsolation: a plain object crosses contextBridge, a Proxy throws “An object could not be cloned.” Evidence: 160-electron-proxy-probe.json. Plain DTO fix and full native product save regression required.
- H2/H3/M1–M3/M6/M7: independently confirmed configuration/feedback/context/draft problems; fixes and tests in #160.
- M5/L1: evaluate credential endpoint changes and Git remote option validation in bounded configuration fixes.
- M4: explicit Git configuration historically initializes the requested project folder; user authorized that behavior. Keep this, while default installation/reading performs no initialization or network access.
- L2: UI never configures an uninstalled plugin; reject direct service requests as a small invariant where feasible.
- L3: resetting status metadata is accepted until fresh status lookup; cross-project metadata must not persist.
- L4/L6: require UI/runtime evidence; not confirmed by static review alone.
- L5: global crypto is supported by the current Node target; typecheck decides, no speculative import change.
- Existing version2 installed:false stays false; no forced reinstall migration.
- Restrisks about untrusted repository hooks and unreadable/newer configuration files are not new regressions; track separately if not resolved here.

## Final Codex disposition (local acceptance)

The actual read-only Fable review above is preserved verbatim. Implementation was performed by Codex root and delegated Codex agents after two additional Claude UI attempts were interrupted without source edits. Those attempts are not successful implementations: `160-ui-fable-interrupted.json`, `160-ui-resume-interrupted.json`. The resume requested Sonnet5.5/high but emitted no new model output and retained only cumulative Fable usage, so no Sonnet implementation or independent token cost is claimed.

- H1/H2: real Electron product test now saves both Git and Jira via the isolated preload bridge; an invalid HTTP Atlassian URL produces a visible error inside the dialog and leaves the draft editable. The earlier standalone Proxy probe establishes the underlying serialization failure.
- H3: Main no longer changes plugin authority during a speculative Open/Save. The renderer explicitly activates only an accepted local file, clears authority for new/import/guest documents, and ignores old responses. Native folder-reuse/folder-isolation and service/store regressions pass.
- M1/M2/M3/M6: installed-first navigation, keyboard tabs and focus, separate drafts, save-document CTA, and disabled test/sync actions until configuration is persisted and active are covered by UI tests.
- M5/L1/L2/M7: endpoint-bound credentials, URL-scoped Git headers with redirects disabled, remote validation, explicit installed state, and assignment only after atomic configuration persistence are implemented and unit-tested. Independent EISDIR reproduction confirms zero remote requests after a failed configuration save.
- L3: an explicit status refresh can refill transient Git metadata; no cross-project stale status is retained.
- L4: Chromium UI and axe checks pass at 360/960/1280 px in both themes. Screenshots reviewed independently and by root.
- L5: an explicit `node:crypto` import is present; full typecheck passes.
- L6: actual IPC failures are visible in the dialog. Electron's technical prefix may remain in the supplied error text; no complete error-localization redesign is claimed.
- Three further independent UI findings were fixed and regression-tested: inherited fieldset disability in focus traversal; a prior project's pending request blocking a new project or clearing its newer pending request; and invalid DSL drafts being reported as cancelled file dialogs.
- Existing explicit `installed:false` stays false. New/no-config project folders start with both plugins installed and disabled. Explicit Git configuration still initializes the folder as authorized by the original user requirement.
- Unknown or corrupt configuration recovery remains a separate planned issue #161. The static code path is confirmed; no runtime recovery or fix is claimed here. Existing untrusted-repository hooks and manually copied same-machine ciphertext are outside this configuration/UI task.

Final commands, outcomes, source hashes and remaining integration limits: `160-local-validation.json` and `160-plugin-marketplace-review.md`. This is local acceptance, not a release or a live Jira/Git remote acceptance test.
