Tatsächlicher Claude-Code-Review vom 13.11.2026, CLI2.1.323, `claude-fable-5-2 --effort high`, Sitzung `f9c4893e-d23e-4684-8a7b-76dd039d34c1`. Nur Read/Glob/Grep; keine Tests. Metriken in `2026-11-13-interop-fable.json`. Der Originalbericht enthält ungeprüfte Hypothesen; Codex-Gegenprüfung in `2026-11-13-interop-audit.md`.

# Sparring #153–#157 — Fable 5.2/high, nur Lektüre

Ich habe nichts ausgeführt; alle Fälle sind aus dem Code hergeleitet, nicht gemessen. `graphify query` konnte ich nicht ausführen, weil mir nur Read/Glob/Grep zur Verfügung stehen.

**Ergebnis:** Im Mermaid-Adapter, im Panel und in der Envelope-Verifikation habe ich keinen neuen materiellen Fehler gefunden. Zwei neue P2-Befunde betreffen Tabellenfarben im draw.io-Pfad (#156), dazu zwei P3-Randfälle (#155, #157).

## 1) Abschlussreife je Ticket

| Ticket | Einschätzung |
| --- | --- |
| **#153** | Abschlussreif nach Lektüre. Alle drei Formate hängen im vorhandenen Panel, der Export läuft über `bridge.exportFile`, und der Mermaid-Hinweis nennt ausdrücklich nur Flowcharts. Fehler erzeugen nur eine Vorschau; der Dirty-Abbruch behält sie. Ein Gast erhält beim Import ein neues lokales Dokument, kein Schreibzugriff auf das Host-Dokument (`whiteboard.ts:778–788`, `:818–820`). |
| **#154** | Abschlussreif. Die spätere Seite wird über das Envelope der ersten Seite wiederhergestellt, verglichen wird immer der gesamte Dateibaum (`drawio.ts:170–173`, `:219`). Verschobene oder doppelte Envelopes geben keine Autorität ohne vollständige Projektionsgleichheit. |
| **#155** | Kernkriterien erfüllt: Text- und Zellproduktprüfung liegen vor `createTableDocument` (`drawio.ts:328–334`), das Zerlegen ist linear. Ein P3-Randfall liefert den falschen Fehlercode (F3). |
| **#156** | Für sechsstellige Hexfarben erfüllt und getestet. Für andere explizite Farbschreibweisen bricht der gesamte Import ab (F1), und der eigene Export schreibt bei Tabellen die Rahmenfarbe als `fontColor` (F2). Ich würde F1 vor dem Schließen beheben oder als verlinkten Folgebug führen. |
| **#157** | Abschlussreif. Die Standardtinte `#000000` ist unabhängig vom Rahmen, `fontColor=default` wird mit Warnung abgebildet, eigene Roundtrips bleiben unberührt (`drawio.ts:103–112`). `#000000` wird im Dark Mode über `themeColor` gespiegelt, bleibt also lesbar. P3-Hinweis zum Diagnosebudget (F4). |

## 2) Findings

### F1 · P2 · Tabellenzelle mit nicht sechsstelliger Farbe verwirft die ganze Datei (#156)

- **Ort:** `src/interop/drawio.ts:338`, `src/interop/common.ts:57–70`, `src/domain/validation.ts:201` und `:478`.
- **Ursache:** `color()` lässt `#rgb`, `#rgba`, `#rrggbbaa`, `rgb()/rgba()` und `transparent` (aus `none`) unverändert durch. Die Domäne verlangt für Zell-`fill` und -`color` genau `^#[0-9a-fA-F]{6}$`.
- **Minimale Eingabe:** der `foreignTable`-Helfer aus `153-review.spec.ts` mit `fontColor=#f00;`. Ebenso `fontColor=rgb(255,0,0)`, `fontColor=none`, `fontColor=#ff000080` oder `fillColor=#fff`.
- **Erwartet:** rote Zellschrift, bei Alpha oder `none` eine Annäherung mit `STYLE_APPROXIMATED`.
- **Aktuell:** `finish()` wirft `INVALID_DOCUMENT` (`common.ts:144–150`). Die gesamte Datei, auch mit weiteren Seiten, ist nicht importierbar. Es entsteht kein Teilimport und keine Mutation.
- **Reichweite im eigenen Pfad:** Ein per MCP gesetzter äußerer Tabellenstil wie `stroke: '#f00'` landet über `safeTextColor` als `fontColor=#f00` im Export. Der portable oder stale Rückimport scheitert dann genauso.
- **Fix:** Vor der Zuweisung an `entry.style` auf sechsstelliges Hex normalisieren: `#rgb` expandieren, `rgb()` umrechnen, Alpha und `transparent` mit Warnung auf den Standard setzen. Das ändert die Projektion nicht.
- **Regression:** die fünf Eingaben oben; jeweils Import erfolgreich und Zellfarbe sechsstellig.

### F2 · P2 · Eigener draw.io-Export schreibt bei Tabellen die Rahmenfarbe als `fontColor` (#156/#157, Exportseite)

- **Ort:** `src/interop/export.ts:20–22` und `:264`, `src/domain/factories.ts:37`, `src/renderer/components/SelectionToolbar.vue:239–249`.
- **Ursache:** `safeTextColor` liefert `textColor ?? stroke`. Der äußere Tabellenstil hat standardmäßig `stroke: '#cbd5e1'` und kein `textColor`. Die Toolbar ändert bei Tabellen nur die Zellstile, nie den äußeren Stil.
- **Ablauf:** Standardtabelle anlegen und beschriften. Als draw.io ohne eingebettetes Modell exportieren, oder mit Modell und danach in draw.io irgendetwas ändern. Wieder importieren.
- **Erwartet:** Zelltinte wie im Original (`#242424` oder die gewählte Zellfarbe).
- **Aktuell:** Alle Zellen erhalten `color: '#cbd5e1'` auf `#ffffff`, also kaum lesbaren Text. Weil die Farbe als explizit gilt, gibt es keine Diagnose. In draw.io selbst erscheint das Label ebenfalls hellgrau. Der SVG-Export ist korrekt, er nutzt `cell.style.color` (`export.ts:87`).
- **Fix:** In `nativeDrawio` für Tabellen `fontColor` und `fillColor` aus den Zellen ableiten (einheitliche Zellfarbe, sonst erste Zelle).
- **Haken:** Das ändert die `drawio-v1`-Projektion. Bereits exportierte Dateien mit Tabellen verifizieren danach als stale und verlieren den Envelope-Restore. Deshalb gehört das in ein eigenes Ticket mit bewusster Entscheidung; Root entscheidet.
- **Regression:** Standardtabelle, `prepareDrawioExport(doc, { embedDocument: false })`, Rückimport, Zellfarbe ungleich äußerem `stroke`.

### F3 · P3 · Aufgefüllte Tabs nahe 50.000 Zeichen liefern `INVALID_DOCUMENT` statt `LIMIT_EXCEEDED` (#155)

- **Ort:** `src/interop/drawio.ts:328` und `:340`, `src/domain/validation.ts:1174`.
- **Ursache:** Geprüft wird die Rohlänge des Labels. `tablePlainText` füllt fehlende Zellen mit Tabs auf, bis zu etwa 456 Zeichen mehr.
- **Minimale Eingabe:** `'a\tb\tc\td\te\tf\tg\th\ti\tj\n' + 'x'.repeat(49_975) + '\ny'`. Das sind roh 49.997 Zeichen und 30 Zellen; aufgefüllt 50.015.
- **Erwartet:** `LIMIT_EXCEEDED` oder Annahme.
- **Aktuell:** `INVALID_DOCUMENT` aus `finish()`. Kein Teilergebnis, keine Überallokation; nur der Code weicht vom Kriterium ab.
- **Fix:** Vor `createTableDocument` die aufgefüllte Länge prüfen: Rohlänge plus Summe aus `columnCount − row.length`.

### F4 · P3 · Themehinweis pro Zelle halbiert das Diagnosebudget (#157)

- **Ort:** `src/interop/drawio.ts:110–112`, `src/interop/diagnostics.ts:40–47`.
- **Ursache:** Jede beschriftete Zelle ohne `fontColor` erzeugt eine eigene Warnung, weil der Dedup-Schlüssel Pfad und ID enthält. Bei draw.io-Dateien ist das der Normalfall. Mit `html=1` kommt `TEXT_FORMATTING_LOST` hinzu.
- **Folge:** Ab rund 100 beschrifteten Vertices ist das Limit von 200 erreicht, bevor die Kantenschleife läuft. `EDGE_ENDPOINT_UNRESOLVED` und abgekoppelte Terminals verschwinden hinter `DIAGNOSTICS_TRUNCATED`. Vor #157 lag die Schwelle bei etwa 200.
- **Fix:** Den Hinweis auf fehlendes `fontColor` einmal pro Seite melden. Unaufgelöste explizite Werte wie `default` dürfen pro Zelle bleiben.

## 3) Verbleibende Grenzen und Hypothesen

- **Bidirektionale Exportkanten:** Die 20 Fixtures unter `docs/reviews/fixtures/153-mermaid/` enthalten kein `<-->`, `<-.->` oder `<==>`. Der Export erzeugt `n0 <-->|"t"| n1` (`mermaid.ts:441–445`). Ich erwarte, dass Mermaid 12 das akzeptiert; im gespeicherten Parserbeleg ist es aber nicht abgedeckt. Ein Fixture im bestehenden Checker würde genügen.
- **Gültiges Mermaid mit irreführendem Code:** `A -->|a) b| C` und `subgraph "Titel"` enden als `MERMAID_SYNTAX_INVALID` statt `UNSUPPORTED`. Es gibt keinen Teilimport und keinen stillen Verlust.
- **Viele Envelopes:** Bei `pageIndex: 'all'` löst jede Seite mit eigenem Envelope einen vollen Verifikationsversuch aus (`drawio.ts:263`). Das ist durch 100 Seiten und 96 MiB begrenzt; ungemessen und kein Blocker.
- **Projektionsdrift:** Ein Fixture eines v0.1.1-Exports fehlt weiterhin als Test. Die Richtung bleibt sicher (stale statt falschem Restore).
- **Nicht geprüft:** SVG-Import, P2P-Sitzungsabbau beim Import als Gast über die Autoritätsumschaltung hinaus, Pixel- und Layouttreue in draw.io oder Mermaid.

## Nach Lektüre ohne Befund

- **Mermaid-Import:** Statement-Zerlegung, Kantenformen, Subgraph-Mitgliedschaft und Label-Dekodierung führen bei Abweichungen zu expliziter Ablehnung. Die Scans sind linear, die Limits greifen vor der Expansion.
- **Mermaid-Envelope:** Es gilt nur am Zeilenanfang außerhalb von Quotes und Klammern. Der Vergleich ist zeichengenau bis auf `trim()` und CRLF; Doppelungen sind ein Fehler.
- **Panel-Races:** `serial`, Autoritäts- und Revisionsprüfung verwerfen veraltete Datei-Lesevorgänge und Export-Snapshots. Der Watcher auf Format, Einbettung und Seite räumt synchron auf. `pendingImport` ist eine tiefe Kopie und wird bei Abbruch oder Schließen verworfen.
- **Exportgrenzen:** Browser-Bridge und Electron-Persistenz nutzen für Austauschformate 96 MiB, passend zum Adapter.
