# #217 – isolierter Authority-/Git-Reproducer

Stand: 2026-11-16, unabhängiger Codex-Nachweis; keine Fable-Leistung. Genehmigter Scope: Kommentar6911717877. Ausschließlich `/tmp`, reale Produktfunktionen, synthetisches `fake-indexeddb` im Arbeitsspeicher. Keine App, UI, Tenant- oder Runtime-Verbindung, keine Benutzer-Caches oder Zugangsdaten, keine Produkt-/Testdateien verändert.

## Bestätigtes Ergebnis

Ein extern geladenes Git-Dokument mit gleicher Dokument-ID kann durch einen älteren IndexedDB-CRDT-Zustand nach Installation der neuen Authority intern überschrieben werden. Im tatsächlichen Store-Pfad bleibt die Oberfläche beim neuen Titel und `saved`, während der Controller den alten Cache-Titel und Revision1 enthält. Die echte Authority beendet sich mit `AUTHORITY_DIVERGED`.

Der kontrollierte Lauf um08:55:39.019Z bestätigt zusätzlich:

- `authority.bindActor()` scheitert mit `AUTHORITY_DIVERGED`.
- Echter Store-Schließlistener + echter `CloseHandshakeCoordinator`: `preventDefault`, Antwort `cancel`, kein `closeWindow`, kein bestätigtes Schließen.
- `store.save()` wirft `AUTHORITY_DIVERGED`, bevor `bridge.saveDocument()` aufgerufen wird (0Aufrufe).
- Store-Meldung enthält `AUTHORITY_DIVERGED`; `store.dispose()` wirft denselben Fehler.
- Der Low-Level-Pfad aus echter Persistence, Controller und Authority zeigt denselben Cache-Rückfall.

Die Ausgabe beweist den beschriebenen lokalen Produktmechanismus. Sie ersetzt weder den nativen Restarttest noch einen Mitschnitt der konkreten fehlgeschlagenen MCP-IPC-Stufe in der Nutzer-App. Die vorhandene native Meldung und fehlende Discovery-Datei sind damit konsistent; der Reproducer greift nicht auf diese Datei zu.

## Reproduktion und Snapshotgrenze

`first-probe.cjs` ist der eingefrorene Produktsnapshot des ersten Laufs08:51:49.118Z. Erstlauf: Store-Fehler bestätigt, Low-Level-Kontrollfall blieb gesund. Exit2 war die Folge einer zu strengen Harness-Assertion, die beide Fehler verlangte; kein grüner Gesamtlauf. Die damalige Behauptung deterministischer Gewinnerreihenfolge war falsch: Ein erst nach dem Bootstrap geänderter Yjs-clientID kontrolliert die zuvor angelegten Root-Einträge nicht. Originaldateien bleiben unverändert als `first-*` erhalten; Korrektur steht auch in `first-manifest.json`.

`controlled-probe.cjs` ersetzt ausschließlich die synthetische `seeded()`-Funktion und die Ausgabeangaben des Harness. Der gesamte davor liegende Produktcode ist byte-identisch zum ersten Bundle. Die Cache-Root-Einträge werden vor ihrer Erzeugung mit dem größten 32-Bit-clientID geschrieben, über die echte `writeDocumentToCrdt`-Funktion; anschließend lädt der echte Controller dieses Update. Der neue Store-Controller nutzt weiterhin unveränderten Produktcode mit frischer Zufalls-ID. Theoretische Gleichheit der Zufalls-ID mit dem Maximalwert:1/2^32; die konkreten Ergebnisse belegen die tatsächlich ausgeübte Gewinnerreihenfolge. Kein Quellbundle während Fables laufender Bearbeitung erzeugt.

Ausführung: `node /tmp/sketchdraw-217-authority-probe/controlled-probe.cjs` → Exit0. Es wurden keine Projekt-Tests wiederholt. Die Hashes der einzelnen TS-Quellen wurden vor dem Erstlauf nicht erfasst; die exakte ausgeführte Bundle-Datei und ihr Produktpräfix sind archiviert. Aktuelle Workspace-Hashes dürfen nicht nachträglich als Hashes dieses Laufs ausgegeben werden.

## Belegter Quellpfad (Vor-Fix-Stand)

- `whiteboard.ts:120–140`: gleicher Cache-Schlüssel `document:${document.id}`, asynchrone Persistence wird gestartet, Authority entsteht ohne Abwarten von `ready`.
- `whiteboard.ts:910–935,2197–2200`: externe Datei wird als neuer Controller/Authority installiert, gleicher Dokument-ID-Cache.
- `persistence.ts:22–38`: Cache wird später unmittelbar über `controller.applyRemoteUpdate` bzw. über die lebende Yjs-Persistence eingespielt.
- `authority.ts:613–617`: unerwartete Controller-Mutation beendet die Authority; `bindActor` prüft Konsistenz.
- `whiteboard.ts:974–988`: fehlgeschlagene Transition erzeugt die Fehlermeldung und `cancel`; `close-handshake.ts:37–76` schließt dann nicht.
- `whiteboard.ts:872–879`: Snapshotabruf vor dem Save-Bridge-Aufruf scheitert.

Zeilen beziehen sich auf den geprüften Vor-Fix-Stand; Fable bearbeitet die Produktquellen inzwischen. Kein zweiter vollständiger Backendreview.

## Minimaler Fix- und Regressionbedarf

Datei-/Git-Inhalt muss maßgeblich bleiben. Nur die Persistence-Mutation in `authority.applyExternalUpdate` einzuschließen würde den Cache-Rückfall zulassen und genügt nicht. Explizite Wiederherstellung über `createPersistedCrdtController` beibehalten; normale Datei-/Git-Installation darf einen alten Cache nicht als maßgeblichen Zustand übernehmen. Alte/entsorgte Generationen dürfen keine späten Updates oder Seiteneffekte in neue Generationen übertragen.

Regression mit IndexedDB und gleicher Dokument-ID: ältere abweichende Cache-Daten, neuere Datei-/Git-Daten; nach sämtlichen asynchronen Hydrierungen exakt neue Inhalte, konsistente Authority, neues Agent-Binding mit Lesen/Schreiben, altes Binding ungültig, normaler Save und Schließentscheid. Zusätzlich schnelle Dokumentwechsel/Dispose während ausstehender Persistence und explizite Recovery prüfen. Native MCP-Discovery/Neustart bleibt Root-Abnahme.

Der vorbereitete Fable-Prompt deckt diesen Fixumfang ab, bewahrt Security-Grenzen und begrenzt Änderungen sinnvoll; keine zusätzlichen Produktdateien oder generischen Retrymechanismen aus diesem Befund nötig.

## Artefakte

- `first-probe.ts`, `first-probe.cjs`, `first-result.json`, `first-manifest.json`: unveränderte Ersthistorie.
- `controlled-probe.cjs`, `controlled-result.json`, `controlled-manifest.json`: korrigierter isolierter Reproducer und Snapshotnachweis.
