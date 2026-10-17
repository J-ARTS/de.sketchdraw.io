# Codex-Implementierung Interop — Issue #12

Stand: 17.10.2026, lokale uncommittete Änderungen. Tatsächliches Werkzeug: OpenAI Codex. Die fünf zuvor von Antigravity gelieferten Hilfsdateien (`types`, `limits`, `diagnostics`, `xml`, `compression`) wurden erhalten, überprüft und korrigiert; diese Lieferung ist keine weitere Antigravity-Ausführung. Codex übernahm mit ausdrücklicher Nutzerfreigabe nach erschöpften externen Quoten. GitHub-Status, Ledger und Graphify koordiniert Root.

## Implementierter Vertrag

`src/interop/index.ts` exportiert die synchronen, reinen APIs `inspectDrawio`, `importDrawio`, `importSvg`, `prepareDrawioExport`, `prepareSvgExport`, `exportDrawio`, `exportSvg`, Vertragstypen, `InteropError` und Limits. Kein Controller, Dateizugriff, Netzwerk, Live-DOM oder Rendererimport. Vorschau, Dirty-/Save-Dialog, Nutzerbestätigung und Commit bleiben Aufgabe der Store-/Frontendintegration.

- draw.io: echtes mxGraph-XML, raw-DEFLATE/URI/Base64-Seiten, explizite Mehrseitenauswahl, User-Object-Zellen, Eltern-/Portkoordinaten, Rotation, Container, native Formen, inerte HTML-Beschriftung, eingebettete Rasterbilder, lokale `def(n)`-Bildreferenzen sowie gebundene/freie Connectoren. Nicht exakt darstellbare Stencils, Layouts und Routing erhalten Diagnosen bzw. beschriftete Platzhalter.
- SVG: native Primitive, Gruppen/Container, verschachtelte Viewports, Transformketten, lokale `use`-Expansion, Bilder, Text und M/L/H/V/C/S/Q/T/A/Z-Pfade. Kurven werden adaptiv in bearbeitbare Pfade überführt; Bézier- und Bogenabweichung werden unabhängig numerisch geprüft. Skew/Spiegelung wird für Vektoren in Pfade umgewandelt. Nicht unterstützte Textlayouts, Clip-/Filter-/Styleeffekte sind berichtete Annäherungen.
- Beide Exporte erzeugen native editierbare Zeichenobjekte für alle neun Domänenarten. Komponenten erhalten in SVG sichere Katalogicons, in draw.io beschriftete Rechtecke mit Verlustbericht. Keine reine JSON-Hülle. Sichtbarer Text verwendet wie der Canvas `text || label || ''`; Root-Befund zu label-only, leerem `text` und Komponentenlabel ist korrigiert und ohne Metadaten abgesichert.
- Eigene Roundtrips erhalten das vollständige validierte Dokument nur nach Vergleich der gesamten nativen Projektion: Namespaceidentität, Attribute, Reihenfolge, Root-Bounds, Transformationen, Texte, Bildbytes und zusätzliche native Objekte. Attributreihenfolge, Kommentare und strukturelle Formatierung sind unerheblich. Unbekannte Projektionsversionen oder native Änderungen ergeben `EMBEDDED_MODEL_STALE`; beschädigte Envelope-Daten `EMBEDDED_MODEL_INVALID`. Die sichtbare Projektion bleibt bei Fallback maßgeblich.
- Exportresultate enthalten Bericht und `requiresConfirmation`; String-Kompatibilitätsfunktionen werfen `LOSS_CONFIRMATION_REQUIRED` bei Warnungen. Die Importfunktion gibt keinen teilweise validen Kandidaten zurück. Explizite ID-/Titelüberschreibungen werden berichtet.

## Sicherheits- und Ressourcenprüfung

Saxes verarbeitet XML namespacebewusst mit Input-, Knoten-, Tiefen- und Attributgrenzen. DTD, Entities, Processing Instructions, XInclude, doppelte Attribute/IDs und Referenzzyklen werden abgewiesen. Die XML-Knotengrenze wird bei komprimierten draw.io-Dateien gemeinsam über äußere Datei und ausgewählte entpackte Seite angewandt. Exportausgaben werden vor Rückgabe ebenfalls gegen die XML-Importgrenzen geprüft. Text, Diagnosen, Provenienz, generierte Punkte, Assetbytes und kanonische Dokumentgröße bleiben begrenzt. Diagnosen werden bereits bei Aufnahme auf 200 Einträge begrenzt, danach folgt eine Trunkierungswarnung.

Der portable Inflater verwendet das gepinnte `fflate@0.8.3` mit höchstens 1.024 komprimierten Bytes pro Push; Ausgabebytes werden vor Übernahme in die Ergebnissammlung geprüft. Die Quellanalyse der installierten Implementierung berücksichtigt das 32-KiB-Rückblickfenster, maximal 258 Ausgabebytes pro DEFLATE-Längenpaar und die Puffervergrößerung `cbuf(bt + 131072)`. Damit bleibt das temporäre Arbeitsvolumen pro begrenztem Push endlich und im niedrigen MiB-Bereich; die genaue Herleitung steht am Wrapper. Das ist eine Analyse der gepinnten Version, kein gemessener Heap-Benchmark. Vollständigkeit und Restbytes des Streams werden zusätzlich geprüft; diese privaten Zustandsfelder müssen bei einem fflate-Update erneut verifiziert werden. Negative Tests decken Outputlimit, abgeschnittene Streams und angehängte Bytes ab.

Aktiver SVG-/HTML-Inhalt wird weder ausgeführt noch als Live-DOM eingesetzt. Externe Ressourcen erhalten Diagnosen/Platzhalter. Bildassets beschränken sich auf domänenvalidierte PNG/JPEG/WebP-Daten. Farbnamen sind explizit auf die in `common.ts` dokumentierte Menge begrenzt; unbekannte Farben/CSS werden mit Bericht angenähert. Lokale Referenzexpansion und Kurvengenerierung prüfen ihre Budgets vor unbeschränktem Ausbau.

## Tatsächliche Prüfungen

Geprüfter Stand: Dateien in `src/interop/`, `tests/unit/interop/`, `tests/fixtures/interop/` am 17.10.2026; Darwin arm64, Node v22.16.0, Vitest v5.0.5.

| Prüfung | Ergebnis |
| --- | --- |
| `./node_modules/.bin/vitest run tests/unit/interop/interop.spec.ts` | Bestanden: 30 Tests, 1 Datei; abschließender Lauf 16:38:43, 340 ms. |
| `./node_modules/.bin/tsc --ignoreConfig --noEmit --strict --noUnusedLocals --noUnusedParameters --noUncheckedIndexedAccess --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2023,DOM --types node src/interop/*.ts tests/unit/interop/interop.spec.ts` | Bestanden, Exit 0; einschließlich Testdatei. |
| draw.io-/SVG-Fremdprogrammabnahme, Renderer-/Desktopintegration, vollständige Repositorysuite | Hier nicht ausgeführt; wird von Root nach Frontendanbindung separat geprüft. |

Die 30 Tests umfassen unabhängiges natives XML, komprimierte Seiten und Seitenauswahl, alle neun Elementarten mit exaktem eigenen Roundtrip und zusätzlicher nativer Projektion ohne Metadaten, beschriftete Formen, Textink/Opacity, Bilder, Port-/Container-/Anchor-Geometrie, Transformreihenfolge, lokale Wiederverwendung, alle Kurvenbefehle und numerische Fehlergrenzen sowie negative Parser-, Kompressions-, Referenz-, Metadaten- und Budgetfälle. Kein Test ist übersprungen.

Frühere negative Läufe wurden nicht als bestanden gewertet: Sie deckten einen Padding-Bit-Fehler im übernommenen Base64-Decoder sowie falsche Bild-URI-Trennung im draw.io-Style auf. Beide wurden korrigiert; eine initial ungültige Test-Komponentendefinition wurde ebenfalls berichtigt. Die letzte grüne Ausführung enthält diese Korrekturen und den nachfolgenden Root-Labelbefund.

Der Frontendreviewer fand anschließend einen unvollständigen `ElementStyle` im neuen Beschriftungstest. Dieser wurde mit vollständigen Defaults korrigiert. Der gezielte Typecheck wurde deshalb auf die Testdatei erweitert; dessen erste Ausführung ohne explizite Node-Typen scheiterte an `node:fs`/`node:path`/`Buffer`, die oben dokumentierte Ausführung mit vorhandenen Node-Typen ist grün.

Die Fixtures `native.drawio` und `native.svg` sind ausdrücklich handgeschriebene unabhängige Referenzen, keine aus Fremdoberflächen exportierten Dateien. Herkunft und verbleibende Abnahme stehen in `tests/fixtures/interop/README.md`.

## Quellen und verbleibende Integration

Für die native draw.io-Bildsyntax wurde die Primärdokumentation geprüft: `image=data:image/png,<base64>` lässt `;base64` wegen des Styletrennzeichens aus; Import ergänzt es für das domäneneigene Data-URL-Asset. Siehe [Shapes and Stencils](https://github.com/jgraph/drawio/wiki/Shapes-and-Stencils). Seitenkompression, Root-User-Objects und `defs/def data` wurden mit [File Format](https://github.com/jgraph/drawio/wiki/File-Format) abgeglichen.

Nächste Schritte außerhalb dieses Backendumfangs: Root prüft echte diagrams.net-Bearbeitung und Browser-SVG-Darstellung; Frontend verbindet Seitenauswahl, Vorschau, Diagnose-/Verlustbestätigung und bestehende Dokumentwechselregeln. Die von Root bearbeitete 96-MiB-Exportgrenze im Dateiadapter muss diese Ausgabe transportieren können, während native Dokumente weiterhin ihre 32-MiB-Grenze behalten. Plattform-/UI-/MCP-/P2P-Autorisierung ist durch reine Konvertierung nicht ersetzt. Keine Behauptung einer abgeschlossenen Gesamtintegration oder eines abgeschlossenen GitHub-Tickets.
