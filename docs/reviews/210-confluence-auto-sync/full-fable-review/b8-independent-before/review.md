# B8 – bestätigter Upload geht im persistierten Journal verloren

Unabhängige Codex-Probe, registrierter Umfang #210 Kommentar 6916090034. Geprüft am 2026-11-16 um 12:20:39 UTC, Nachherhashes 12:20:57 UTC. Keine Produkt- oder Repository-Testdatei geändert; keine App, kein Tenant, keine echte Netzwerkverbindung. Das synthetische Profil lag ausschließlich unter `/tmp` und wurde nach Auswertung entfernt. Keine parallelen Einstellungen-Schreibvorgänge.

## Ergebnis: materieller Befund bestätigt (P2)

1. Zwei Bilder erfolgreich veröffentlicht, beide mit bestätigter Anhangsversion 1; `published` enthält beide, `pending` ist leer.
2. Beide Bilder geändert. Erstes Upload wird serverseitig angewandt und mit Version 2 beantwortet. Zweites Upload liefert synthetisch HTTP 403 **vor** einer Anwendung.
3. Ergebnis des Service: `failed`, `uploaded: 1`. Der simulierte Server enthält Bild 1 v2 und Bild 2 v1.
4. **Datei:** `published` bleibt v1/v1, `pending` enthält beide Bilder mit Basisversion 1. **Arbeitsspeicher:** `published` ist korrekt v2/v1, `pending` enthält nur Bild 2.
5. Dienstinstanz beendet und aus genau dieser Datei neu gestartet; Remote-Antworten liefern bewusst keinen Digest. Wiederholung scheitert bereits an Bild 1 mit „Confluence bestätigt seinen Inhalt nicht“, obwohl dessen voriger Upload erfolgreich bestätigt war. Es wird kein weiterer Upload ausgelöst. Der veraltete Dateiinhalt bleibt erhalten.

Die erfolgreiche Reproduktion (Prozess Exit 0) ist **kein bestandener Produktregressionstest**. `findingReproduced: true`, `productRegressionPass: false` in `result.json`.

## Ursache und kleinster Korrekturvertrag

Quelle: `electron/plugin-service.ts`, Snapshot SHA256 `87caa6ee618fa3cfcd8d0e215d9a96474d5f2fb161a57e9e2da05d0699f686dc`.

- `remember()` übergibt die veränderlichen Arbeitsmaps direkt an den Profilzustand (1255–1264).
- `updateLiveLinks()` prüft mit `parseConfluenceLinks`, verwirft aber dessen frisch erzeugte Objekte und speichert die ursprünglichen Referenzen (742–750).
- `mutateStore()` serialisiert diese Referenzen und übernimmt sie danach in `this.profiles` (532–549).
- Nach der Absichtssicherung (1326–1327) mutieren die bestätigten Uploads dieselben Maps (1334–1335). Beim Fehler vergleicht `remember()` daher aliasierte, identische Memory-Maps und überspringt die nötige Dateisicherung (1259, Fehlerpfad ab 1369).
- Nach Neustart wertet die Journalauflösung das erste Upload erneut als unbestätigt (1295–1300) und hält bei fehlendem Digest korrekt vorsichtig, hier jedoch aufgrund eines falschen Journals, an.

Minimaler Fix: Persistierter Profilzustand und veränderliche Laufmaps müssen unabhängige Objekte sein. Zum Beispiel in `updateLiveLinks` **den Rückgabewert von `parseConfluenceLinks()` speichern**, einschließlich dessen `undefined`-Fall für leere Links; dieser Parser baut Maps und Einträge neu auf. Alternativ die Maps beim Übergang in den Profilzustand vollständig kopieren. Eigentumsnachweise, historische Anhänge, Pending-Absichten und der vorsichtige Umgang mit tatsächlich unbekannten Uploadausgängen müssen erhalten bleiben. Kein pauschales Entfernen der Pending-Einträge und kein Akzeptieren unbekannter Remote-Versionen.

Erforderliche Regression nach Fix: gleicher Fall mit bestehender erfolgreicher Zweibild-Publikation, ohne zusätzliche Settings-Schreibvorgänge. Nach Teilfehler muss die Datei `published` v2/v1 und `pending` nur Bild 2 enthalten; nach Neustart ohne Remote-Digest wird ausschließlich Bild 2 übertragen, Bild 1 bleibt v2, danach `synced` und leeres Pending. Die bisherige Teiluploadprüfung mit anfänglich leerem `published` und parallelem Konfigurationsschreiben deckt diesen Aliasfall nicht verlässlich ab.

## Ausführung und Standgrenze

Arbeitsbaum: `/Users/jeremyteichmann/.codex/worktrees/210-confluence-integration/de.sketchdraw.io`.

Tatsächlich ausgeführt, beide Exit 0:

```text
node /tmp/sketchdraw-210-b8-alias-probe/build.mjs
node /tmp/sketchdraw-210-b8-alias-probe/probe.mjs
```

Der Harness nutzt die echten `PluginService`-/Domainfunktionen und einen an den bestehenden Service-Tests orientierten In-Memory-Confluence-Transport. Die Hilfsfunktionen wurden einmal lesend aus dem Testpräfix übernommen; Vitest wurde durch einen funktionsgleichen einfachen `vi.fn`-Wrapper ersetzt. PNG- und Requestverträge entsprechen der vorhandenen Fixture. Kein Vitest-/Native-/Buildskript des Repositories wurde ausgeführt; esbuild bündelte ausschließlich nach `/tmp`.

Alle 22 tatsächlich gebündelten Produktquellen wurden bei Bundle-Erstellung als exakte Snapshotdateien unter `source/` archiviert. Ihre Hashes waren nach Bundle-Erstellung und nach Probe unverändert. Auch die als Hilfsvorlage gelesene Service-Testdatei blieb unverändert. Vollständige Werte: `manifest.json`; Bundle-Abhängigkeiten: `metafile.json`.

- Harness `probe.ts`: `b21e04d1407733f70fc39b4297cf741884d0e55311e76a573f6ed49ab826ecf3`
- Ausgeführtes Bundle `probe.mjs`: `4f1be27eb32581d7687a54c78ea1ef489ea71963a86fbf17ae48ec189bda3e00`
- Ergebnis `result.json`: `7dea191ee3aa9944b348b842789fb7408ec2a08f641d2c2fff25c7588cea09e8`

Die Probe belegt den Service-/Dateizustandsfehler und seine Auswirkung beim Neustart mit fehlendem Remote-Digest. Sie ist kein echter Confluence-, GUI- oder Electron-Neustartnachweis. Noch keine Korrektur implementiert oder abgenommen.
