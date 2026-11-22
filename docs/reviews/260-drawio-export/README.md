# Sichtprüfung des draw.io-Exports (#260)

22.11.2026, Stand `2a37bb0`. Geöffnet wurde `tests/fixtures/interop/drawio-export/cards-reference.drawio` im
draw.io-Webeditor (`app.diagrams.net`, Oberfläche „min“, Zoom 100 %) über die Rohdatei des Commits.

![Referenzexport in draw.io](cards-reference-in-drawio.jpg)

Befund:

- EC2-Karte, Kubernetes-Pod und Ressourcenkarte erscheinen als Karte mit Icon, Anbieter bzw. Beschreibung und
  Link-Leiste, so wie die Zeichenfläche sie zeigt. Der Name steht als Beschriftung von draw.io an der Stelle, an der
  die Zeichenfläche ihn zeigt, und ist dort bearbeitbar.
- Das isometrische Icon trägt seinen Text darunter, die generische Komponente hat ihr Symbol oben mittig und den Text
  in der unteren Hälfte.
- Die Haftnotiz ist das Bild ihres Papiers mit Autor; ihr Text ist eine bearbeitbare Beschriftung.
- Die Tabelle ist das Bild der Tabelle (nicht bearbeitbar; ihr Inhalt steht als verdeckter Wert in der Datei).
- Der Pfeil hängt an den Bildzellen und trägt seinen Text.

Verlauf: Beim ersten Öffnen (`41dc689`) stand der Text der generischen Komponente über ihrem Symbol (behoben mit
`1fd1e8d`); mit `2a37bb0` kamen die bearbeitbaren Beschriftungen, Haftnotiz und Tabelle dazu.

Grenzen dieser Prüfung: Webeditor statt der installierten draw.io-App; Schrift ist die Ersatzschrift des Browsers
(Inter ist in draw.io nicht geladen).
