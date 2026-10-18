# UI/UX- und Accessibility-Audit

Stand: 18.10.2026. Bezug: [#75](https://github.com/J-ARTS/de.sketchdraw.io/issues/75). Tatsächlicher Reviewer und ausführendes Tool: OpenAI Codex. Die reguläre UI-Zuständigkeit liegt bei Claude Code; Codex hat den Audit im Rahmen der vom Nutzer erlaubten vorübergehenden Übernahme und seiner Testing-Verantwortung ausgeführt.

## Ergebnis

Der Audit bestätigt **sieben reproduzierbare UI/UX- und Accessibility-Bugs**. Vier Befunde haben hohe Priorität, weil Bedienelemente nicht erreichbar sind oder ein als modal ausgezeichnetes Fenster den Fokus nicht beherrscht. Drei weitere Befunde betreffen Überlagerung, Auffindbarkeit und das erwartete Tastaturmuster. Jeder Befund ist als eigenes GitHub-Issue mit Reproduktion und überprüfbaren Akzeptanzkriterien erfasst.

| Priorität | Befund | Nachweis | Ticket |
| --- | --- | --- | --- |
| Hoch | Bei 320 CSS-Pixeln überdeckt „Ansicht und Hilfe“ den Dokumenttitel, das Dateimenü und den Seitenumschalter. Die sichtbaren Steuerelemente bleiben im Accessibility Tree, ihre Mittelpunkt-Treffer landen jedoch auf der darüberliegenden Leiste. | Live-Reproduktion 320 × 568; DOM-Trefferprüfung | [#76](https://github.com/J-ARTS/de.sketchdraw.io/issues/76) |
| Mittel | Bei ausgewähltem Element verdeckt die Eigenschaftenleiste in schmalen Ansichten Überschrift und Schließen-Button der Formen-Seitenleiste. | Live-Reproduktion 320 px; Auswahlleiste z-index 20, Formenleiste z-index 12 | [#77](https://github.com/J-ARTS/de.sketchdraw.io/issues/77) |
| Mittel | Haupt- und Eigenschaftenleiste verstecken einen großen Teil der Aktionen in unsichtbarem horizontalem Überlauf. Bei 320 px misst die Hauptleiste 294 px sichtbar gegenüber 1.145 px Inhalt; die Eigenschaftenleiste blendet ihre Scrollbar aus. | Live-Reproduktion und DOM-Messung; Fokus-Rückgabe verschiebt die Hauptleiste dauerhaft | [#78](https://github.com/J-ARTS/de.sketchdraw.io/issues/78) |
| Hoch | Der modale Plugin-Dialog lässt den Fokus in den abgedunkelten Hintergrund entkommen und stellt ihn beim Schließen nicht wieder her. | Umschalt+Tab vom Schließen-Button fokussiert „Elementaktionen“; Escape endet auf body | [#79](https://github.com/J-ARTS/de.sketchdraw.io/issues/79) |
| Hoch | „Aufgabe bearbeiten“ übernimmt und begrenzt den Fokus nicht; Escape schließt den Dialog nicht. | Live-Reproduktion; Fokus bleibt auf der Aufgabenkarte hinter dem Dialog | [#80](https://github.com/J-ARTS/de.sketchdraw.io/issues/80) |
| Hoch | Der Aufgaben-Dialog schneidet bei 480 × 320 seine Aktionszeile ab und liegt teilweise unter der globalen Kopfzeile. Der nicht scrollende Backdrop ist 320 px hoch, sein Inhalt 452 px; Speichern/Löschen liegen außerhalb des Viewports. | Live-Reproduktion und DOM-Messung | [#81](https://github.com/J-ARTS/de.sketchdraw.io/issues/81) |
| Mittel | Das Menü „Weitere Kommentaraktionen“ besitzt ARIA-Menürollen, aber weder Anfangsfokus noch Pfeiltastennavigation oder Escape-Schließen. | Live-Reproduktion mit Pfeil ab und Escape | [#82](https://github.com/J-ARTS/de.sketchdraw.io/issues/82) |

## Prüfrahmen

Geprüft wurde der lokale Browser-Build auf macOS mit folgenden effektiven Viewports:

- 1.440 × 900: Desktop-Hauptabläufe und schwebende Leisten
- 720 × 450: 200-Prozent-äquivalenter Reflow eines großen Fensters
- 480 × 720: kompakte Darstellung und Seitenleisten
- 320 × 568: WCAG-Reflowbreite, Kopfbereich und Werkzeugüberlauf
- 480 × 320: geringe effektive Höhe, insbesondere modale Dialoge

Die manuell nachvollzogenen Aufgaben umfassten Form anlegen und auswählen, Eigenschaften öffnen, Formenbibliothek öffnen und schließen, Arbeitsbereichsmenü und Plugin-Dialog, Kommentar anlegen, Kommentaraktionen, aus Kommentar eine Aufgabe erzeugen, Aufgabenboard öffnen und Aufgabe bearbeiten. Zusätzlich wurden Fokusziel, Mittelpunkt-Trefferflächen, sichtbarer Ausschnitt, Scrollmaße und Ebenen der betroffenen Oberflächen aus dem gerenderten DOM gelesen. Die Browserkonsole zeigte während dieser Abläufe keine Fehler oder Warnungen.

Automatisierte Regression auf demselben Arbeitsstand:

- npm run typecheck: bestanden
- npm run test:unit: 47 Dateien, 375 Tests bestanden
- npm run test:ui: 61/61 bestanden, einschließlich vorhandener Axe-Prüfungen
- npm run test:electron: 6/6 bestanden
- node --test tests/unit/*.test.mjs: 59/59 bestanden
- npm run build: bestanden
- npm audit --omit=dev: 0 bekannte Produktionsschwachstellen

Die bestehenden Tests bestätigen viele Hauptabläufe, decken die sieben gefundenen Kombinationen aus Modalzustand, Fokus und Reflow aber nicht ab. Ein grüner Axe-Lauf erkennt beispielsweise weder fehlende Escape-Logik noch einen Fokus, der aus einem selbst implementierten aria-modal-Dialog entkommt.

## Positiv bestätigte Muster

- Seiten lassen sich per Doppelklick, Enter und F2 umbenennen; Escape verwirft den Entwurf.
- Die Formen-Seitenleiste fokussiert die Suche, unterstützt Escape und stellt den Fokus zum Auslöser zurück.
- Drag-and-drop-Funktionen für Seiten und Lieblingsformen besitzen Tastaturalternativen.
- Das Zeichenwerkzeug, der Radierer und der Laserpointer haben beschriftete Bedienelemente; Reduced Motion wird beim Laserpointer berücksichtigt.
- Native Dialoge für Hilfe, ungespeicherte Änderungen und Web-Embeds nutzen das Browser-Dialogmodell.
- Die getesteten Standardoberflächen haben in den vorhandenen Axe-Prüfungen keine schwerwiegenden automatisierten WCAG-A/AA-Befunde erzeugt.
- Die wesentlichen kompakten Bedienelemente unterschreiten in der geprüften Grundansicht nicht das 24-Pixel-Minimum; viele Werkzeugziele sind 40 bis 44 px groß.

## Evidenzgrenzen

Die Befunde sind ein technischer Expert Review mit realen Browserinteraktionen und automatisierten Prüfungen. Sie sind keine Nutzerstudie. VoiceOver, NVDA und JAWS wurden nicht in einer echten Assistive-Technology-Sitzung geprüft. Ebenso fehlen in diesem Audit manuelle visuelle Vergleiche auf Windows und Linux sowie Tests mit motorisch, visuell oder kognitiv diversen Teilnehmenden. Diese offenen Prüfungen dürfen nicht als bestanden ausgegeben werden.

Die Reflow-Viewports prüfen die UI-Chrome; der unendliche Diagramm-Canvas selbst darf als räumliche Arbeitsfläche zweidimensional navigierbar bleiben. Die Tickets beziehen sich deshalb auf Dokumentsteuerung, Werkzeugleisten und Dialoge, nicht auf die freie Canvas-Fläche.
