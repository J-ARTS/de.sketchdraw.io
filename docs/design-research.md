# Sketchdraw — UI/UX-Recherche und Implementierungsbrief

Stand: 17.10.2026. Issue: [#5](https://github.com/J-ARTS/de.sketchdraw.io/issues/5), Gesamtziel [#4](https://github.com/J-ARTS/de.sketchdraw.io/issues/4). Recherche: interne Codex-Unterstützung, Run `codex-research-001`. Claude Code bleibt für Frontend-Design und -Implementierung verantwortlich; dieses Dokument ist kein Nachweis einer bereits erfolgten Claude-Arbeit oder fertigen Produkt-UI.

**Empfehlung:** Eine freie Zeichenfläche mit kompakter Werkzeugleiste nach dem beobachteten Excalidraw-Prinzip. Cloud-Katalog, Code und ausführliche Eigenschaften sind gezielt aufklappbare Arbeitsmittel. Die ausdrückliche Nutzervorgabe „sehr simpel wie Excalidraw“ bestimmt den Grundaufbau. Sie legt keine Marke, Farbe, Schrift oder handgezeichnete Linienoptik fest.

## Research Brief

- Ziel: ein lokal arbeitender visueller Editor für Zeichnen, Architektur, Diagrammcode, Agentenbearbeitung und direkte Zusammenarbeit.
- Referenzepisoden aus dem Nutzerauftrag: [Excalidraw](https://excalidraw.com/), [Azure Diagrams](https://azurediagrams.com/) und [diagrams.net](https://app.diagrams.net/); die gewünschte Einfachheit wurde vom Koordinator ausdrücklich übergeben.
- Verbindliche Grenzen: Electron, Vue 3, TypeScript; Menschen können Agentenergebnisse weiterbearbeiten; Text und Canvas bilden dasselbe Dokument; kein zentraler Dokument-, Signaling- oder Relay-Dienst. Siehe [Architektur](architecture.md) und [Sprintabnahme](sprints.md).
- Recherchefacetten: sofortiger Zeichenbeginn, Werkzeugwahl, Eigenschaften, Katalogsuche, leere Zustände, Codefehler, Fokus und Zusammenarbeit.
- Methode: eigene öffentliche Browser-Tabs, sichtbare UI und Accessibility-Baum, ergänzende offizielle Dokumentation. Keine Anmeldung, kein Export/Upload, keine Sitzung gestartet und keine Nutzerdiagramme bearbeitet. Auf Azure wurde eine neue leere Arbeitsfläche geöffnet; bei draw.io wurden nur nicht eingefügte Vorschauentwürfe geprüft.
- Umgebung: Codex In-app Browser auf macOS, Screenshots 1280 × 720. Excalidraw und draw.io erschienen deutsch, Azure Diagrams englisch. Keine exakten Produkt-Buildnummern erhoben. Beobachtungen gelten für diese Sitzung; Layout kann von gespeicherten Einstellungen und Produktupdates abhängen.
- Grenzen: kein vollständiges Accessibility-Audit, kein Screenreader-Test, keine Performance-, Offline-, Mobil-, Persistenz- oder Mehrnutzerprüfung der Fremdprodukte. Keine Aussagen über deren interne Transportarchitektur aus der UI abgeleitet.

## Referenzen und Evidenz

Alle externen Quellen wurden am **17.10.2026** aufgerufen. `L` bedeutet live beobachtet, `D` offizielle Dokumentation, `R` daraus abgeleitete Empfehlung. Hohe Konfidenz gilt für die konkret sichtbaren Zustände, nicht für eine allgemeine Produktbewertung. [Evidenzindex mit Dateinamen, Interaktionsablauf und SHA-256](research/2026-10-17/README.md).

| Quelle | Beobachtetes Muster | Übertragbarer Nutzen | Grenze / nicht ungeprüft übernehmen |
| --- | --- | --- | --- |
| [Excalidraw](https://excalidraw.com/) — L, hoch | Oben mittig eine schwebende Werkzeugleiste; viel freie Fläche; Zoom und Undo unten links. Eigenschaften erscheinen bei Werkzeugwahl links. Bibliothek rechts optional. | Kleine ständige Bedienoberfläche; Werkzeuge und Dokumentaktionen räumlich trennen; Optionen nach Bedarf. | Handschrift, violetter Akzent, Werbung und Bibliotheksinhalte sind keine Sketchdraw-Vorgaben. |
| [Azure Diagrams](https://azurediagrams.com/) — L, hoch | Linker Katalog mit Suche, Kategorien und Serviceeinträgen; Canvas rechts; Beispiele am unteren Rand. | Servicebezeichnungen plus Icon helfen beim Auffinden fachlicher Komponenten. | Ein dauerhaft breiter Katalog beschränkt die freie Fläche. Azure-zentrierte Taxonomie passt nicht unverändert zu mehreren Cloud-Anbietern. |
| [diagrams.net](https://app.diagrams.net/) — L, hoch | In der beobachteten Standardansicht Menü und Werkzeugzeile, Shapes links, Formatbereich rechts, Seiten unten. Bibliotheken separat auswählbar. | Breite Formatauswahl, explizite Bibliotheksverwaltung und kontextbezogene Eigenschaften. | Informationsdichte des Anfangszustands widerspricht der gewünschten Einfachheit als Standard. Andere draw.io-Themes existieren. |
| [draw.io Editor themes](https://www.drawio.com/docs/manual/editor/appearance/) — D, hoch | Dokumentiert alternative Simple-, Minimal- und Sketch-Oberflächen mit veränderter Sichtbarkeit von Panels. | Umfangreiche Fähigkeiten müssen nicht gleichzeitig sichtbar sein. | Diese alternativen Themes wurden in dieser Recherche nicht live umgeschaltet oder getestet. |
| [draw.io Mermaid](https://www.drawio.com/docs/manual/mermaid/) — D, mittel für tatsächlichen Laufzeit-Roundtrip | Dokumentiert editierbare Formgruppen, gespeicherten Quelltext und Regeneration mit Verlust manueller Geometrieänderungen. | Roundtrip-Grenzen gehören sichtbar zum Produktvertrag. | Das Verhalten nach Einfügen/Regeneration wurde nicht live geprüft; eine weitere offizielle Seite widerspricht Teilen dieser Beschreibung, siehe unten. |

### Excalidraw: konkrete Beobachtungen

1. Der Startzustand zeigt einen Hinweis auf begrenzte Browserspeicherung und Dateiablage, ohne den Beginn zu sperren. Die Toolbar enthält Auswahl, Hand, Grundformen, Pfeil/Linie, Freihand, Text und zusätzliche Werkzeuge. Tastenkürzel sind im Accessibility-Baum an Werkzeugen vorhanden. Beleg: `excalidraw-start.jpg`.
2. Klick auf Rechteck blendet links Farben, Strichstärke, Konturstil, Liniencharakter, Kanten, Deckkraft und Ebenenreihenfolge ein. Dafür musste kein Element erstellt werden. Escape setzte anschließend das Auswahlwerkzeug zurück. Beleg: `excalidraw-rectangle-tool.jpg`.
3. Die Bibliothek lässt sich getrennt öffnen und schließen; der leere Zustand erläutert zwei nächste Schritte. Der rechte Bereich besitzt eine Funktion zum Offenlassen. Das genaue Verhalten einer angehefteten Bibliothek wurde nicht geprüft. Beleg: `excalidraw-library.jpg`.
4. Der Zusammenarbeitsdialog bietet Sitzungsstart und Linkexport als getrennte Aktionen. Escape schloss ihn, der Fokus kehrte zur auslösenden Schaltfläche zurück. Keine dieser Freigabeaktionen wurde ausgeführt. Beleg: `excalidraw-collaboration.jpg`.

Visuell: weiße Fläche, kleine neutrale Beschriftungen, überwiegend Icons mit leichtem Akzent für aktive Zustände, schmale Abstände innerhalb kompakter Gruppen und großzügiger Abstand zur Arbeitsfläche. Der Werkzeugbereich und die Eigenschaften haben abgerundete, dezent abgesetzte Flächen. Das ist eine beobachtete Hierarchie, keine Vermessung von Design-Tokens oder Kontrast.

### Azure Diagrams: konkrete Beobachtungen

1. Der Einstieg bot Beispiele oder eine leere Arbeitsfläche. Nach Wahl der leeren Fläche blieb der linke Katalog sichtbar; im Screenshot nimmt er ungefähr 300 von 1280 Pixeln ein. Die Fläche verwendet ein feines Punktraster. Belege: `azure-start.jpg`, `azure-canvas.jpg`.
2. Eingabe `storage` ersetzt die Kategorien durch einen Treffer mit Hauptbezeichnung „Azure Storage“ und Untertitel „DATA LAKE STORAGE“. Ein Klick auf dessen Text erzeugte keine sichtbare Zustandsänderung; ein Einfügen per Klick oder Drag wurde damit nicht nachgewiesen. Beleg: `azure-search.jpg`.
3. Eingabe `sketchdraw-nomatch-001` erzeugte eine leere Trefferfläche ohne sichtbare Erläuterung. Für Sketchdraw sollte ein Nulltrefferzustand Suchbegriff, Rücksetzen und eine hilfreiche Anschlussaktion zeigen. Beleg: `azure-search-empty.jpg`.

Visuell: neutrale serifenlose UI-Schrift, Icons neben beschrifteten Kategorien, blaue Cloud-Markenfarben in den Service-Icons, hellgrauer Katalog und weiße Zeichenfläche. Kategorien sind großzügiger vertikal getrennt als die Werkzeuggruppen in Excalidraw. Mehrere Icon-Schaltflächen hatten im gelieferten Accessibility-Baum keinen Namen; das ist ein Prüfhinweis, kein abschließender WCAG-Befund.

### diagrams.net: konkrete Beobachtungen und Dokumentationsgrenze

1. Die gleichzeitig sichtbaren Seitenbereiche reduzieren die verfügbare Canvas-Breite deutlich. Der Dialog „Mehr Shapes“ gruppiert Bibliotheken und enthält unter anderem AWS, Azure und Google Cloud. Es wurde keine Bibliotheksauswahl übernommen. Belege: `diagrams-start.jpg`, `diagrams-libraries.jpg`.
2. Anordnen → Einfügen → Mermaid öffnet einen Textdialog mit den Optionen Diagramm/Bild, Vorschau und Einfügen. Das ist ein separater Import-/Generierungsweg; ein dauerhaft synchroner Code-Split ist hiermit nicht nachgewiesen. Beleg: `diagrams-mermaid.jpg`.
3. Die Vorschau des Entwurfs `graph TD\n A -->` zeigte eine einzelne Form A, keinen Fehler. Dieser Versuch ist kein Nachweis strenger Syntaxvalidierung. `not-a-diagram` führte anschließend zu einem Fehlerdialog. Nach dessen Bestätigung blieb der Entwurf erhalten. Beleg: `diagrams-mermaid-error.jpg`.
4. Schließen des veränderten Entwurfs zeigte eine zusätzliche generische Rückfrage. Diese wurde abgebrochen, nichts eingefügt. Für Sketchdraw ist eine konkrete Formulierung wie „Codeentwurf verwerfen?“ verständlicher. Beleg: `diagrams-mermaid-close-confirm.jpg`.

Visuell: dichte Icon-Werkzeugleiste, neutrale Flächen, kleinere Beschriftungen in den Seitenbereichen, blaue Aktionshervorhebung und Gitternetz auf der Seite. Die hohe Dichte unterstützt erfahrene Nutzer, erhöht aber die anfängliche Auswahlbelastung; das ist eine Designbewertung, keine gemessene Usability-Zahl.

**Quellenkonflikt:** Die [Mermaid-Hauptseite](https://www.drawio.com/docs/manual/mermaid/) beschreibt eine erneut bearbeitbare Formgruppe; die [Seite „Insert Mermaid code“](https://www.drawio.com/docs/manual/insert/insert-mermaid/) sagt weiterhin, dass nach Konvertierung in Shapes keine Codebearbeitung möglich sei. Deshalb wird keine ungeprüfte pauschale Aussage über den aktuell ausgelieferten Roundtrip getroffen. Beide Texte grenzen die Bildvariante von der Bearbeitung einzelner Formen ab. Für Sketchdraw ist unabhängig davon ein eigener Nachweis der vollständigen Text-/Canvas-Synchronisation erforderlich.

## Design Directions

| Richtung | Aufbau und Nutzen | Tradeoff | Bewertung |
| --- | --- | --- | --- |
| **A — Freie Zeichenfläche mit optionalen Panels** | Wenige zentrale Zeichenwerkzeuge; Eigenschaften zur Auswahl; Katalog, Code und Zusammenarbeit explizit öffnen. | Selten verwendete Funktionen brauchen gute Benennungen, Suche und Tastenkürzel. | **Empfohlen.** Direkt aus der Nutzervorgabe und Excalidraw-Beobachtung abgeleitet. |
| B — Architekturwerkbank | Katalog von Beginn an links; Eigenschaften rechts; schneller Zugriff für viele Cloud-Komponenten. | Dauerhaft weniger Fläche und höhere visuelle Dichte. | Optionaler späterer Arbeitszustand durch angeheftete Panels; kein vorgeschlagener Standard. |
| C — Canvas und Code dauerhaft nebeneinander | Änderungen und Struktur gleichzeitig sichtbar; gut für textorientierte Architekturarbeit. | Verlangt mehr Fensterbreite und macht Syntax für reine Zeichenaufgaben ständig präsent. | Optional über Code-Schalter; als Grundzustand zu schwergewichtig. |

Es ist kein separates Theme-System mit drei eigenständigen Oberflächen erforderlich. B und C können Zustände derselben Oberfläche sein. So bleiben Werkzeugorte und Lernaufwand stabil.

## Recommendation und konkrete Komponentenanforderungen

| ID | Anforderung | Grundlage / Status |
| --- | --- | --- |
| UI-R01 | Neues Dokument öffnet direkt eine nutzbare Canvas. Leerer Zustand bietet einen kurzen Hinweis, Datei öffnen und Tastaturhilfe. | Explizite Einfachheit + Excalidraw L; empfohlen |
| UI-R02 | Kompakte Werkzeugleiste: Auswahl, Pan, Shape, Verbindung, Freihand und Text direkt erreichbar; Bilder/Container und weitere Werkzeuge sinnvoll zugänglich. Aktives Werkzeug sichtbar und programmatisch markiert. | Excalidraw L + Produktvision; genaue Gruppierung entscheidet Claude Code |
| UI-R03 | Eigenschaften kontextbezogen; erweiterte Geometrie, Metadaten und Links nicht ständig im Grundzustand. Mehrfachauswahl zeigt gemeinsame bzw. gemischte Werte korrekt. | Excalidraw/diagrams.net L; empfohlen |
| UI-R04 | Ein Katalogschalter öffnet Suche und Filter für generisch/AWS/Azure/GCP/eigene Sets. Treffer tragen Namen und Herkunft. Einfügen funktioniert auch ohne Ziehen. | Azure/diagrams.net L; empfohlen |
| UI-R05 | Code ist jederzeit auffindbar, initial geschlossen. Öffnen/Schließen verändert weder Dokument noch Auswahl. Fehler zeigen Zeile/Spalte und erhalten Entwurf sowie letztes gültiges Modell. | Architektur + diagrams.net L; erforderlich |
| UI-R06 | Dokumenttitel und Speicherzustand bleiben unaufdringlich sichtbar: geändert, Speicherung läuft, gespeichert, Fehler. Eine Fehlermeldung nennt einen nächsten Schritt; Erfolg nur nach bestätigter Persistenz. | Excalidraw-Speicherhinweis L + lokale Architektur; erforderlich |
| UI-R07 | „Zusammenarbeiten“ öffnet einen konkreten direkten Pairing-Flow: Einladung erzeugen/kopieren, Antwort übernehmen, Identität vergleichen, Rolle prüfen, Verbindung bestätigen. | Eigenes Architekturkonzept, **kein beobachtetes Referenzverhalten** |
| UI-R08 | Peer-Zustände unterscheiden warten, verbunden, getrennt und fehlgeschlagen. Bei Netzwerkgrenzen bleibt die lokale Arbeit möglich; keine unhaltbare Zusage universeller Internetverbindung. | Strict-P2P-Vorgabe; erforderlich |
| UI-R09 | Agentenänderungen sind als normale editierbare Elemente sichtbar und über dieselbe Historie nachvollziehbar. Konflikte nennen betroffene Änderung und lassen menschliche Arbeit bestehen. | Produktvision/Architektur; erforderlich |
| UI-R10 | In kleineren Fenstern wechseln optionale Panels zu einem aktiven Bereich; Inhalte und Fehler bleiben erreichbar. Verkleinern schließt keinen Codeentwurf stillschweigend. | Platzbedarf der Referenzen L; konkrete Anpassung noch zu prüfen |
| UI-R11 | Import/Export zeigt Format, unterstützte Bearbeitbarkeit und konkrete Informationsverluste. Warnungen unterscheiden Vorschau/Bild von semantisch bearbeitbaren Elementen. | Produktvision + draw.io D; erforderlich |

### Typografie, Tokens und Bewegung

Dies sind Implementierungsvorschläge für Claude Code, keine bestätigten Markenpräferenzen: eine gut lesbare UI-Schrift und separate Monospace-Schrift im Code; kleine, konsistente Iconfamilie; neutrale Flächen mit einem funktionalen Aktionsakzent; sichtbarer Fokus, Auswahl und Fehler auch ohne Farberkennung. Der freie Canvas darf optisch ruhig sein, Beschriftungen und Zustände dürfen dafür nicht zu blass werden. Keine neue Markenfarbe und keine Handschrift als Standard festgelegt.

Token-Verträge sollten Rollen ausdrücken, etwa `surface.canvas`, `surface.panel`, `text.primary`, `text.muted`, `border.default`, `focus.ring`, `selection`, `status.error`, `control.size`, `space.*` und `panel.width`. Startwerte für Abstände oder Panelbreiten sind an echten 1280 × 800 und kleineren Fenstern zu prüfen; die Referenzscreenshots liefern keine fertige Token-Spezifikation.

Panel- und Auswahlwechsel brauchen höchstens kurze funktionale Übergänge. Reduzierte Bewegung respektieren; kein Auto-Pan wegen gewöhnlicher Peer- oder Agentenänderungen. Keine dekorativen Bildassets oder generierten Moodboard-Bilder nötig. Cloud-Icons nur mit dokumentierter Herkunft und Nutzungsprüfung übernehmen.

## Human Preference Check

- Bestätigt: einfache, Excalidraw-nahe Bedienung; drei konkret benannte Referenzprodukte; alle sechs Produktfähigkeiten bleiben erhalten.
- Nicht bestätigt: violette Farbe, handschriftliche UI, skizzenhafte Linien als Standard, dunkles Standardtheme, fest angehefteter Katalog, dauerhaft offener Code.
- Abgeleitete Hypothese mit hoher Plausibilität: wenig ständige Oberfläche unterstützt die gewünschte Einfachheit. Dies ist durch die explizite Vorgabe hinreichend für Richtung A; keine zusätzliche Freigabe wird allein aufgrund dieser Recherche eingeführt.
- Nicht gewählt als Standard: B und C wegen dauerhaft höherer Dichte. Das ist die begründete Empfehlung, keine erfundene Ablehnung durch den Nutzer.
- Folgearbeit: Claude Code konkretisiert die visuellen Details in #10 und später #11, dokumentiert Entscheidungen und tatsächliche UI-Prüfungen; gemeinsame Verträge werden vorher mit Codex/Antigravity abgeglichen.

## Zugänglichkeit und UI-Testmatrix

Die Matrix beschreibt **noch auszuführende Sketchdraw-Tests**. Sie ist kein Testpass und kein Konformitätsnachweis. Als Grundlage dienen [WCAG: Keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html), [Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html), [Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) und [Focus Not Obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html).

Drag-Alternativen und Tastaturbedienung sind getrennt zu prüfen: ein Tastenkürzel allein ersetzt keine einfache Pointer-Bedienung ohne Ziehen. Für Bedienelemente gilt als Baseline mindestens 24 × 24 CSS-Pixel oder eine korrekt geprüfte Ausnahme; größere wichtige Ziele sind vorzuziehen. Das ist eine Mindestanforderung, keine Empfehlung, alle Werkzeuge möglichst klein zu bauen.

| Test-ID | Aufgabe / Zustand | Erwartung | Nachweis und Federführung |
| --- | --- | --- | --- |
| UI-T01 | Leeres Dokument bei 1280 × 800 und 960 × 640 öffnen | Zeichenbeginn ohne Dialog; Werkzeuge erreichbar; keine konkurrierenden offenen Panels | Screenshots + Browser-Test, Claude Code/Codex |
| UI-T02 | Shape, Text, Bild, Pfad, Connector und Container erzeugen und bearbeiten | Jede Elementart bleibt selektierbar und editierbar; ein abgeschlossener Eingriff = sinnvolle Undo-Einheit | UI-Flows + Modellvergleich, Claude Code/Antigravity |
| UI-T03 | Auswahl/Drag/Resize bei 25 %, 100 % und 200 % Canvas-Zoom | Zeigerposition und Geometrie stimmen; Panelöffnung verschiebt keine Dokumentkoordinaten | Interaktionstest + gespeicherte Geometrie, Codex |
| UI-T04 | Toolbar, Katalog, Eigenschaften und Code nur per Tastatur nutzen | Sichtbarer Fokus; verständliche Namen; Escape wirkt kontextbezogen; Rückkehr zum Auslöser; keine Falle | Manuelle Tastaturfolge + automatisierte Fokusprüfung, Claude Code/Codex |
| UI-T05 | Komponente einfügen, versetzen, Größe ändern und verbinden ohne Drag | Gleichwertige klickbare Aktionen bzw. Koordinatenfelder vorhanden | Pointer-only-Test, Claude Code/Codex |
| UI-T06 | Katalog: Treffer, Nulltreffer, unbekanntes Set und beschädigtes Icon | Hilfreiche Zustände, Name/Herkunft erhalten; keine leere rätselhafte Fläche | Fixtures + Screenshots, Claude Code/Antigravity |
| UI-T07 | Ungültigen Code eingeben, Panel wechseln, schließen und wieder öffnen | Entwurf erhalten; Fehlerlokation zugänglich; letzter gültiger Canvas unverändert | Parserrevision + UI-Trace, Claude Code/Antigravity |
| UI-T08 | Canvas verschieben/stylen → Code ändern → zurück | IDs, Positionen, Stile und Verbindungen erhalten; kein stilles Neulayout | Roundtrip-Diff + sichtbare Bearbeitung, Codex |
| UI-T09 | Während Codeentwurf ein Peer-/Agentenupdate empfangen | Konflikt erklärbar; kein stilles Überschreiben; beide Stände sicher zugänglich | Zwei-Revisions-Fixture + UI-Trace, Antigravity/Codex |
| UI-T10 | Speichern scheitert / Datei wurde extern geändert | Kein falsches „gespeichert“; Entwurf bleibt; Wiederholen oder Kopie möglich | Desktop-Fehlerfälle, Antigravity/Codex |
| UI-T11 | Pairing abbrechen, Paket ungültig, Fingerprint falsch, Netzwerk unerreichbar | Passende konkrete Meldung; kein Datenversand vor Freigabe; lokale Arbeit bleibt möglich | Zwei echte Peers + Fehlerfälle, Antigravity/Codex |
| UI-T12 | Viewer versucht Bearbeitung; Peer trennt und verbindet erneut | UI zeigt Rolle; Domäne/Transport erzwingen Rechte; nachvollziehbarer Zustand | Negative Integrationstests und UI, Antigravity/Codex |
| UI-T13 | Import mit Verlusten; SVG-Bild gegenüber editierbaren Elementen | Bericht vor Übernahme lesbar; betroffene Elemente benannt; Bearbeitbarkeit korrekt | Reale Format-Fixtures + UI, Antigravity/Codex |
| UI-T14 | Light/Dark, 200 % UI-Zoom, lange deutsche Labels, reduzierte Bewegung | Fokus und Fehler nicht verdeckt; Text/Kontrollen nicht abgeschnitten; ausreichende gemessene Kontraste | Screenshots + Kontrast-/Fokusprüfung, Claude Code/Codex |
| UI-T15 | Screenreader: Werkzeug, Auswahl, Elementliste, Fehler, Status | Sinnvolle Namen/Rollen; nicht jede Drag-Vorschau ansagen; funktionale Elementnavigation | VoiceOver und plattformgerechte weitere Prüfung, Claude Code/Codex |

## Architektur-Bedenken für das zentrale Register

Diese IDs sind **Research-IDs**, noch keine bestätigten Registerentscheidungen. Codex übernimmt sie nach Prüfung in `docs/concerns.md`; es wird kein gemeinsames Register durch diesen Rechercheauftrag geändert.

| ID | Bedenken und Auswirkung | Empfehlung / Abnahmenachweis | Betroffene Zuständigkeit |
| --- | --- | --- | --- |
| DR-C01 | Generierter SVG-Output oder Regeneration ist kein vollständiger bidirektionaler Editor; Layout könnte verloren gehen. | Stabile Element-IDs, Geometrie und Stile in der Syntax; UI-T08 mit echten semantischen Roundtrips. | Codex Architektur; Antigravity Codec; Claude Code |
| DR-C02 | Codeentwurf und gültiges Modell konkurrieren mit Canvas-/Peeränderungen; automatische Anwendung kann Arbeit löschen. | Separate Entwurfs-/Revisionszustände, strukturierte Fehler und sichtbare Konfliktbehandlung; UI-T07/T09. | Gemeinsamer Vertrag vor UI-Implementierung |
| DR-C03 | Von Excalidraw übernommene Link-/Sitzungsrhetorik könnte Strict P2P und erreichbare Netzwerke falsch darstellen. | Eigenes Pairing-Zustandsmodell, Fingerprint/Rolle und verständlicher Fehlerpfad; UI-T11/T12. | Antigravity Transport/IAM; Claude Code; Codex |
| DR-C04 | Ein grafischer Renderer allein liefert keine zugängliche Objektbearbeitung. | Semantische Elementnavigation, benannte Werkzeuge, Tastatur und Pointeralternativen; UI-T04/T05/T15. | Claude Code; Vertrag mit Domäne |
| DR-C05 | Katalog, Eigenschaften und Code gleichzeitig offen verdrängen die Arbeitsfläche. | Progressive Panels und ein konsistenter Fokus-/Entwurfsvertrag; UI-T01/T14. | Claude Code |
| DR-C06 | Lokales Arbeiten kann mit „automatisch gespeichert“ verwechselt werden; Speicherfehler oder Konflikte werden sonst unsichtbar. | Persistenzstatus aus bestätigten Ergebnissen, Entwurfserhalt und Wiederherstellungsweg; UI-T10. | Antigravity Desktop; Claude Code |
| DR-C07 | Icons und SVG-Importe können Darstellung, Lizenzherkunft und editierbare Semantik auseinanderfallen lassen. | Provenienz und sichere Assetprüfung; Verlustbericht statt stiller Rasterisierung; UI-T06/T13. | Antigravity Katalog/Interop; Codex |

## Übergabe und tatsächlich ausgeführte Prüfungen

- Erzeugt: dieses Briefing, [Evidenzindex](research/2026-10-17/README.md), 13 echte Browser-Screenshots. Kein Produktcode geändert.
- Bestätigt: drei Live-UIs erreichbar; oben aufgeführte Zustandswechsel tatsächlich beobachtet; gespeicherte Schlüsselbilder visuell gegengeprüft. Der Web-Textabruf allein war bei den drei JavaScript-Apps nicht aussagekräftig und wurde nicht als UI-Beleg verwendet.
- Inhalt/Format: bestanden — alle 20 lokalen Markdown-Verweise erreichbar, 13 gültige JPEGs mit 1280 × 720 Pixeln, keine nachgestellten Leerzeichen in den beiden Markdown-Dateien. Screenshot-Hashes stehen im Evidenzindex; geprüfte Datei-Hashes und Umfang im [Prüfprotokoll](research/2026-10-17/validation.txt). Keine unbestätigten Testpasses in der Matrix.
- Nicht ausgeführt: Sketchdraw-UI-Tests und Plattformprüfungen, weil dieser Auftrag Research und keine Produktimplementierung umfasst. Ebenso keine Roundtrip-, Offline- oder Kollaborationstests der Fremdprodukte.
- Nächster Schritt: Codex prüft die Research-Bedenken gegen Architektur und Verträge; Claude Code erhält diese Evidenz als Ausgangspunkt, konkretisiert Richtung A und legt die tatsächliche UI-Abnahme für #10/#11 vor.
