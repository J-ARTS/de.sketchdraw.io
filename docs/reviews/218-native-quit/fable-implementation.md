# #218 – Beenden nach dem Schließ-Handshake: Umsetzungsbericht

- Ticket #218, Fortsetzung der Session `64f445c3-ea0d-4cab-9925-03e9d2364df9` (Claude Code, `claude-fable-5-2`, angefordert: high). Zeit, Tokens, Kosten: unbekannt.
- Nicht getan: Commit/Push, GitHub, Ledger/Graphify, echte App, echtes Profil, Tenant, lange #210-Tests, #217-Test.
- `src/crdt/persistence.ts` unverändert (`581dd836…`).

## Ergebnis in Kürze

Die Anwendung beendet sich nach bestätigtem Schließen jetzt von selbst. Ein abgebrochenes Beenden lässt Anwendung
und Plugins unverändert weiterarbeiten. Belegt durch drei native #218-Tests im isolierten Fixture (macOS), jeweils
ohne Signal und ohne `app.exit`, sowie Unit-Tests, Typecheck und Build. Keine Aussage zu echtem Tenant oder Release.

## Ursache (bestätigt)

1. `app.quit()` löst `before-quit` aus; dort wurden Plugins und Direktdienste sofort beendet.
2. Das Fenster verhindert sein `close` und fragt die Seite. Electron gibt den Quit damit auf.
3. Antwortet die Seite `close`, schließt nur das Fenster. Auf macOS beendet `window-all-closed` die Anwendung
   nicht, und niemand erinnerte sich an den Quit. Ergebnis: kein Fenster, Prozess lebt (Roots Rot-Beleg).
4. Brach die Person ab, blieben die Plugins trotzdem beendet.
5. Jeder weitere Quit erzeugte eine neue Request-ID und eine neue Anfrage an die Seite. Die Antwort auf die erste
   wurde dadurch ungültig; während eines laufenden Speicherns beantwortet die Seite die neue Anfrage mit `cancel`.

## Lebenszyklus jetzt

- **Quit-Absicht merken:** `before-quit` setzt `quitRequested`. Sie bleibt, solange die Seite entscheidet.
- **Fortsetzen:** Nach bestätigtem Schließen meldet Electron `window-all-closed`; ist die Absicht gesetzt, ruft
  `main.ts` dort `app.quit()` auf. Jetzt gibt es kein Fenster mehr, Electron läuft durch `will-quit` und `quit`.
- **Abbruch löscht die Absicht:** Antwortet die Seite `cancel` (Abbrechen, Authority-Fehler), bleibt das Fenster
  offen und die Absicht ist weg. Ein späteres reines Fensterschließen beendet die Anwendung auf macOS nicht.
- **Eine offene Frage:** Solange die Seite entscheidet, hält ein weiteres Schließen oder Beenden dieselbe
  Request-ID. Es geht keine zweite Anfrage an die Seite.
- **Seite weg oder nicht bereit:** Bei Navigation oder Absturz ist die offene Frage hinfällig (`reset`), ebenso
  wenn die Seite noch lädt und nicht gefragt werden kann. Beides zählt als Ablehnung und blockiert keinen späteren
  Versuch. Ein Fenster schließt weiterhin nie ohne Bestätigung der Seite.
- **Aufräumen einmal bei `will-quit`:** Plugins und Direktdienste enden erst, wenn der Quit wirklich stattfindet.

Speichern/Verwerfen/Abbrechen, die Authority-Prüfungen der Seite und die ID-Prüfung des Handshakes sind unverändert.
Kein `app.exit`, kein Timeout, keine Wiederholung.

## Geänderte Dateien

| Datei | Änderung |
| --- | --- |
| `electron/close-handshake.ts` | offene Frage bleibt bei Wiederholung; `closeRefused`-Rückruf; `sendCloseRequested` meldet, ob jemand gefragt wurde; `reset` verwirft die offene Frage |
| `electron/main.ts` | `quitRequested`; `before-quit` merkt, `window-all-closed` setzt fort; Aufräumen bei `will-quit`; `reset` bei Navigation/Absturz |
| `tests/unit/platform/security-and-ipc.spec.ts` | bestehender Test angepasst (Rückgabewert), 4 neue Handshake-Tests |
| `tests/electron/confluence-live.spec.ts` | 2 neue native #218-Tests hinter Roots Regression; Roots Tests und `quitNormally` unverändert |

Kein eigener Lifecycle-Helfer: Die Absicht ist ein Boolean in `main.ts`; die prüfbare Logik liegt im Koordinator.

## Tests

Unit (`npx vitest run --config vitest.config.ts tests/unit/platform tests/unit/desktop-review.spec.ts tests/unit/desktop-security.spec.ts`): 7 Dateien, 43/43.
Neu: wiederholtes Schließen hält eine Frage und die erste Antwort gilt; Abbruch meldet genau eine Ablehnung, danach
neue ID; nicht zustellbare Frage blockiert nicht; `reset` verwirft die Frage und eine späte Antwort schließt nichts.

`npm run typecheck`: bestanden. `npm run build`: bestanden.

Nativ, nur `--grep "#218"` (eigenes Profil, eigene Session, eigenes MCP-Runtime-File, nur Fixture-HTTP):

1. Roots Regression „a saved empty application exits normally".
2. Neu: ungespeicherte Änderung, Beenden, zweimal erneut Beenden → genau eine Anfrage an die Seite; Abbrechen;
   danach veröffentlicht der echte Plugin-Dienst weiter (Upload 3, Status `synced`), Prozess lebt mit einem Fenster;
   erneut Beenden, erneut Beenden, „Speichern", nochmals Beenden → Exit-Code 0 ohne Signal, Datei enthält alle drei
   Rechtecke.
3. Neu (nur macOS): abgebrochenes Beenden, dann nur Fenster schließen und Verwerfen → Prozess lebt 3 s ohne
   Fenster; `activate` öffnet ein Fenster, Plugin-Dialog antwortet; Beenden → Exit-Code 0 ohne Signal.

| Lauf | Stand | Ergebnis |
| --- | --- | --- |
| 1 | Fix | 3/3 |
| Kontrolle | Vorstand, Hashes gleich `source-before.json` | 0/3: Test 1 kein Exit nach 20 s; Test 2 drei Anfragen statt einer; Test 3 ohne Aussage (Zeichnen gestört) |
| 2 | Fix | 1/3: Test 2 und 3 scheiterten beim ersten Zeichnen, vor jedem Quit |
| einzeln | Fix, Test 3 | 1/1 |
| 3 | Fix | 3/3 |
| 4 | Fix, `--repeat-each=3` | 9/9 |
| Mutation A | Aufräumen wieder bei `before-quit` | Test 2 rot: Uploads bleiben 2 (ein Lauf davor am Zeichnen gescheitert) |
| Mutation B | Ablehnung löscht die Absicht nicht | Test 3 rot: Exit-Code 0 nach reinem Fensterschließen |
| Abschluss | Fix, `--repeat-each=2`, nach vollem Build | 6/6 |

Nach Kontrolle und Mutationen wurden `main.ts` und `close-handshake.ts` hash-gleich wiederhergestellt.

Zur Störung beim Zeichnen: Die Diagnose des `draw`-Helfers zeigt mitten im Ziehen ein `lostpointercapture` mit
`buttons: 0`, danach ist der Entwurf weg. Das sieht nach einem echten Mausereignis auf diesem Desktop aus, nicht
nach dem Lebenszyklus; belegt ist nur das Ereignis, nicht seine Quelle. Test 3 zieht deshalb nicht mehr, sondern
legt die ungespeicherte Änderung über „Seite hinzufügen" an. Test 2 und die bestehenden #210/#217-Tests ziehen
weiter und können davon betroffen sein.

Berichte der Läufe: `/tmp/sketchdraw-218-fable-final.json`, `…-run3.json`, `…-run4.json`, `…-mutation-a.json`,
`…-mutation-b.json`. Lauf 1, die Kontrolle und Lauf 2 liefen mit dem Listen-Reporter ohne Datei.

## Hashes (SHA-256)

```
ab588c3f73215c971a90a96475b97f26d1c1769bf79a22084e29e82c3139b71c  electron/main.ts                 (vorher dcce42fa…)
43533a2aef335649132a8fd603c84c426bf813a751fd9f002715a3b841cdd35e  electron/close-handshake.ts      (vorher 2f3506fb…)
71261ea8391a1a7093cde3d08e4e1012ed167b900b78a448eef10b12eb8f71c5  tests/unit/platform/security-and-ipc.spec.ts
8f9f349e70b28388fd75ef4e06100f9be1dc38745233337178a19ac3ff2c159b  tests/electron/confluence-live.spec.ts (vorher 4fc3ed10…)
581dd836497f1cd31b8454932cdbf901bffeb990742fad32585f4b4c708c23dd  src/crdt/persistence.ts          (unverändert)
30ed806755c5de5443beb20e5e24bd0ee570ed1f55a4c775c37f03566f94a33a  dist-electron/main.cjs           (Build des Abschlusslaufs)
a4f86f229a0683fa7716766328873807032f704ac637167c1ad4b1d178332169  dist-mcp/server.cjs
```

## Offene Punkte

- **Nur macOS geprüft.** Windows und Linux beenden nach dem Schließen des letzten Fensters wie bisher; der Pfad ist
  dort unverändert, aber nicht gelaufen.
- **#217-Test und #210-Tests nicht von mir ausgeführt.** Der #217-Test scheiterte zuletzt genau am normalen
  Beenden; ob er jetzt durchläuft, zeigt erst Roots Gesamtlauf.
- **Kein Rot-Beleg aus dem Vorstand für zwei Aussagen:** „Plugins nach Abbruch" und „reines Fensterschließen" sind
  über die beiden Ein-Zeilen-Mutationen belegt, nicht über den Vorstand selbst.
- **Beenden während des Ladens** wird abgelehnt und muss wiederholt werden. Vorher ging die Anfrage in diesem
  Moment verloren; das Verhalten ist nicht nativ geprüft.
- **Abgestürzte Seite:** Ein Fenster mit totem Renderer lässt sich weiterhin nicht regulär schließen, weil niemand
  bestätigt. Unverändert und außerhalb dieses Tickets.
- **Asynchrones Aufräumen:** `disposeDirectService()` wartet bei `will-quit` nicht auf sein Ende, wie vorher bei
  `before-quit`. Im Normalfall ist der Dienst schon beim Schließen des Fensters beendet.
- Die Beobachtbarkeit abgelehnter MCP-Registrierungen (#217) ist nicht Teil dieser Änderung.
