# Fable 5.2 / high — Import und Export #153

Tatsächlicher unabhängiger Read-only-Review über Claude Code CLI2.1.321; Sitzung `a2327c2e-97f8-479d-b658-60aea0a73996`, Aufruf `--model claude-fable-5-2 --effort high`. Gemessene Metriken separat in `153-fable-metrics.json`, Auftrag in `153-fable-prompt.md`. Der folgende Originalbericht enthält ausdrücklich Hypothesen; Codex-Gegenprüfung folgt danach. Fable führte keine Tests aus.

## Originalbericht

Der Review erfolgte ausschließlich per Lektüre; ich habe nichts ausgeführt, alle Fälle sind aus dem Code hergeleitet und nicht gemessen. Ergebnis: #154 und #155 halten nach Lektüre, #156 nur bei explizitem `fontColor`. Der Mermaid-Adapter hat zwei Blocker: quadratische Regexe vor den Limits und fehlender Nachweis, dass der Export in echtem Mermaid gültig ist.

- **Stand der Datei:** `src/interop/mermaid.ts` wurde während des Reviews geändert (Subgraph-Membership kam hinzu). Zeilenangaben beziehen sich auf den zweiten Lesestand.
- **Graphify:** `graphify query` konnte ich nicht ausführen, weil mir nur Read/Grep/Glob zur Verfügung stehen.

## Findings

### F1 · P1 · Quadratische Regexe laufen vor den Größenlimits (Frage 4)

- **Fall a, `mermaid.ts:307`:** Die Fence-Regex `/^```mermaid\s*\r?\n([\s\S]*)\r?\n```$/i` läuft auf bis zu 96 MiB, bevor das 8-MiB-Limit greift. Eine Eingabe aus der Fence-Zeile, N Zeilenumbrüchen und einem `x` ohne schließende Fence kostet etwa N²/2 Schritte, weil `\s*` und `[\s\S]*` gegeneinander zurücklaufen.
- **Fall b, `mermaid.ts:34`:** Die HTML-Prüfung `/<\/?[a-z!][^>]*>/i` läuft vor dem Textlimit in Zeile 45. Ein Label `A["<a<a<a…"]` ohne `>` scannt pro `<a` bis zum Ende; `group()` (Zeile 138) übergibt sogar das ganze Statement.
- **Auswirkung:** `convert()` läuft synchron im Renderer (`InteropPanel.vue:52`). Schon wenige hundert KB frieren die Oberfläche ein, auch beim reinen Einfügen von Text.
- **Minimaler Fix:**
  - Fence linear zerlegen: erste Zeile prüfen, `endsWith`, `slice`, `includes`.
  - In `label()` zuerst die Rohlänge kappen (z. B. `MAX_TEXT_LENGTH * 10` wegen Entities).
  - Die Tag-Prüfung als `indexOf`-Schleife schreiben, die abbricht, sobald kein `>` mehr folgt.
- **Regression:** Beide Eingaben mit N = 200.000 müssen unter einer festen Zeitgrenze mit `MERMAID_SYNTAX_UNSUPPORTED` bzw. `LIMIT_EXCEEDED` enden. Der Test in `mermaid.spec.ts:105` nutzt nur `'x'.repeat` und trifft den Fall nicht.

### F2 · P1 · Gültigkeit in echtem Mermaid ist unbelegt; drei Ausgaben sind verdächtig (Frage 1)

- **Belegt:** `mermaid` steht nicht in `package.json`. Unit-, UI- und Electron-Tests prüfen nur den eigenen Importer oder `/^flowchart\s/m` (`tests/ui/interop.spec.ts:153`, `desktop.spec.ts:131`).
- **Verdacht a, `mermaid.ts:384–390`:** Textlose Elemente werden zu `n0[""]` bzw. `subgraph n0[""]`. Nach meiner Kenntnis verlangt Mermaids String-Token mindestens ein Zeichen, dann wäre das ganze Diagramm ein Parse-Fehler. Der UI-Roundtrip-Test exportiert genau so ein Rechteck.
- **Verdacht b, `mermaid.ts:368`:** `:` und `/` bleiben unescaped.
  - `fa:fa-home` würde Mermaid als Icon rendern.
  - Bei einer Zeile mit `style` oder `classDef` plus `:` und Entity (z. B. Label `stylesheet https://a.b/c?x=1`) entfernt Mermaids Entity-Vorverarbeitung nach meiner Erinnerung das letzte `;`, der Text wird verfälscht.
- **Verdacht c:** Zeilenumbrüche werden zu `#10;`; Mermaid rendert das als Leerraum, ohne dass eine Diagnose darauf hinweist.
- **Minimaler Fix:** Leeren Text als `" "` ausgeben und beim Import zu `''` normalisieren; `:` und `/` aus der Whitelist nehmen; für mehrzeilige Labels eine Warnung ergänzen.
- **Zeitpunkt:** Jede Änderung an `projection()` macht bereits exportierte v1-Dateien „stale“, weil die Projektion der Verifikationsschlüssel ist. Der Fix gehört daher vor den ersten Release.
- **Regression:** Einmalig `mermaid.parse()` in der Zielversion als Dev-Test über Fixtures laufen lassen: leerer Text, `fa:fa-x`, `style:x(y)`, Unicode, Selbstkante, Kante auf Subgraph, freier Endpunkt, leeres Dokument.

### F3 · P2 · Gültiges Mermaid wird still falsch gelesen statt abgewiesen (Frage 2)

- **Fall a, `mermaid.ts:154–168`:** Die Label-Form sucht blind das nächste `-->`.
  - `A --x B --> C` ergibt eine Kante A→C mit Label „x B“; Knoten B verschwindet. Dasselbe gilt für `--o`.
  - `A -- t --- B --> C` ergibt A→C mit Label „t --- B“.
  - `A -- t ---> B` ergibt das Label „t -“.
  - Analog für `==` und `-.`. Der vorhandene Test deckt nur `A---oB` ab.
- **Fall b, `mermaid.ts:134–138`:** `subgraph Data Layer` bekommt die ID `Data`. Ein zweites `subgraph Data Store` wird als Duplikat abgewiesen; ein später referenzierter Knoten `Data` hängt am Subgraph statt an einem eigenen Knoten.
- **Auswirkung:** Inhalt und Topologie weichen ohne Diagnose von der Quelle ab; die Treue wird als `supported-subset` gemeldet.
- **Minimaler Fix:**
  - Nach `--` oder `==` ein direkt folgendes `x` oder `o` als `UNSUPPORTED` abweisen.
  - Unquotierten Kantentext mit `--`, `==`, `-.` oder `.-` sowie mit `-`, `=` oder `.` am Rand abweisen.
  - Bei Subgraph-Titeln mit Leerzeichen eine synthetische, nicht referenzierbare ID vergeben.
- **Regression:** `errorCode(…, 'MERMAID_SYNTAX_UNSUPPORTED')` für die fünf Kantenfälle; zwei Subgraphs mit gleichem ersten Wort müssen importierbar sein.

### F4 · P2 · CRLF zerstört den eigenen Roundtrip (Fragen 3 und 6)

- **Fall, `mermaid.ts:350`:** Der Vergleich ist bis auf `trim()` zeichengenau. Nach `git autocrlf` (Standard auf Windows) oder einem Editor mit CRLF enthält `visible` `\r\n`, und der Import meldet `EMBEDDED_MODEL_STALE`.
- **Auswirkung:** Die Richtung ist sicher und wird diagnostiziert. Trotzdem verliert eine inhaltlich unveränderte eigene Datei nach der Bestätigung andere Seiten, Bilder, Notizen und IDs. Das widerspricht dem Ziel „Git-freundlich“.
- **Minimaler Fix:** `visible` vor dem Vergleich auf `\n` normalisieren. Das ist verlustfrei, weil die eigene Projektion CR und LF in Labels als `#13;` und `#10;` kodiert.
- **Regression:** `importMermaid(contents.replace(/\n/g, '\r\n'))` ergibt `own-roundtrip`. Zusätzlich ein Gegentest, dass eine echte Labeländerung mit CRLF weiterhin „stale“ ist.

### F5 · P2 · Wiederhergestelltes Mehrseitendokument zeigt die falsche Vorschau und keine Diagnose (Fragen 3 und 5)

- **Fall:** Die Vorschau zeigt immer `pages[0]` (`InteropPanel.vue:29`). Verifiziert wird aber nur die Seite aus dem `pageIndex` der Datei. Wer Seite 2 exportiert und wieder importiert, sieht im Textfeld Seite 2 und in der Vorschau Seite 1.
- **Fehlende Diagnose:** `finish(ctx, options, document)` liefert in diesem Pfad null Diagnosen und `requiresConfirmation=false`.
- **Auswirkung:** Die Projektion bindet nur Texte und Topologie einer Seite. Alle übrigen Seiten, Assets, Kommentare und Links stammen unverifizierbar aus der Kommentarzeile, werden als „Eigener unveränderter Roundtrip“ ausgewiesen und vor der Übernahme nicht gezeigt. Das Vertrauensmodell entspricht dem Öffnen einer nativen Datei; überschrieben wird nichts, weil der Import ein neues Dokument anlegt.
- **Minimaler Fix:** Eine Info-Diagnose `EMBEDDED_MODEL_RESTORED` mit Seitenzahl und verifizierter Seite ergänzen und in der Vorschau die verifizierte Seite zeigen.
- **Regression:** UI-Test: Seite 2 mit Einbettung exportieren, wieder importieren; die Vorschau enthält „Zweite Seite“ und der Bericht nennt zwei Seiten.

### F6 · P2 · Die ganze Datei wird ins Textfeld gespiegelt (Frage 5)

- **Fall, `InteropPanel.vue:68` und `:129`:** `source` ist an `<textarea :value>` gebunden. Ein eigener Export mit eingebetteten Bildern (Einbettung ist Standard, Assets bis 20 MiB) ist eine einzige Base64-Zeile im zweistelligen MiB-Bereich. `tests/ui/interop.spec.ts:103` schreibt die Spiegelung für kleine Dateien fest.
- **Auswirkung:** Ich erwarte Layout-Stillstand und hohen Speicherbedarf genau im eigenen Roundtrip; gemessen habe ich das nicht.
- **Minimaler Fix:** Dateiinhalte nur bis etwa 200 KB spiegeln, darüber Dateiname und Hinweis zeigen; `source` bleibt intern erhalten.
- **Regression:** UI-Test mit einer `.mmd` von mehreren MiB samt Envelope: Das Textfeld bleibt leer, die Vorschau zeigt den eigenen Roundtrip.

### F7 · P3 · #156 trennt die Schriftfarbe nur bei explizitem `fontColor`

- **Fall, `drawio.ts:103–107`:** Fehlt `fontColor`, bleibt `textColor` leer, und Renderer wie Tabelle fallen auf die Konturfarbe zurück (`ElementView.vue:23`, `drawio.ts:333`). Eine fremde Zelle mit `strokeColor=#ff0000` ohne `fontColor` bekommt roten Text; draw.io nutzt dort die Standard-Schriftfarbe.
- **Festgeschrieben:** `153-review.spec.ts:95` verlangt diesen Fallback ausdrücklich. Das ist eine Entscheidung für Codex, kein Versehen.
- **Minimaler Fix:** Bei fremden Zellen ohne `fontColor` die Standardtinte setzen (eigene Exporte schreiben `fontColor` immer) oder wenigstens `STYLE_APPROXIMATED` melden.
- **Regression:** Ein Rechteck mit `strokeColor=#ff0000` ohne `fontColor` ergibt `textColor !== '#ff0000'`.

## Ungeprüfte Hypothesen

- **Keyword-Präfix:** Die IDs `endpoint{n}` (`mermaid.ts:401`) beginnen mit `end`. Ältere Mermaid-Lexer brachen an solchen Präfixen; `free{n}` wäre eine billige Härtung.
- **Kante Container ↔ Kind:** Eine Kante zwischen einem Subgraph und seinem eigenen Nachfahren kann in Mermaids Layout scheitern.
- **Projektionsdrift:** Die Änderungen an `export.ts` könnten Envelopes aus v0.1.1 „stale“ machen. Die Richtung wäre sicher, aber eine Fixture-Datei aus v0.1.1 fehlt als Test.
- **Koordinatenlimit:** Stark verschachtelte große Graphen (6 Gruppen je Ebene, Tiefe 5) könnten `MAX_COORDINATE_ABS` überschreiten und nur ein generisches `INVALID_DOCUMENT` liefern.
- **Gastrolle:** `requestTransition('import')` habe ich für Gäste und Betrachter nicht nachverfolgt. Die Menüeinträge in `MainMenu.vue:78–79` sind statisch und nicht nach Rolle gesperrt.

## Nach Lektüre ohne Befund

- **#154:** Eine spätere Seite wird über den Envelope der ersten Seite wiederhergestellt (`drawio.ts:214`). Verglichen wird immer die gesamte Datei (`:167`), sodass fremde Änderungen an jeder Seite „stale“ ergeben. Die Tests in `153-review.spec.ts:37–60` decken das ab.
- **#155:** Text- und Zellprodukt-Limit greifen vor `createTableDocument` (`drawio.ts:323–329`).
- **Download:** `.mmd` und `text/plain` sind in Browser-Bridge, IPC-Vertrag, Preload, Main und Persistence durchgängig freigegeben und nutzen denselben atomaren Schreibpfad.
- **Export-Races:** `serial`, Authority- und Revisionsprüfung verwerfen veraltete Snapshots; der Format-Watcher räumt synchron auf.
- **Sicherheit beim Import:** HTML, Markdown, `click`, `style`, Direktiven und `&` werden abgewiesen. Lookups laufen über `Map` und `Object.hasOwn`. Ein Envelope in Anführungszeichen oder in der Zeilenmitte hat keine Autorität.

## Testlücken

- Kein Lauf gegen einen echten Mermaid-Parser.
- Keine Zeitgrenzen-Tests für pathologische Eingaben.
- Kein CRLF-Roundtrip.
- draw.io: kein Fall für eine fremd hinzugefügte oder komprimiert neu gespeicherte Seite.
- Mermaid: `<br/>` und YAML-Frontmatter werden abgewiesen. Frontmatter wird dabei irreführend als „Diagrammtyp nicht unterstützt“ gemeldet.

P2P-Dateien, SVG-Import und Domänenvalidierung habe ich nicht geprüft. Der Bericht wurde auftragsgemäß nicht unter `docs/reviews/` abgelegt; Ticket-Kommentar und `docs/concerns.md` liegen bei Codex.

## Codex-Gegenprüfung und Korrekturen

Der Originalbericht bleibt unverändert. Fable las ausschließlich Code; die folgenden Reproduktionen, Änderungen und Tests stammen von Codex und seinen getrennt zuständigen Subagenten. Alle Änderungen sind lokal/uncommitted, Basis `bd610f6`, Branch `codex/149-hyperdht-relay`.

| Finding | Entscheidung und tatsächlicher Nachweis |
| --- | --- |
| F1 | Angenommen. Fence-Verarbeitung und Tagprüfung linear; 500.000 Rohlabelzeichen vor Scans, anschließend 50.000 decodierte Zeichen. Pathologische 200.000-Wiederholungen in separatem abbrechbarem Prozess: 0,31 ms Fence, 11,32 ms HTML-Präfix, 16,32 ms Rohlabel im dokumentierten Lauf. Regression begrenzt Prozess auf 5 s und einzelne Konvertierung auf 1,5 s. Keine Garantie für beliebige Hardware/RSS. |
| F2 | Teilweise bestätigt durch tatsächlichen Mermaid12.3-Parser. Leeres `n0[""]` und leere Gruppen waren ungültig; `stylesheet https://…` und `style:x(y)` verloren Entity-Semikola. Leerlabel nun einzelnes Leerzeichen, Doppelpunkte/Slashes kodiert; eigener Import normalisiert den Leer-Platzhalter. Mehrzeilige Texte erhalten konkreten Layout-Hinweis. 19 offizielle Parser-/Datenmodellfälle bestehen nun; Labeltexte geprüft. Das allgemeine Fehlen eines Parserlaufs trifft auf Codex nicht zu: acht Fälle liefen bereits parallel zu Fable, es fehlten aber diese Randfälle. |
| F3 | Angenommen. Kleine Vorherfälle verschluckten tatsächlich B; nicht unterstützte dekorierte/lange/plain-labelled Pfeile werden jetzt explizit abgewiesen. Vollständig zitierte Labels bleiben möglich. Mehrwort-Gruppentitel erhalten synthetische, vom ersten Titelwort unabhängige IDs, gegen echte Mermaid-Semantik geprüft. |
| F4 | Angenommen. Nur strukturelle CRLF werden beim eigenen Projektionsvergleich zu LF normalisiert; Label-CR/LF sind numerisch kodiert. Eigener CRLF-Roundtrip und bearbeitete Gegenprobe bestanden. |
| F5 | Angenommen als Transparenz-/Vorschaufehler, nicht als zusätzliche Dokumentautorität. Wiederherstellung liefert `source.pageId` plus `EMBEDDED_MODEL_RESTORED` mit Seitenzahl, verifizierter Seite und Herkunft übriger Inhalte. UI zeigt diese Seite. Seite-2-Export/Rückimport mit zwei Seiten tatsächlich getestet. |
| F6 | Unbegrenzte Textarea-Spiegelung im alten Code bestätigt; behaupteter Stillstand wurde nicht gemessen. Dateien über 200 KiB bleiben intern, ohne Textarea im DOM. Tatsächlicher UI-Test mit >3-MiB-Mermaid-Datei und echtem PNG bestätigt vollständigen Bildinhalt in Vorschau und nach Übernahme; explizite neue Codeeingabe verwirft nur die Vorschau. |
| F7 | Als #157 separat erfasst und bestätigt: vier neue Vorherfälle rot. Default-Schriftfarbe unabhängig vom Rahmen, `#000000` als begrenzte Light-Theme-Annahme; fehlende/unaufgelöste Themeinformation wird diagnostiziert. Explizite Farben und unveränderte eigene Roundtrips bleiben erhalten. 77 bestehende/ergänzte SVG-/draw.io-Tests bestanden. Primärquelle: [draw.io Styles](https://github.com/jgraph/drawio/wiki/Styles). |

Zusätzlich korrigierte Codex vor dem abschließenden Bericht die tatsächliche Mermaid-Gruppenzuordnung bereits referenzierter Knoten sowie Label-only-Knoten und -Connectoren. Gültige hierarchische Mitgliedschaften wurden gegen Mermaid12.3 geprüft; zyklische und übertiefe Container werden ausdrücklich abgewiesen.

### Grenzen und widerlegte Hypothesen

Leere Dokumente und `endpoint`-Präfixe bestehen im tatsächlichen Mermaid12.3-Parser; dafür wurden keine spekulativen Produktänderungen gemacht. Container-Kind-Verbindungen bestehen beim Parsen, aber es gibt keinen neuen vollständigen Pixel-/Layoutnachweis des Mermaid-Renderers. Icon-Trigger wurden anhand der tatsächlichen Renderer-Vorverarbeitung und ihrer RegExp vor HTML-Entity-Decoding geprüft; das ersetzt keinen Font-/Pixelnachweis. Multiline-Text bleibt im Parser erhalten, Fremdrenderer-Umbruch ist ausdrücklich nicht als identisch zugesagt.

SVG und draw.io bleiben begrenzte Adapter. Die bestehenden externen Fixtures und neuen Regressionen wurden ausgeführt; eine erneute interaktive Abnahme sämtlicher Dateien in der draw.io-Webanwendung ist nicht Teil dieses Durchlaufs. Windows/Linux, Installer und Release dieser lokalen Revision wurden nicht ausgeführt. Gastschutz wird durch bestehende Autoritätsprüfungen und die vollständige Unit-/Electron-Abnahme abgesichert; der reine Adapter vergibt keine Schreibfähigkeit.

### Artefakte

- `153-fable-metrics.json`: tatsächliches Modell, Sitzung, Dauer und Usage; keine erfundenen Implementierungsmetriken.
- `153-mermaid-reference-check.mjs`, `153-mermaid-reference.json`, `fixtures/153-mermaid/`: 19 reproduzierbare offizielle Parser-/Datenmodellfälle, synthetische Testinhalte.
- `fixtures/153-mermaid/fable-f2-before.json`: tatsächliche F2-Vorherresultate.
- `153-mermaid-adversarial.json`: gemessener begrenzter adversarial Lauf.
- `153-local-validation.json`: endgültige Hashstände, Befehle, Ergebnisse und verbleibende Grenzen nach Review.
