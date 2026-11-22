# Zweite Codeprüfung von Sketchdraw

**22. November 2026 · main bei `14001e6` · 11 Befunde.** Diese Evaluierung verfolgt Benutzeraktionen durch den Produktcode bis zum gespeicherten, übertragenen oder exportierten Ergebnis. Untersucht wurden Tabellen, Folien, Bildimport, Zwischenablage, Aufgaben und Jira sowie die Import- und Exportpfade für Mermaid, SVG und draw.io. Die Aussagen sind aus dem Quelltext abgeleitet. Es gab keine Testausführung, Bedienprobe oder Änderung am Produktcode. [Geprüfter Commit](https://github.com/J-ARTS/de.sketchdraw.io/commit/14001e675fa9c4122c0b3a9c969266a261399e45) · [Audit #267](https://github.com/J-ARTS/de.sketchdraw.io/issues/267)

## Priorität

Zuerst sollten die Tabellenlöschung und die Jira-Zuordnung korrigiert werden. In beiden Fällen kann eine reguläre Aktion ein anderes Objekt ändern als das ausgewählte. Vor dem Teilen exportierter Tabellen ist relevant, dass ein im Canvas verdeckter Zelltext in der sichtbaren Datei wieder erscheint. Für die Wiederherstellung eigener Dokumente sind der asynchrone Mermaid-Pfeil und die gleichbleibenden SVG-/draw.io-Versionsnummern die wichtigsten Befunde.

## Abgleich mit dem ersten Audit

Auf `ddde566a` übertrug der Jira-Speicherpfad geänderte Titel und Beschreibungen nicht. Der aktuelle Code reicht beide Felder weiter. Der Aufgabenstatus bleibt inzwischen bis zum Speichern im Formularentwurf. Auch die Erkennung reiner Linkänderungen in Haftnotizen verwendet jetzt denselben Vergleich wie das Übernehmen des Textes. Der neue Jira-Befund betrifft dagegen die Identität von Tickets über Sites hinweg. Der Fehler mit verdeckten Tabelleninhalten war bereits in #197 als Einschränkung dokumentiert. [Jira- und Entwurfsänderungen](https://github.com/J-ARTS/de.sketchdraw.io/commit/41dc689698fadb7ee14c3ce48839799021693147) · [Frühere Tabellenentscheidung](https://github.com/J-ARTS/de.sketchdraw.io/issues/197)

## Fehler im Einzelnen

### Tabelle: Löschen nach dem Verschieben trifft die falsche Zeile oder Spalte

Eine Tabelle hat die Zeilen A und B. A markieren, unter B verschieben und ohne erneute Auswahl „Zeile löschen“ wählen.

A bleibt über die Zell-IDs markiert. Der Löschbefehl greift auf den bei der Auswahl gespeicherten Index 0 zu. Dort steht jetzt B. Die gleiche Abfolge betrifft Spalten.

**Korrektur.** Die Zeilen- oder Spalten-ID für die Strukturaktion verwenden oder ihre aktuelle Position aus den ausgewählten Zellen ermitteln. Löschen muss die sichtbar markierte Zeile bzw. Spalte treffen.

Priorität hoch. [#285](https://github.com/J-ARTS/de.sketchdraw.io/issues/285) · [whiteboard.ts L748](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/renderer/state/whiteboard.ts#L748) · [whiteboard.ts L2008](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/renderer/state/whiteboard.ts#L2008) · [whiteboard.ts L2032](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/renderer/state/whiteboard.ts#L2032) · [whiteboard.ts L2040](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/renderer/state/whiteboard.ts#L2040) · [table.ts L137](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/domain/table.ts#L137)

### Jira: Gleiche Ticketschlüssel aus verschiedenen Sites überschreiben dieselbe Aufgabenkarte

Eine Karte für TEAM-7 aus Site A im Dokument behalten und auf ein konfiguriertes Profil für Site B wechseln. Auch dort existiert ein TEAM-7. Einen erfolgreichen Abruf auslösen.

Der Abgleich sucht allein nach TEAM-7. Titel, Status, Remote-ID und URL der vorhandenen Karte werden mit dem Vorgang von B überschrieben. Auch ein Schreibauftrag adressiert den Schlüssel auf der aktiven Site.

**Korrektur.** Die Site zusammen mit einer stabilen Ticket-ID speichern und vergleichen. Eine Karte aus einer anderen Site darf weder überschrieben noch an die aktive Site zurückgeschrieben werden.

Priorität hoch. [#286](https://github.com/J-ARTS/de.sketchdraw.io/issues/286) · [whiteboard.ts L103](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/renderer/state/whiteboard.ts#L103) · [whiteboard.ts L227](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/renderer/state/whiteboard.ts#L227) · [whiteboard.ts L2433](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/renderer/state/whiteboard.ts#L2433) · [plugin-service.ts L1678](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/electron/plugin-service.ts#L1678)

### Export verbundener Tabellenzellen zeichnet verdeckte Zelltexte wieder sichtbar

In A1 „Freigabe“ und in B1 „Interner Entwurf“ eintragen. Beide Zellen verbinden und als SVG oder als draw.io-Tabellenbild exportieren. Die sichtbare Ausgabe ist auch ohne eingebettetes Dokument betroffen.

Der Canvas zeichnet nur die Ankerzelle. Der Exporter geht über jede ursprüngliche Zelle und schreibt beide Texte und die innere Zellgrenze in die Grafik. Diese Einschränkung wurde bereits in #197 beschrieben.

**Korrektur.** Für die sichtbare Ausgabe dasselbe Layout der verbundenen Zellen wie auf dem Canvas verwenden. Bei deaktivierter Einbettung soll B1 in der Grafik unsichtbar bleiben.

Priorität hoch. [#287](https://github.com/J-ARTS/de.sketchdraw.io/issues/287) · [table-merge.ts L4](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/renderer/lib/table-merge.ts#L4) · [TableContent.vue L23](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/renderer/design-system/molecules/TableContent.vue#L23) · [export.ts L89](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/interop/export.ts#L89) · [export.ts L457](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/interop/export.ts#L457)

### Mermaid: Asynchroner Sequenzpfeil verhindert die Wiederherstellung des eingebetteten Dokuments

Ein Dokument mit zweiter Seite und einer Sequenz mit genau einer asynchronen Nachricht A-)B exportieren. Das vollständige Modell einbetten und den unveränderten Export wieder importieren.

Der Scanner zählt die schließende Klammer des Pfeils und erkennt die anschließende Modellzeile nur bei Klammerstand null. Der Sequenzimport baut ein neues einseitiges Dokument auf. Bei sonst gültigem Beispiel fehlt ein Hinweis auf die verlorene zweite Seite und die Dokumentaufgaben.

**Korrektur.** Die Metadaten einer Sequenz nach ihrer eigenen Syntax erkennen. Unveränderte eigene Exporte müssen Seiten, Aufgaben und Metadaten zurückliefern.

Priorität hoch. [#288](https://github.com/J-ARTS/de.sketchdraw.io/issues/288) · [sequence-code.ts L34](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/renderer/lib/sequence-code.ts#L34) · [mermaid-export.ts L111](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/renderer/lib/mermaid-export.ts#L111) · [mermaid.ts L467](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/interop/mermaid.ts#L467) · [mermaid.ts L483](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/interop/mermaid.ts#L483) · [mermaid-import.ts L78](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/renderer/lib/mermaid-import.ts#L78)

### Folien sortieren oder löschen setzt die gespeicherte Reihenfolge anderer Seiten zurück

Auf Seite A zwei Folien umsortieren. Auf einer zweiten Seite B ebenfalls die Reihenfolge ändern und anschließend wieder auf A präsentieren.

Ein dokumentweiter Schlüssel für die Reihenfolge wird durch die IDs der aktiven Seite ersetzt. A verliert die gesetzte Reihenfolge. Beim Lesen werden fehlende Folien in der ursprünglichen Elementreihenfolge angehängt.

**Korrektur.** Beim Sortieren und Löschen nur die Einträge der betroffenen Seite ändern. Die Präsentationsreihenfolge jeder anderen Seite muss erhalten bleiben.

Priorität mittel. [#289](https://github.com/J-ARTS/de.sketchdraw.io/issues/289) · [whiteboard.ts L456](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/renderer/state/whiteboard.ts#L456) · [whiteboard.ts L674](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/renderer/state/whiteboard.ts#L674) · [whiteboard.ts L2481](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/renderer/state/whiteboard.ts#L2481) · [frames.ts L23](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/domain/frames.ts#L23)

### SVG/draw.io: Bereits geschriebene Exportdarstellungen teilen eine Versionsnummer mit einer inkompatiblen Darstellung

In Build 41dc689 eine Haftnotiz und eine Dokumentaufgabe als draw.io mit eingebettetem Modell exportieren und die Datei auf 14001e6 importieren. Bei SVG betrifft das entsprechend geänderte generische Komponentensymbole.

41dc689 und 14001e6 verwenden draw.io-v3 bzw. SVG-v2. Die alte native Haftnotiz unterscheidet sich vom neuen Bild derselben Versionskennung. Der Importer stuft das unveränderte Modell als veraltet ein. Bei Übernahme der vereinfachten Fassung fehlt z. B. die Dokumentaufgabe. Die Quelldatei bleibt unberührt.

**Korrektur.** Die bereits erzeugten Darstellungen kompatibel erkennen und jede folgende Änderung der sichtbaren Darstellung versionieren. Extern bearbeitete Dateien müssen weiterhin erkannt werden.

Priorität hoch für betroffene zwischenstände. [#290](https://github.com/J-ARTS/de.sketchdraw.io/issues/290) · [common.ts L162](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/interop/common.ts#L162) · [drawio.ts L200](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/interop/drawio.ts#L200) · [export.ts L457](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/interop/export.ts#L457) · [svg.ts L34](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/interop/svg.ts#L34) · [export.ts L305](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/interop/export.ts#L305)

### Frei platzierter Kommentar auf Seite B blockiert den eingebetteten SVG-Export von Seite A

In einem zweiseitigen Dokument auf einer freien Stelle von Seite B kommentieren. Auf A den SVG-Export mit der voreingestellten Modelleinbettung vorbereiten.

Das Teilmodell enthält nur Seite A, übernimmt den freien Kommentar mit dem Ziel B jedoch unverändert. Beim Serialisieren für die Einbettung wird der ungültige Seitenverweis mit MISSING_PAGE_REFERENCE abgewiesen.

**Korrektur.** Beim Erzeugen des Teilmodells Kommentare und zugehörige Referenzen konsistent der exportierten Seite zuordnen. Ein freier Kommentar auf B darf den Export von A nicht verhindern.

Priorität mittel. [#291](https://github.com/J-ARTS/de.sketchdraw.io/issues/291) · [whiteboard.ts L2056](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/renderer/state/whiteboard.ts#L2056) · [pages.ts L24](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/domain/pages.ts#L24) · [pages.ts L32](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/domain/pages.ts#L32) · [export.ts L228](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/interop/export.ts#L228) · [validation.ts L2003](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/domain/validation.ts#L2003)

### Mermaid-Prozessexport verliert die zweite Pfeilspitze einer bidirektionalen Verbindung

Ein Mermaid-Flowchart mit genau zwei Rechtecken und A <--> B importieren und portabel wieder als Mermaid exportieren.

Der Import erkennt beide Pfeilenden. Beim erneuten Export wird dieses Diagramm als ein Prozess erkannt. Dessen Kantenmodell liest nur den Endmarker und schreibt A --> B. Damit ändert sich die fachliche Aussage im ausgegebenen Code.

**Korrektur.** Start- und Endmarker im Prozessmodell und bei der Ausgabe berücksichtigen. Die beidseitige Verbindung muss im portablen Mermaid-Code erhalten bleiben.

Priorität mittel. [#292](https://github.com/J-ARTS/de.sketchdraw.io/issues/292) · [mermaid.ts L439](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/interop/mermaid.ts#L439) · [mermaid-export.ts L66](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/renderer/lib/mermaid-export.ts#L66) · [flow-model.ts L63](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/renderer/lib/flow-model.ts#L63) · [flow-code.ts L67](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/renderer/lib/flow-code.ts#L67)

### Aufgabenformular kann während einer Jira-Anlage dieselbe Aufgabe ein zweites Mal anlegen

Eine neue Aufgabe bei aktiver Jira-Verknüpfung absenden. Erneut Speichern oder Enter betätigen, nachdem die lokale Karte angelegt wurde und während die erste Jira-Anfrage noch läuft.

Das Formular bleibt im Anlegemodus und sein Submit-Button aktiv. Die zweite Übermittlung erzeugt eine weitere Aufgaben-ID und einen weiteren Jira-Erstellauftrag. Bei Erfolg beider Aufträge entstehen zwei Karten und zwei Tickets.

**Korrektur.** Für eine laufende Übermittlung weitere Submit-Ereignisse ignorieren, den laufenden Vorgang anzeigen und nach einem Fehler eine eindeutige Wiederholung anbieten.

Priorität mittel. [#293](https://github.com/J-ARTS/de.sketchdraw.io/issues/293) · [TaskBoard.vue L46](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/renderer/design-system/organisms/TaskBoard.vue#L46) · [TaskBoard.vue L268](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/renderer/design-system/organisms/TaskBoard.vue#L268) · [whiteboard.ts L2151](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/renderer/state/whiteboard.ts#L2151) · [whiteboard.ts L2165](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/renderer/state/whiteboard.ts#L2165) · [plugin-service.ts L1651](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/electron/plugin-service.ts#L1651)

### Kopierte Ressourcenkarte verliert ihr gewähltes Bibliothekssymbol im Zieldokument

In einer Ressourcenkarte das nachgeladene Symbol Kubernetes → API Server wählen und die Karte oder ihre Seite in ein leeres anderes Dokument einfügen.

Beim Kopieren werden Karten- und Symboldefinition verpackt. Beim Einfügen werden Definitionen nur anhand des Kartentyps übernommen. Fehlt das gewählte Symbol im Zieldokument und im eingebauten Kurzkatalog, zeigt der Renderer das Standardsymbol der Karte.

**Korrektur.** Die Abhängigkeiten für Verpacken und Einfügen mit derselben Logik bestimmen. Kartentyp und separat gewähltes Symbol müssen im neuen Dokument verfügbar sein.

Priorität mittel. [#294](https://github.com/J-ARTS/de.sketchdraw.io/issues/294) · [element-clipboard.ts L105](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/renderer/state/element-clipboard.ts#L105) · [element-clipboard.ts L119](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/renderer/state/element-clipboard.ts#L119) · [whiteboard.ts L2642](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/renderer/state/whiteboard.ts#L2642) · [ElementView.vue L68](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/renderer/design-system/organisms/ElementView.vue#L68)

### Bildimport fügt das Bild nach einem Seitenwechsel auf der inzwischen aktiven Seite ein

In einem Dokument mit zwei vorhandenen Seiten ein Bild auf A einfügen und auf B wechseln, während das Bild noch gelesen oder dekodiert wird. Der Seitenwechsel allein ändert die Dokumentrevision nicht.

Der Import merkt sich Sitzung und Revision, aber keine Zielseite. Nach der Dekodierung schreibt der Dispatcher das Bild auf die dann aktive Seite B.

**Korrektur.** Zielseite und Einfügeposition beim Start festhalten. Beim Seitenwechsel gezielt abbrechen oder auf der ursprünglich gewählten Seite einfügen, ohne die neue Auswahl zu verändern.

Priorität mittel. [#295](https://github.com/J-ARTS/de.sketchdraw.io/issues/295) · [whiteboard.ts L2511](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/renderer/state/whiteboard.ts#L2511) · [whiteboard.ts L2515](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/renderer/state/whiteboard.ts#L2515) · [whiteboard.ts L653](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/renderer/state/whiteboard.ts#L653) · [whiteboard.ts L2574](https://github.com/J-ARTS/de.sketchdraw.io/blob/14001e675fa9c4122c0b3a9c969266a261399e45/src/renderer/state/whiteboard.ts#L2574)
