# #218 – Unabhängiger finaler Codex-Review

Stand: 2026-11-16T09:54:08.807582+00:00. Arbeitsbaum: `/Users/jeremyteichmann/.codex/worktrees/210-confluence-integration/de.sketchdraw.io`. Umfang registriert in #218, Kommentar 6913042843. Reviewer: Codex-Subagent `live_correction_review`; keine Implementierung oder Testausführung durch diesen Reviewer.

## Ergebnis

**Kein offener materieller Produktbefund im begrenzten Lifecycle-Review.** Ein P2-Konflikt im vorhandenen Backend-Test wurde an Root gemeldet, durch dessen anschließende reine Teständerung behoben und durch die vollständige native Backend-Suite bestätigt: **4/4 bestanden, Exit 0**, Dauer 13.279 s. `backend-report.json` wurde anschließend gelesen; 0 fehlgeschlagen, 0 flaky.

Roots separater nativer Gesamtlauf ist inzwischen terminal: **6/6 bestanden, Exit 0**, Ende 09:52:16.145800Z. Er umfasst #210, #217 und #218 einschließlich des echten Prozessneustarts im isolierten Fixture. Dies ist keine Aussage zum echten Confluence-Tenant oder zum Neustart der Nutzer-App.

## Befund und Korrektur: CF-218-01 / P2

Im eingefrorenen `tests/electron/backend-shell.spec.ts:363–387` erwartete `requestClose(2)` nach zwei `BrowserWindow.close()` ohne Antwort eine zweite Nachricht/neue ID. Der neue Vertrag in `electron/close-handshake.ts:55–56` hält dagegen genau eine offene Anfrage und ID. Der bestehende Test hätte deshalb auf Nachricht 2 gewartet; seine anschließende Ablehnung der ersten ID entsprach ebenfalls nicht mehr dem Vertrag. Statischer Befund, kein zusätzlicher eigener Testlauf.

Root hat ausschließlich diesen Test korrigiert: erneutes `requestClose(1)` muss dieselbe ID liefern; anschließend wird diese Anfrage mit `cancel` beantwortet. Erst die nächste Anfrage erzeugt Nachricht 2 und eine neue ID. Die Antwort auf die verbrauchte erste ID bleibt abgelehnt; die gültige zweite Antwort muss das Fenster wirklich schließen. Damit sind Wiederholung, Abbruch, ID-Rotation nach Abschluss, Schutz vor veralteten Antworten und bestätigtes Schließen weiterhin abgedeckt. Die Änderung entspricht dem erforderlichen Vertrag, ohne den Sicherheitstest zu entfernen. Finaler Testhash: `656783942cbe98d13b1407b530ed6109a2b32d13ed3ae47eca969796679b0f29`. Roots vollständige Backend-Suite bestätigt die Korrektur mit 4/4 bestandenen Tests; `backend-report.json` wurde gelesen. Der Befund ist damit korrigiert und verifiziert.

## Bestätigte Codeeigenschaften

- **Wiederholung und Bestätigung:** Eine offene Anfrage bleibt bei erneutem Close/Quit erhalten. Nur die aktuelle ID kann einmalig abbrechen oder das Wiedereintritts-Close freigeben. Ungültige und bereits verbrauchte Antworten werden weiterhin zurückgewiesen (`close-handshake.ts:47–92`). Alle gefundenen `sendCloseRequested`-Implementierungen erfüllen den neuen Boolean-Vertrag.
- **Nicht zustellbare Anfrage:** `main.ts:512–517` liefert bei zerstörtem Fenster/WebContents, abgestürztem Renderer oder noch ladendem Hauptframe `false`. Der Koordinator entfernt dann die unbeantwortbare ID und meldet `closeRefused`; das Fenster wird nicht still geschlossen. Nach Ende des Ladens ist ein neuer Versuch möglich. `true` bedeutet Versand, keine zusätzliche Empfangsbestätigung. Die Renderer-Übergänge samt Save/Discard/Cancel- und Authority-Prüfungen bleiben unverändert.
- **Navigation und Absturz:** Hauptframe-Navigation ohne In-Place-Wechsel sowie `render-process-gone` setzen den Koordinator zurück (`main.ts:534–538`). Eine offene Frage wird ungültig, ihre späte Antwort darf nicht schließen. Ein Reset ohne offene Frage meldet keine zusätzliche Ablehnung. Die vorhandene Freigabe des Renderer-Plugin-Kontexts bleibt erhalten.
- **Abbrechen:** Die gültige Cancel-Antwort sowie nicht zustellbare bzw. durch Seitenverlust ungültige Fragen löschen `quitRequested` (`main.ts:525`). Ein tatsächlicher Benutzerabbruch ruft kein `plugins.dispose()` auf; Dienste bleiben verfügbar.
- **Tatsächliches Quit:** `before-quit` merkt die Absicht; nach bestätigtem Fensterschließen setzt `window-all-closed` sie mit `app.quit()` fort. `will-quit` entsorgt die anwendungsweiten Dienste einmal (`main.ts:645–672`). Ein gewöhnliches macOS-Fensterschließen ohne Quit-Absicht behält die Anwendung; `activate` kann das Fenster wieder erstellen. Der vorhandene Vertrag mit einem verwalteten Hauptfenster wird nicht erweitert.

## Quellenbindung

`root-source-before.json` ist der Freeze **vor Roots nativem Gesamtlauf**, nicht der Produktstand vor #218. Zeitpunkt: `2026-11-16T09:50:15.123235+00:00`. Beim ersten Review-Abgleich stimmten alle **512 Dateien** überein. Roots `root-source-after.json` bestätigt nach dem nativen Gesamtlauf ebenfalls 512 geprüfte Dateien ohne Änderung. Beim abschließenden Review-Abgleich ist ausschließlich die oben beschriebene, von Root angekündigte Backend-Testkorrektur abweichend; die übrigen 511 Einträge bleiben identisch.

| Datei | Finaler SHA-256 |
| --- | --- |
| `electron/main.ts` | `ab588c3f73215c971a90a96475b97f26d1c1769bf79a22084e29e82c3139b71c` |
| `electron/close-handshake.ts` | `43533a2aef335649132a8fd603c84c426bf813a751fd9f002715a3b841cdd35e` |
| `src/crdt/persistence.ts` | `581dd836497f1cd31b8454932cdbf901bffeb990742fad32585f4b4c708c23dd` |
| `tests/unit/platform/security-and-ipc.spec.ts` | `71261ea8391a1a7093cde3d08e4e1012ed167b900b78a448eef10b12eb8f71c5` |
| `tests/electron/confluence-live.spec.ts` | `8f9f349e70b28388fd75ef4e06100f9be1dc38745233337178a19ac3ff2c159b` |
| `tests/electron/backend-shell.spec.ts` | `656783942cbe98d13b1407b530ed6109a2b32d13ed3ae47eca969796679b0f29` |

Der tatsächliche Vor-Fix-Nachweis `source-before.json` führt Main `dcce42fad5ec3764edc15ce1f95f22460d02cde32385d8b692ae2a464fc1ba0b` und Handshake `2f3506fba62c1423fed915797ee72759e87476e3f15f3ab98b6163256c8ae65b`. Der separat abgenommene Persistenzfix **581dd836…** bleibt unverändert. Fables vorübergehende historische Rücksetzung für den kontrollierten Gegenlauf ist kein Rückfall; die Produktdateien stimmen wieder mit dem finalen Freeze überein.

## Nachweise und Grenzen

- `fable-implementation.md` und `fable-result.json` gelesen: tatsächlicher Claude-Code-Lauf, Session `64f445c3-ea0d-4cab-9925-03e9d2364df9`, Modell `claude-fable-5-2`, terminal `success`, `is_error=false`. Fable berichtet 43/43 fokussierte Units, Typecheck und Build; keine eigene Wiederholung.
- Vorhandene Fable-JSON-Berichte zu Abschluss, Läufen 3/4 und Mutationen A/B gelesen. Abschluss: 6 erwartet, 0 fehlgeschlagen, 0 flaky; Start 09:47:28.784Z, Dauer 41.297 s. Die beiden Mutationsberichte enthalten jeweils den vorgesehenen fehlgeschlagenen Test. Die wiederhergestellten Produkt-Hashes stimmen überein.
- `root-native-run.json`, `root-native-summary.json`, `root-native-report.json` und `root-source-after.json` gelesen: terminaler Root-Lauf mit 6 bestandenen Tests, 0 fehlgeschlagen, 0 flaky; keine Quelländerungen während des Laufs. Der #217-Test erreicht nun den normalen Exit, Neustart und die anschließende erneute Bearbeitung im isolierten Fixture.
- Die #218-Tests prüfen Exit-Code 0 ohne Signal, echte Fixture-Veröffentlichung nach Cancel, einmalige Close-Frage bei Wiederholung, gespeicherte Änderungen und macOS-Reaktivierung. Cleanup dient nicht als Erfolgsnachweis. Der dritte Test verwendet eine zweite Seite als ungespeicherte Änderung; die Quit-Assertions bleiben erhalten.
- Native Nachweise gelten für macOS. Lade-/Navigations-/Crash-Randfälle wurden hier statisch und anhand der vorhandenen Koordinator-Unit-Verträge geprüft, nicht zusätzlich nativ ausgeführt. Ein bereits abgestürzter Renderer verhindert weiter ein reguläres Schließen; dies bleibt der dokumentierte vorhandene Schutzvertrag. Asynchrones Direct-Service-Disposal wird wie zuvor nicht bis zum Prozessende abgewartet.
- Keine eigene Test-, Build-, UI-, Tenant-, Profil- oder Credential-Aktion. Nur diese Review-Datei geschrieben; Produkt, Tests, Ledger, Graph und GitHub nicht durch diesen Reviewer verändert. Keine Aussage zu echtem Tenant-Neustart, Zielbranch-Integration, Release oder Ticketabschluss. Der nachgereichte Backend-Ausführungsnachweis ist geprüft; kein offener Befund aus diesem Review.
