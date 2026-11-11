Du bist der unabhängige kritische Reviewer für Sketchdraw Issue #153 sowie Bestandsfixes #154–#156. Nutzer verlangt tatsächliches Sparring mit Fable 5.2/high. Bitte Code prüfen und einen konkreten kritischen Reviewbericht auf Deutsch ausgeben. Nicht implementieren, nichts schreiben, keine externen Dienste kontaktieren; nur Read/Grep/Glob. Keine Tests behaupten: dir ist kein Ausführungswerkzeug gegeben. Modell/Effort/Laufzeit dokumentiert der aufrufende Codex separat anhand CLI-Ereignissen.

Auftrag: Import/Export SVG, Mermaid und draw.io. SVG/draw.io bereits bestehend. Neu synchroner sicherer Mermaid-Flowchart-Adapter (ausdrücklich KEINE allgemeine Unterstützung aller Mermaid-Typen), vorhandenes Panel um Datei/Textvorschau, Dateibridges erweitert. Bitte kleinste sinnvolle Lösung bewerten; keine riesige komplette Mermaid-Engine verlangen. Flowchart-Subset und klare Fehlermeldungen sind beabsichtigt.

Lese zuerst AGENTS.md/CLAUDE.md bei Bedarf, dann gezielt:
- src/interop/mermaid.ts (neu), types.ts,index.ts,common.ts,diagnostics.ts,limits.ts
- src/interop/drawio.ts, insbesondere Envelope-/Seitenwahl und Tabelle; export.ts/SVG nur relevante Pfade
- src/renderer/components/InteropPanel.vue
- src/platform/browser-bridge.ts, electron/ipc-contract.ts, electron/persistence.ts (Mermaid MIME/Endung/Export und Größen-/Atomicityregeln)
- tests/unit/interop/mermaid.spec.ts, tests/unit/interop/153-review.spec.ts, tests/unit/platform/mermaid-export.spec.ts, tests/ui/interop.spec.ts, neuer Interop-Schritt tests/electron/desktop.spec.ts.

Kritische Fragen:
1. Ist erzeugtes Mermaid syntaktisch auch in echter Mermaid12.3 gültig? Escaping, Unicode, Quotes, Entities, Labels/IDs, Subgraphs, freie Endpunkte, doppelte/dangling IDs, leere Dokumente, Zyklen.
2. Entsprechen importierte Shapes/Kanten/Texte tatsächlich der Quelle oder geht Inhalt still verloren? Werden nicht unterstützte Anweisungen abgewiesen und Layout/Stile/Bilder/Metadatenverluste klar diagnostiziert? Keine Aktivierung von HTML/JS, externem Netzwerk oder Callback.
3. Kann ein veralteter/metadatenmanipulierter Envelope nach externer Bearbeitung Inhalte überschreiben? Aktive Seitenprojektion vs vollständiger Zustand. Eigene unveränderte Roundtrips dürfen gesamte Seiten/Bilder/Notizen halten, portable Projektion nicht als verlustfrei bezeichnen.
4. Sind Ressourcen vor Expansion/Allokation begrenzt (Input, Text, Entities, Node/Kantenprodukt, Tiefen, Tabellen, Kommentare)? Schleifen/regex pathological cases, Prototype-Keys. Guards praktisch, keine gesamte RSS-Garantie behaupten.
5. UI: Format-/Datei-/Seitenwechsel während asynchronem Read/Snapshot/Download, Dirty-Cancel, falsche Vorschau oder alter Snapshot, Rollen-/Gastschutz. Download .mmd/text/plain tatsächlich freigegeben in Renderer/Preload/Main.
6. Regression #154: spätere eigene draw.io-Seite soll IDs/Metadaten exakt zurücklesen, aber fremde Änderungen an jeder Seite dürfen nicht durch stale Envelope verloren gehen. #155 Tabelle darf vor Domänenlimit keine riesige Zellmatrix erzeugen. #156 Schriftfarbe getrennt von Konturfarbe.

P2P-Dateien aus vorheriger Arbeit sind uncommitted und nicht Teil dieses Reviewauftrags. Nicht breit deren Alt-Diff erneut prüfen. Keine Secrets/.env/Auth-Dateien lesen.

Ausgabe: höchstens 8 materielle Findings, je Priorität, konkrete Datei/Zeile/Fall, Auswirkung, minimaler Fix und sinnvolle Regression. Ungeprüfte Hypothesen separat, keine Vermutungen als Repro. Wenn keine weiteren Findings, klaren begrenzten Scope und Testlücken nennen. Nicht nur Implementiererannahmen wiederholen.
