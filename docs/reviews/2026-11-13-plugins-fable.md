# Tatsächliches Claude-Code-Sparring: Plugins — 13.11.2026

Unveränderter Abschlussbericht des externen Reviews. Modell: `claude-fable-5-2`; Aufwand: `high`; Werkzeuge: Read/Glob/Grep; keine Schreib- oder MCP-Werkzeuge. Die Befunde sind unabhängige Review-Ergebnisse, noch keine bestätigten Laufzeitreproduktionen. Anschließende Codex-Entscheidungen und Prüfungen stehen in `2026-11-13-plugins-audit.md`.

---

**Review #161 / #168 / #165** – Modell `claude-fable-5-2`, nur gelesen, keine Änderungen, keine GitHub-Aktionen. Ich habe nichts ausgeführt: keine Tests, kein Hash-Abgleich, und die Graphify-CLI war ohne Shell nicht nutzbar, daher direkte Lektüre. Alle Befunde stammen aus dem Codepfad und sind nicht zur Laufzeit reproduziert.

## Findings

**P1 – Alte Ordnerdatei wird nur auf Typen geprüft und aktiv ins app-weite Profil übernommen (#161, #168)**
- **Ort:** `electron/plugin-service.ts:120-136` (`parsePluginConfig`), `:427-442` (`adoptLegacyProjectConfig`).
- **Fehler:** Geprüft wird nur `typeof`. `git.remote`, `git.remoteUrl`, `atlassian.siteUrl`, `enabled` und `autoPush` kommen unverändert ins Profil. Die Regeln aus `configureGit` (`:486` Remote-Regex, `normalizeGitRemoteUrl`) greifen auf diesem Pfad nicht; euer eigener Test (`plugin-service.spec.ts:505`) behandelt `--upload-pack=…` als abzuwehrenden Wert.
- **Reproduktion:** Unkonfiguriertes aktives Profil (Normalfall nach dem Upgrade und bei jedem neuen Profil). Ordner in einem Git-Repository mit `.sketchdraw-plugins.json`, darin `git.enabled/autoCommit/autoPull/autoPush: true` und `remote` als Option oder fremde URL. Diagramm öffnen genügt:
  1. Die Übernahme setzt `git.enabled`.
  2. Der Renderer startet daraufhin `watchDocument` (`whiteboard.ts:1777`).
  3. Der 60-s-Timer (`:673`) ruft `gitSync` auf, also Commit, `git pull --ff-only <remote>` und `git push <remote>` (`:659`); beim Speichern zusätzlich `:649`, beim Status-Fetch `:589`.
- **Konsequenz:** Eine Datei aus einem geklonten oder geteilten Ordner schaltet Git-Automatik ohne Nutzeraktion ein. Der Wert landet als Argument bei Git (Optionsinjektion, beliebige Push-Ziel-URL, also Abfluss des Repositories). Die Einstellung gilt danach dauerhaft für jeden weiteren Ordner.
- **Fix:**
  - Werte beim Laden mit denselben Normalisierern wie in `configure*` prüfen, sonst `invalid-data`.
  - Alte Dateien immer mit `enabled: false` übernehmen und im Dialog melden.
  - Remotes hinter `--end-of-options` übergeben oder gegen `git remote` abgleichen.
- **Test:** Alte Datei mit `remote: '--upload-pack=x'` bzw. URL; erwartet wird ein Konfigurationsproblem, und der `runGit`-Mock sieht den Wert nie.

**P2 – Zweite App-Instanz überschreibt Profile still (#161, #168)**
- **Ort:** `plugin-service.ts:299-316` (`mutateStore`).
- **Fehler:** Geschrieben wird immer der komplette Stand im Speicher, ohne Abgleich mit der Datei. Im Repo gibt es kein `requestSingleInstanceLock`.
- **Reproduktion:** Zwei Instanzen starten (unter Windows/Linux vermutlich schon durch einen `sketchdraw://`-Link bei laufender App). In A ein Profil mit Token anlegen, in B irgendeine Plugin-Einstellung speichern. A's Profil fehlt danach in `plugins.json`.
- **Konsequenz:** Genau der Verlust, den #161 ausschließen soll, nur über einen veralteten Stand statt über einen Parse-Fehler.
- **Fix:** Vor dem Schreiben mtime/Hash mit dem Ladestand vergleichen; bei Abweichung neu lesen und gesperrt bleiben.

**P2 – Echter Schreibfehler ist nicht mehr getestet (#161)**
- **Ort:** `tests/unit/plugin-service.spec.ts:435-448`.
- **Fehler:** Der Test nutzt `configPath` als Verzeichnis. Seit #161 ist das ein Lesefehler und endet in der Sperre; `rejects.toThrow()` ohne Text besteht trotzdem.
- **Ungetestet bleibt:** Laden gelingt, `writeFile`/`rename` schlägt fehl. Dabei sind in `configureGit` `git init` und `remote set-url` schon gelaufen (`:499-509`), bevor das Speichern scheitert.
- **Test:** Nach erfolgreichem Laden `mkdir(configPath)`, dann speichern. Erwartet: Ablehnung, Snapshot unverändert, keine `*.tmp` übrig. Die Git-Reihenfolge bewusst entscheiden oder dokumentieren.

**P3 – Wiederherstellung nur per Neustart, und unsichtbar außerhalb der Dialoge (#161)**
- **Ort:** `plugin-service.ts:254` (Ladeergebnis dauerhaft gecacht), `:257-261` (Texte).
- Ein vorübergehender Lesefehler (z. B. `EBUSY` durch Virenscanner) sperrt die ganze Sitzung; `spec:297-311` schreibt das so fest.
- Bei `unsupported-version` rät der Text zu „reparieren“ statt zum App-Update; Beiseitelegen kostet alle Profile und Tokens.
- Im gesperrten Zustand laufen alle Plugins still mit Standardwerten (Autosync aus). Einen Hinweis gibt es nur in den zwei Dialogen.
- **Fix:** „Erneut laden“ im Dialog (liest nur), eigener Text je Problemart, einmalige Meldung beim Start.

**P3 – Renderer verwirft das Ergebnis eines Profilwechsels ohne Abgleich (#168)**
- **Ort:** `src/renderer/state/whiteboard.ts:143`.
- **Reproduktion:** Profilwechsel läuft, währenddessen „Neu“. `getSettings(null)` liefert noch das alte Profil, der Wechsel wird danach im Dienst wirksam, der Renderer ignoriert ihn. Das Menü zeigt das alte Profil, und die Auswahl des alten Profils kehrt ohne Aufruf zurück (`:1783`).
- **Konsequenz:** Heilt beim nächsten Refresh (Plugin-Dialog, Speichern); `ProfileDialog` lädt beim Öffnen nicht neu. `plugin-store.spec.ts:246-256` prüft nur die fehlende Meldung.
- **Fix:** Im Abbruchzweig `void store.refreshPluginSettings()`.

**P3 – Kleinere Punkte**
- **Rennen im Dienst (#168):** `saveConfig` ersetzt Git und Jira gemeinsam aus dem Stand des Aufrufers (`:319-322`). Die Unkonfiguriert-Prüfung der Übernahme liegt außerhalb der Schreibwarteschlange (`:439-440`). `deleteProfile` bestimmt `wasActive` vor der Warteschlange (`:395`). Über die Oberfläche durch `pluginBusy` praktisch nicht erreichbar; Prüfungen gehören in den Mutations-Callback.
- **Übersetzung (#161):** Die neuen Problemtexte haben keinen Eintrag in `en.ts`; `tm()` zeigt sie im englischen UI deutsch.
- **Stille Übernahme (#161):** Scheitert das Speichern der übernommenen Ordnerdatei, wird das verschluckt (`:440`).

**Ohne Befund:**
- **#161:** Trennung fehlend/Lesefehler/JSON/Version/Daten; Sperre aller Schreibpfade vor Git (`:482`, `:301`); Original und `.unreadable` bleiben unberührt; es gibt keinen Schreibpfad auf die Ordnerdatei; Dateiinhalte gelangen nicht in den Snapshot; UI-Sperren in beiden Dialogen.
- **#168:** Tokens erscheinen nicht im Snapshot; die Token-Bindung an die Remote-URL hält; ein Profilwechsel ruft nur lesendes Git auf; Gast- und ungespeicherte Dokumente lösen nichts aus (`whiteboard.ts:132-134`, Dienst `:528`).

## Abschlussbewertung

| Ticket | Bewertung | Grund |
| --- | --- | --- |
| #161 | nicht abschlussreif | P1 betrifft die Schemaprüfung selbst, dazu die zwei P2. Kein Commit, UI/Electron stehen aus, Ticket steht noch auf „Geplant“ ohne Nachweise. |
| #168 | Kriterien laut Code und Tests erfüllt, nicht schließen | Die Übernahme alter Ordnerdateien (P1) ist Teil dieses Vertrags und gehört samt Mehrinstanz-Befund in `docs/concerns.md`. CI auf `main` konnte ich nicht prüfen; Ticket-Text und Checkboxen sind veraltet. |
| #165 | technisch erfüllt, nicht abschlussreif | Die Atlassian-Freigabe ist nicht belegt (`THIRD_PARTY_ICONS.md:59`); der Markenhinweis in `LICENSE:148-150` ist keine Erlaubnis. |

Zu #165 technisch geprüft: Loader, Buchstaben-Rückfall, weiße Kachel, Unit- und UI-Tests in beiden Themes, `LICENSE:135-153`, `electron-builder.json:16`, CSP erlaubt `data:`.

## Restprüflücken

- **`git.svg` unbestätigt:** Die Datei hat `viewBox 0 0 78 78` und einen gedrehten, konstruierten Pfad. Nach meiner Erinnerung hat die offizielle Datei `0 0 92 92` mit Clip-Pfad; das ist ein Verdacht, kein Beleg. Die Hashes in `THIRD_PARTY_ICONS.md` sind gekürzt. Prüfung: `curl -fsSL https://git-scm.com/images/logos/downloads/Git-Icon-1788C.svg | shasum -a 256` gegen die lokale Datei. Weicht sie ab, stimmt „used unmodified“ in `LICENSE` nicht.
- **Namensnennung:** `LICENSE` liegt nur in `app.asar`, ohne sichtbare Stelle in der App. Kein Test sichert den Eintrag in `files` oder den Notices-Abschnitt; im gebauten Installer ungeprüft.
- **Logos im Paket:** Der UI-Test läuft gegen den Dev-Server; im Produktionsbuild und in Electron sind die Logos ungetestet.
- **Fehlende Tests:** Alte Ordnerdatei mit Lesefehler; Erhalt von `credentialRemoteUrl` bei der Übernahme; gesperrter „Installieren“-Knopf.
- **Offen wie im Ticket vermerkt:** Sichere Ablage unter Windows/Linux, echte Git-/Jira-Server.
