# Confluence-Zielseite je Diagrammseite (#240): Prüfung und Entscheidungen

Ticket: #240, aufbauend auf #210. Werkzeug: Claude Code (Cloud-Sitzung), Modell Claude Fable 5.2. Messwerte für Zeit, Tokens und Kosten liegen nicht vor.

## Entscheidungen

| Frage | Entscheidung | Grund |
| --- | --- | --- |
| Wo liegt die Verknüpfung? | Weiter im Profil, in einem neuen Feld `confluencePageLinks` (Schlüssel: Datei + Diagrammseite). | Diagramme tragen nie eine Verknüpfung (#210). Ein eigenes Feld hält die Profildatei für v0.1.6 lesbar; dort gilt je Datei genau ein Eintrag in `confluenceLinks`. |
| Was gehört einer Seiten-Verknüpfung auf der Confluence-Seite? | Genau der Anhang dieser Diagrammseite (`sketchdraw-<Diagramm>-<Seite>.png`). | Mit dem Diagramm-Präfix würde die Veröffentlichung einer Seite die Bilder anderer Seiten desselben Diagramms als „überzählig“ entfernen, sobald zwei Seiten dieselbe Confluence-Seite nutzen. |
| Eine Übertragung für alle Seiten oder eine je Seite? | Eine je verknüpfter Seite, mit genau einem Bild. | Jede Seite hat ihr eigenes Ziel, ihren eigenen Stand (`published`, `pending`) und ihren eigenen Status. Die bestehende Zustandsmaschine wird je Seite einmal instanziiert statt erweitert. |
| Bestehende Diagramm-Verknüpfung | Wird beim Öffnen automatisch in je eine Verknüpfung pro Seite auf dieselbe Confluence-Seite umgestellt; der bekannte Stand jedes Anhangs wandert mit. | Verhalten bleibt gleich, es wird nichts erneut hochgeladen und die Confluence-Seite nicht geändert. Zwei Modelle nebeneinander hätten sich auf derselben Confluence-Seite gegenseitig Bilder entfernt. |
| Oberfläche | Eintrag im Seitenmenü, eigener Dialog; die Plugin-Einstellungen zeigen nur noch die Übersicht. | Vorgabe des Eigentümers: festlegen je Seite, nicht global in den Plugin-Einstellungen. |

## Bedenken

1. **Jede Änderung einer Verknüpfung bricht alle laufenden Übertragungen ab.** `revokeAuthority()` gilt weiter für das ganze Profil. Fehlerfall: Seite 1 überträgt gerade, der Nutzer verknüpft Seite 2. Auswirkung: Die Übertragung von Seite 1 endet mit „abgebrochen“ und wird vom Store nach wenigen Sekunden wiederholt; es geht nichts verloren, aber es gibt einen zusätzlichen Lesezugriff. Alternative: Autorität je Verknüpfung – größerer Eingriff in das Sicherheitsmodell aus #210, hier bewusst nicht angefasst.
2. **Gelöste Verknüpfungen und gelöschte Seiten räumen Confluence nicht auf.** Das Bild bleibt auf der Confluence-Seite stehen und veraltet. Früher entfernte die Diagramm-Verknüpfung Bilder gelöschter Seiten automatisch. Alternative: beim Lösen anbieten, das Bild zu entfernen; für gelöschte Seiten wegen „Rückgängig“ heikel. Offen.
3. **Neue Seiten sind nicht verknüpft.** Vorher erschien jede neue Seite automatisch auf der Confluence-Seite; jetzt ist das eine Entscheidung je Seite. Gewollt, aber eine Verhaltensänderung für umgestellte Diagramme.
4. **Die Überschrift im Bild hängt von der Seitenzahl ab.** Kommt zu einem einseitigen Diagramm eine zweite Seite hinzu, ändert sich das Bild der ersten (Titel · Seitenname) und wird neu übertragen. Kein Fehler, aber eine Übertragung ohne Änderung an der Seite selbst.
5. **Rückwärtskompatibilität hat eine Lücke.** v0.1.6 liest die Datei und lässt das neue Feld bei den meisten Schreibvorgängen stehen; „Jira speichern“ baut den Atlassian-Abschnitt dort jedoch neu auf und verliert die Seiten-Verknüpfungen.
6. **Geteilter Vertrag.** `PluginBridge.setConfluenceLiveLink` nimmt zusätzliche Felder, `convertConfluenceLiveLink` und `PluginSettingsSnapshot.confluencePageLinks` sind neu; `publishConfluenceLive` kennt `diagramPageId`. Alles additiv. #209 und #217 laufen parallel im selben Dienst – beim Zusammenführen auf `updateLiveLinks` und `assertLiveJob` achten.
7. **Electron-Test nur im CI.** `tests/electron/confluence-live.spec.ts` läuft in der Cloud-Umgebung nicht (Chromium-Sandbox als root); er ist auf zwei Seiten-Verknüpfungen umgeschrieben und wird erst im CI ausgeführt.
