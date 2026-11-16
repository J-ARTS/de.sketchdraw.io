# #217: MCP-Zugang nach automatischer Git-Übernahme

Stand: 2026-11-16T08:37:05.479993+00:00. Tatsächlicher Prüfer: OpenAI Codex, Subagent `live_correction_review`. Lesende Diagnose vor Beginn in #210 Kommentar 6911345713 registriert; Archivierung/Koordination in Kommentar 6911436582. Kein Fable-Beitrag zu dieser Diagnose. Der separate [Fehler #217](https://github.com/J-ARTS/de.sketchdraw.io/issues/217) wurde lesend gegen GitHub abgeglichen: offen/geplant, keine Produktkorrektur.

## Bestätigte Beobachtungen

- Vor Git-Übernahme gelang der MCP-Titelwechsel am 2026-11-16T07:54:31.253Z. Nach automatischer Übernahme desselben Dokument-IDs auf Fixture-Commit `6aa1e14df8f67115e9fe577ca0613f5cde676fa7` meldete derselbe offizielle stdio-Adapter gegen 08:20 und erneut um 08:23:57 UTC `ACCESS_DENIED: Sketchdraw Desktop has no open local document`. Die zweite Antwort ist in `tenant-after-git-mcp-read.json` archiviert; die erste Uhrzeit stammt aus Roots Beobachtung.
- Root verwendete den offiziellen Client/StdioTransport mit Node, `args: ['dist-mcp/server.cjs']`, cwd des Integrationsworktrees und `stderr: 'pipe'`; kein expliziter Runtimepfad oder Endpoint wurde übergeben.
- Ausschließlich `lstat` bestätigte am **2026-11-16T08:31:17.877783Z**: Defaultdatei `/Users/jeremyteichmann/Library/Application Support/io.sketchdraw.de/agent-runtime/active-v1.json` existiert nicht (`ENOENT`). Es wurden keine Runtime-Inhalte, Credentials oder Prozessumgebungen gelesen. Root bestätigte bis dahin keinen Neustart und den weiterhin laufenden Prozess PID 99302 (Prozessnachweis 08:30:51 UTC). Das spätere Dateimetadatum beweist keine aktuelle Prozessidentität über einen möglichen nachfolgenden Neustart hinaus.
- Der Git-/Confluence-Livetest ist davon unabhängig erfolgreich: Root hat am 08:19:24.631840Z ausschließlich zum lokalen Bare-Remote gepusht; die App übernahm den Commit automatisch und sauber. Beide geänderten Diagrammbilder sowie die lesbaren Entscheidungsblöcke erschienen im ursprünglichen LiveDoc-Tab ohne Reload, manuellen App-Pull oder Confluence-Sync. Pluginstatus: zuletzt übertragen 09:20 Ortszeit. Belege: `tenant-git-push.json`, `tenant-git-pull-confirmed.json`, `tenant-git-update-page1.png`, `tenant-git-update-page2.png`, `tenant-git-readable-decisions.png`, aktueller `tenant-live-checkpoint.json`.

## Belegte Quellkette und verbleibende Unsicherheit

1. `src/mcp/client.ts:27–30`: Die konkrete Fehlermeldung entsteht beim fehlenden Runtime-Dokument ohne Endpoint-Fallback, **vor** Socket-Authentifizierung und Dokumentanfrage. Sie beweist nicht, dass die App kein Dokument geöffnet hat. `electron/agent-access/runtime-access.ts:59–70` liefert ausschließlich bei ENOENT den dafür maßgeblichen fehlenden Wert; ungültige/private Dateien ergeben andere Fehlertexte.
2. `src/renderer/state/whiteboard.ts:2197–2200`: `acceptExternalDocument` ruft `install` auf. `install` ersetzt die Autorität und benachrichtigt die Authority-Listener (`:910–935`).
3. `src/renderer/design-system/pages/WorkspacePage.vue:88–101`: Alte Agentensitzung wird beendet, neue mit der neuen Autorität angelegt. Eine Ablehnung von `session.ready` wird still behandelt, indem die Referenz geleert wird. Kein automatischer Wiederholungsversuch oder sichtbarer Diagnosezustand ist dort implementiert.
4. `src/agent-access/renderer-session.ts:13–45`: pro Attach neuer Session-Epoch; Control-/Request-Listener werden vor der Registrierung gesetzt. Bei Registrierungsfehler wird die neue Sitzung disposed und abgemeldet.
5. `electron/agent-access/electron-bridge.ts:69–101`: Main serialisiert Register/Unregister, entfernt die bisherige Runtime-Datei vor dem neuen Session-/Grant-Handshake und schreibt erst anschließend die neue Datei. Ein Fehler zwischen Entfernung und erfolgreichem Schreiben ist eine **plausible** Erklärung für eine dauerhaft fehlende Discovery-Datei. Welcher Schritt hier tatsächlich fehlschlug, ist ohne das Registrierungsfehler-/Lifecycleereignis nicht bewiesen. Die bestehende Serialisierung und Epoch-Prüfung belegen keine Abmelderace; eine solche wird nicht als Ursache behauptet.
6. `electron/agent-access/runtime-access.ts:37–50`: Pfad hängt von explizitem Override oder Benutzerverzeichnis ab, nicht von Electron-userData, Git-Projektordner oder Plugin-Profil. Der Profilpfad in `electron/main.ts:623` betrifft `plugins.json`; Plugin-Profilwechsel ändern die MCP-Pfadwahl nicht.

**Ergebnis:** Tatsächlich fehlende lokale Discovery-Datei bei wiederholt fehlgeschlagenem Zugriff; kein belegter bloß vorübergehender Zustand. Der Zusammenhang mit der vorausgehenden Git-Übernahme ist eine bestätigte Beobachtungsfolge, keine deterministisch bewiesene Ursache. Fehlerdiagnose und sichere Wiederherstellung bleiben #217. Der allgemeine Annotation-Umbruch bleibt separat #215.

## Regressionsempfehlung (nicht ausgeführt)

- Den bestehenden nativen Git-Auto-Pull-Test um echten offiziellen MCP-Lese-/Schreibzugriff vor und nach der automatischen Übernahme **desselben Dokument-IDs** ergänzen. Neue Autorität/Verbindung muss erreichbar sein, alte Berechtigungen müssen ungültig werden; kein manuelles Wiederöffnen als verdeckte Voraussetzung.
- Den Registrierungs-/Grant-/Runtime-Schreibfehler gezielt injizieren, geheimnisfreie Diagnose und sichere Wiederanmeldung prüfen. Verspätete Abmeldung einer alten Sitzung darf keine aktuelle Runtime-Datei entfernen; keine Wiederherstellung für P2P-Gäste/fremde Dokumente.
- Abdeckungsgrenze: `tests/unit/mcp/renderer-session.spec.ts:15–58` verwendet eine Ersatzbridge und einen Domain-Controller; der native Produktagententest prüft einen neuen Dokument-Identifier und Neustart, aber keinen Git-Wechsel desselben IDs. `tests/electron/confluence-live.spec.ts:261–285` bestätigt echten Pull und Bildübertragung, fragt danach bislang kein MCP ab. Vorhandene PASS-Ergebnisse werden dadurch nicht rückwirkend geändert.

## Geprüfter Quellstand

Managed-Worktree `codex/210-confluence-integration`, Basis `c572671f1ba17adf957fe4eff1e53457a4c20fc6`, weiterhin lokale uncommitted Änderungen. Die vier Agent-/Runtime-Quelldateien unten haben keine Änderungen gegenüber HEAD. Hashes der lesend geprüften Dateien:

| Datei | SHA256 |
| --- | --- |
| `src/agent-access/renderer-session.ts` | `1b9f18add79f28467d7cfa5e3bec57334219f45175c9f4093547b0f76fcd76db` |
| `electron/agent-access/electron-bridge.ts` | `789e26240025e47049fae2eb2d045d4637d323daef2fb4bf6d45d26141ba7590` |
| `electron/agent-access/runtime-access.ts` | `a986460893c11d3230a509a40e39c579078773f6336e4ec54d55ce35f4bb57d1` |
| `src/mcp/client.ts` | `248944b157cba3d55bef867ca239beb2e20a85c16b25d23e6537ef23a6088c1b` |
| `src/renderer/design-system/pages/WorkspacePage.vue` | `cfdfb294fbdec5e8b3b70a22121e39d22d3f30be7e414d71c47609caa3825d60` |
| `src/renderer/state/whiteboard.ts` | `4dbba88658312bd9257fbc26a8dfa3da5fece3fe40776f21b47a4acc9f05b19a` |

Keine neuen automatisierten Tests, keine Produkt-, UI-, Tenant-, GitHub-, Commit-/Push-/Mergeaktion dieser Delegation. Archivierung schreibt nur diesen Bericht, den kopierten Fehlerbeleg, Ledger/Task und serielle Ledger-Graph-Projektionen. Neustart noch nicht erfolgt: CUA-Quitversuche wirkungslos, anschließend `noWindowsAvailable`; Roots Nutzerfrage zum regulären Beenden ist offen. Nach bestätigtem Beenden Root-Neustartprüfung einschließlich MCP-Anmeldung fortsetzen. Tenant-Konfliktprüfung und Zielbranchintegration bleiben offen. Zeit-/Token-/Kostenmesswerte dieser Codex-Diagnose sind unbekannt und bleiben null.

Ergänzter Root-Prozessnachweis 08:36:34 UTC: PID 99302 und Helper 99303/99304/99305 weiterhin aktiv; noch kein Neustart und keine Nutzerantwort zum regulären Beenden. Dieser spätere Nachweis ändert die bereits erhobene Metadatenbeobachtung nicht.
