# Claude-Code-Review zu Kommentaren und Aufgaben (#59)

Datum: 18.10.2026  
Art: echter lokaler, auf Lesen begrenzter Claude-Code-Lauf  
Tatsächliches Tool: Claude Code 2.1.185, Claude Sonnet 5.5, hoher Denkmodus  
Umsetzung und Abnahme: Codex im vom Nutzer autorisierten Vertretungsmodus

Claude Code prüfte das v1-Dokumentmodell, Commands, History, P2P-Weitergabe, Diagram-as-Code, Canvas- und Tabelleninteraktion sowie die vorhandene Panelstruktur. Der Lauf änderte keine Dateien. Antigravity konnte parallel keinen Auftrag annehmen: Die sichtbare Anwendung meldete am 18.10.2026 „Baseline model quota reached“ mit Erneuerung am 24.10.2026 um 15:49:54; der Senden-Button war deaktiviert.

## Empfohlene Architektur

- Kommentar-Threads und Aufgaben liegen als dokumentweite, strukturierte Daten neben den Elementen. Ein Thread besitzt ein normalisiertes Elementziel, optional eine stabile Tabellenzell-ID und einen absoluten Rückfallpunkt.
- IDs und ISO-Zeitstempel werden vom Aufrufer in Commands geliefert; die Domäne liest weder Uhr noch Zufall.
- Ungelesen ist lokaler UI-Zustand und kein gemeinsam replizierter Dokumentinhalt.
- Pins sind feste Bildschirmziele über dem Canvas. Hover und Tastaturfokus zeigen dieselbe Vorschau; ein Klick öffnet Thread und Sidebar.
- Das Aufgabenboard ist eine eigene Workspace-Ansicht, keine vorgezogene Dokumentseite. Ein Thread erzeugt höchstens eine Aufgabe; Aufgabenstatus und Auflösungsstatus des Threads bleiben getrennt.
- `K` ist der Kommentar-Shortcut, weil `C` bereits den Container aktiviert.
- Rich Text oder HTML gehört nicht in Kommentare. Klartext verhindert ausführbare Inhalte und hält Codec, P2P und Export beherrschbar.

## Materielle Bedenken

| ID | Bedenken | Übernommene Behandlung |
| --- | --- | --- |
| CL-CMT-01 | Ein nicht erweiterter Codepfad kann Kommentare beim Anwenden von Diagram-as-Code verlieren. | Kommentare und Aufgaben sind Teil der `document`-Deklaration und werden im Roundtrip getestet. |
| CL-CMT-02 | Der vorhandene lokale Anzeigename ist keine belastbare Identität. | `authorId` und Anzeigename werden getrennt gespeichert; kryptografische Identität wird nicht behauptet. |
| CL-CMT-03 | Peers und Agenten können UI-Regeln zur Bearbeitung eigener Beiträge umgehen. | UI begrenzt Bearbeitung auf die eigene `authorId`; das Dokumentmodell ist weiterhin kein IAM-Beweis. |
| CL-CMT-04 | Viewer dürfen nicht durch den Kommentarpfad schreiben. | Alle Kommentar- und Taskwrites laufen durch dieselbe `canWrite`- und Authority-Grenze. |
| CL-CMT-05 | Element- oder Zelllöschung kann Anchors verwaisen lassen. | Elementlöschung entfernt die Bindung, behält den absoluten Rückfallpunkt und Thread; Zellverlust fällt auf den Elementanker zurück. |
| CL-CMT-06 | Unklare Undo-Semantik erzeugt überraschende Teilzustände. | Abgeschlossene Thread- und Taskwrites sind reguläre History-Transaktionen. |
| CL-CMT-07 | Kommentaränderungen können unnötige Konflikte mit einem offenen Codeentwurf erzeugen. | Codeentwurf bleibt revisionsgebunden; die atomare v1-Kollaborationssammlung ist dokumentiert. |
| CL-CMT-08 | Exporte können private Diskussionen im Sketchdraw-Envelope mitführen. | Exakte Sketchdraw-Roundtrips enthalten Kollaborationsdaten; sichtbare SVG/draw.io-Projektionen zeigen keine Pins. Datenschutzhinweis bleibt Folgearbeit. |
| CL-CMT-09 | Kopieren oder Duplizieren eines Elements darf Threads nicht unbemerkt vervielfältigen. | Element-Clipboard enthält weiterhin nur Elemente und Assets. |
| CL-CMT-10 | Linkkopieren kann in Electron oder Browser scheitern. | Die bestehende abstrahierte Zwischenablage wird verwendet; Fehler bleiben sichtbar. |
| CL-CMT-11 | Unbegrenzte Threads, Beiträge und Aufgaben gefährden Dokumentgröße und Rendering. | Feste Mengen- und Textlimits plus bestehendes 32-MiB-Dokumentbudget. |
| CL-CMT-12 | HTML in Kommentaren eröffnet XSS- und Codec-Probleme. | Ausschließlich Klartext wird gespeichert und als Text gerendert. |
| CL-CMT-13 | Parallele Threadänderungen können auf der v1-Command-Ebene kollidieren. | Owner-sequenzierte Commands und CAS gelten; feingranulare Thread-CRDTs werden nicht behauptet. |
| CL-CMT-14 | Tausende Pins können Canvas und Minimap belasten. | Pins liegen außerhalb der SVG-Projektion und der Minimap; räumliche Filterung bleibt bei gemessenem Bedarf offen. |
| CL-CMT-15 | Ein Task-Board als Seite würde das offene Mehrseiten-Schema #33–#35 vorwegnehmen. | Das Board ist eine appweite Workspace-Ansicht in der Seitensteuerung. |

## Accessibility-Hinweise

Pins, Menüs und Karten müssen echte Buttons mit zugänglichen Namen sein. Hover-Vorschau ist auch per Fokus erreichbar. Escape schließt lokale Ebenen, Fokusziele sollen erhalten bleiben, Status darf nicht nur über Farbe vermittelt werden und jede Drag-Operation braucht benannte Buttons als Alternative. Reduzierte Bewegung und Forced-Colors bleiben Teil der UI-Abnahme.
