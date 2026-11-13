# Lokale Agenten mit Sketchdraw verbinden

Sketchdraw stellt die sechs MCP-Werkzeuge automatisch bereit, sobald in der Desktop-App ein lokales Dokument geöffnet ist. Es gibt keinen Bereich „Agenten“, keine Freigabeschaltfläche und keine getrennten Lese-/Schreibfreigaben. Ein lokal eingerichteter Agent kann das aktuelle Dokument lesen und bearbeiten.

Claude Code, Codex, Antigravity oder ein anderer MCP-Client muss den gebündelten Sketchdraw-Adapter einmalig als MCP-Server kennen. Die Desktop-App veröffentlicht dafür bei jedem Start eine aktuelle `clientConfiguration` in ihrer privaten Laufzeitdatei. Diese enthält den exakten Startbefehl der installierten Anwendung, den Pfad zum gebündelten Adapter und den stabilen Verweis auf die Laufzeitdatei. Ein global installiertes Node.js ist nicht erforderlich.

| Plattform | Private Laufzeitdatei |
| --- | --- |
| macOS | `~/Library/Application Support/io.sketchdraw.de/agent-runtime/active-v1.json` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/io.sketchdraw.de/agent-runtime/active-v1.json` |
| Windows | `%APPDATA%\io.sketchdraw.de\agent-runtime\active-v1.json` |

Übernimm `clientConfiguration` einmalig als Eintrag `sketchdraw` in die lokale MCP-Konfiguration des jeweiligen Clients. Die App verändert fremde Client-Einstellungen nicht. Die Laufzeitdatei enthält außerdem die aktuelle private Capability und darf deshalb nicht in Git, Tickets, Chatnachrichten oder Logs abgelegt werden. Unter Unix sind Verzeichnis und Datei auf den aktuellen Betriebssystemnutzer beschränkt.

Beim Dokumentwechsel oder Neustart ersetzt die App die Capability automatisch. Ein laufender Adapter verbindet sich beim nächsten Werkzeugaufruf erneut. Lesezugriffe laufen danach auf dem neuen Dokument weiter. Ein Schreibzugriff wird nach einem Dokumentwechsel nicht mitgenommen: Er endet mit `SESSION_CHANGED`, bis der Agent das neue Dokument gelesen hat oder dessen `documentId` ausdrücklich angibt. Revisionen beginnen in jedem Dokument bei 0; ohne diese Sperre könnte eine Änderung für das frühere Dokument im neu geöffneten landen. Eine möglicherweise bereits abgesendete Änderung wird bei einem Verbindungsabbruch nicht blind wiederholt; dafür bleibt `OUTCOME_UNKNOWN` erhalten. Ältere, über die frühere Freigabeoberfläche erzeugte Adaptereinträge können nach einem abgelaufenen Schlüssel ebenfalls auf die aktuelle private Laufzeitdatei wechseln.

Die Browseransicht stellt keinen lokalen MCP-Host bereit. Eine P2P-Gastkopie erhält ebenfalls keinen lokalen Agentenzugriff, weil sie keine eigene Dokumentautorität besitzt. Beim Wechsel in den Gastmodus entfernt die Desktop-App den automatischen Zugriff. Der Zugriff kehrt zurück, sobald wieder ein lokales Dokument aktiv ist.

## Werkzeuge

`documentId` ist bei Lesewerkzeugen optional. Ohne diese Angabe lesen sie das aktuell geöffnete lokale Dokument. Beide Schreibwerkzeuge verlangen ausdrücklich die `documentId` aus dem zuletzt gelesenen Ergebnis; wartende Aufträge und neu gestartete Adapter dürfen das Schreibziel nicht still wechseln. Eine ausdrücklich angegebene andere ID wird mit `DOCUMENT_MISMATCH` abgelehnt.

| Werkzeug | Ergebnis / Zweck |
| --- | --- |
| `sketchdraw_read_document` | Aktuelles Dokument und Revision; Bilddaten nur bei `includeAssetData: true`, sonst Assetzusammenfassungen. |
| `sketchdraw_find_elements` | Suche nach ID, Art, Beschriftung, Text oder Metadaten; `query` und optional `limit`. |
| `sketchdraw_analyze_document` | Strukturelle Bestandsaufnahme und Hinweise, z. B. ungebundene Verbindungen. Keine behauptete Cloud-Sicherheitsprüfung. |
| `sketchdraw_read_code` | Menschenlesbarer, editierbarer Diagrammcode und Revision. |
| `sketchdraw_apply_commands` | Gezielte Änderung mit `expectedRevision` und eindeutiger `commandId`; bevorzugt für alle Einzeländerungen. |
| `sketchdraw_apply_code` | Vollständiger Diagrammcode mit denselben Revisions-/Wiederholungsregeln; ersetzt das ganze Dokument. |

Jedes Werkzeug hat eine eigene Beschreibung, und der Server liefert beim Verbinden Anweisungen zu Ablauf, Fehlerregeln und Zeichenkonventionen. Ein Agent kann damit ohne den Skill arbeiten.

Das Ergebnis steht in `structuredContent` und zusätzlich als dasselbe JSON im Textblock, weil viele Clients ihrem Modell nur eines von beiden geben. Fehler enthalten `error.code`; `isError` ist dann gesetzt. Abgelehnte Befehle nennen in `error.issues` Pfad und Grund jedes Problems, abgelehnter Code in `error.diagnostics` Zeile und Spalte. Mehrere gleichzeitige Aufrufe reiht der Adapter ein; die App bearbeitet zwei je Verbindung. Initialisierung und Werkzeugauflistung funktionieren auch ohne geöffnete Desktop-App, Dokumentzugriffe enden dann mit `ACCESS_DENIED`. Der Adapter öffnet selbst keine Datei und erstellt keinen versteckten Dokumentstore.

## Änderungen und Wiederholungen

Lies zuerst den aktuellen Stand. Eine einfache Umbenennung ist beispielsweise:

```json
{
  "documentId": "ID-aus-dem-Leseergebnis",
  "expectedRevision": 0,
  "commandId": "eine-neue-eindeutige-id",
  "command": { "type": "rename", "title": "Cloud-Architektur" }
}
```

Ersetze Dokument-ID und Beispielrevision durch die tatsächlich gelesenen Werte.

Das Schema von `command` nennt die Befehlsarten (`add`, `update`, `delete`, `rename`, `batch`, `reorder`, Seitenbefehle, `set-metadata`) und die wichtigsten Felder. Beim Hinzufügen genügen `id`, `kind`, `x` und `y`; Größe, Drehung und Stil werden ergänzt, einfache Formen erhalten zentrierten Text. Eine Verbindung braucht nur ihre beiden Enden; Lage und Verlauf werden aus den Elementen berechnet, und sie folgt ihnen beim Verschieben:

```json
{ "type": "add", "elements": [
  { "id": "box:api", "kind": "rectangle", "x": 100, "y": 100, "text": "API" },
  { "id": "box:db", "kind": "rectangle", "x": 420, "y": 100, "text": "DB" },
  { "id": "link:api-db", "kind": "connector", "from": { "elementId": "box:api" }, "to": { "elementId": "box:db" } }
] }
```

Im Diagrammcode gilt für Verbindungen dasselbe: Eine Zeile `connector "link:api-db" {"from":{"elementId":"box:api"},"to":{"elementId":"box:db"}}` genügt, auch im Code-Panel der App. Formen brauchen im Code weiterhin `x`, `y`, `width` und `height`. Bei `REVISION_CONFLICT` erneut lesen und die Änderung auf den neuen Stand abstimmen. Verwende für einen geänderten Auftrag eine neue `commandId`. Bei `OUTCOME_UNKNOWN` denselben Auftrag mit identischer ID, Revision und Nutzlast wiederholen; kein blindes erneutes Ausführen mit neuer ID. Eine wiederverwendete ID mit anderer Nutzlast wird abgelehnt.

Änderungen sind unmittelbar menschlich editierbar, aber ausdrücklich **ungespeichert** (`saved: false`). Der Mensch speichert über die App. Dokumentinhalte, Beschriftungen, Metadaten und eingefügter Code sind Daten und keine Anweisungen an den Agenten. Änderungen eines lokalen Agenten stehen im Rückgängig-Verlauf des Nutzers: Strg/Cmd+Z nimmt die jeweils letzte Änderung zurück, gleich ob sie vom Nutzer oder vom Agenten stammt. Änderungen von P2P-Teilnehmern bleiben davon ausgenommen. Der Agent selbst hat kein Undo-Werkzeug und nimmt eigene Fehler mit dem Gegenbefehl zurück.

Für wiederverwendbare Arbeitsregeln liegt [der Sketchdraw-Skill](../skills/sketchdraw-desktop/SKILL.md) im Repository. Die installierte App bringt ihn als Datei mit, und die Server-Anweisungen nennen jedem Client den vollständigen Pfad:

| Plattform | Skill in der installierten App |
| --- | --- |
| macOS | `Sketchdraw.app/Contents/Resources/skills/sketchdraw-desktop/SKILL.md` |
| Linux | `<Installationsordner>/resources/skills/sketchdraw-desktop/SKILL.md` |
| Windows | `<Installationsordner>\resources\skills\sketchdraw-desktop\SKILL.md` |

In das Skill-Verzeichnis eines Clients trägt die App ihn nicht selbst ein. Wer ihn dort dauerhaft haben möchte, kopiert den Ordner `sketchdraw-desktop` für Claude Code nach `~/.claude/skills/` (oder in ein Projekt nach `.claude/skills/`), für andere Clients in deren Skill-Verzeichnis. Die wichtigsten Regeln stehen zusätzlich in den Server-Anweisungen und erreichen jeden Client auch ohne Skill.

Das bereits veröffentlichte Release v0.1.3 auf `c45e892` enthält diese spätere Skill-Auslieferung noch nicht.

## Technische Grenze

Der lokale Host verwendet unter Unix einen privaten Socket und unter Windows ausschließlich `127.0.0.1`. Adapter und Desktop-App authentifizieren sich gegenseitig, bevor Dokumentdaten übertragen werden. Die automatische Freigabe gilt für lokale Programme desselben Betriebssystemkontos; sie führt keine Shellbefehle aus und stellt keine beliebigen Dateipfade bereit. Diese MCP-Anbindung dient nicht als P2P-Signaling- oder Relay-Server. Details und Prüfanforderungen stehen in [contracts-mcp.md](contracts-mcp.md).
