# Session-Symbol in der Leiste: Personen folgen und Session beenden

Issue #223, Claude Code (Fable 5.2), 17.11.2026. Auftrag: In der Leiste ein Symbol anzeigen, solange eine Session läuft; darüber Personen auswählen, um ihnen zu folgen, und die Session beenden.

## Entscheidungen

| Frage | Entscheidung | Grund |
| --- | --- | --- |
| Was wird geteilt? | Der sichtbare Ausschnitt als Rechteck in Dokumentkoordinaten samt Seite. | Verschiebung und Zoomstufe passen nur bei gleicher Fenstergröße. Das Rechteck lässt sich in jedes Fenster einpassen; wer folgt, sieht mindestens alles, was die Person sieht. |
| Auf welchem Weg? | Wie die Mauszeiger (#222): Gast → Gastgeber → alle, auf dem Kanal `awareness`. | Gäste erreichen nur den Gastgeber; kein zusätzlicher Server, keine neue Verbindung. |
| Was passiert, wenn zwei einander folgen? | Wer folgt, meldet keinen eigenen Ausschnitt. | Jeder passt das Rechteck des anderen ein und zeigt dadurch etwas mehr; gegenseitig würde das bis zur kleinsten Zoomstufe herauszoomen. |
| Wann endet das Folgen? | Bei eigener Navigation (Verschieben, Zoomen, Seitenwechsel, Einpassen), mit Esc, über „Nicht mehr folgen", durch erneutes Wählen der Person oder wenn sie nicht mehr verbunden ist (mit Meldung). | Folgen darf nie festhalten; die erste eigene Bewegung ist die deutlichste Absicht. |
| Wo liegt die Steuerung? | Der Store kennt die laufende Session (`session`, `endSession`) und wem gefolgt wird (`following`, `followParticipant`). | Leiste und Zeichenfläche brauchen beides; der Bereich „Zusammenarbeiten" besitzt weiterhin den Lebenszyklus und meldet ihn nur an. |
| Rückfrage beim Beenden? | Nur für den Gastgeber und nur, wenn andere verbunden sind; im Menü, ohne Dialog. | Ein Klick in einem kleinen Menü beendete sonst die Session für alle. |

## Gestaltung

- Das Symbol steht neben Hilfe und Git, hat deren Größe (`--chrome-control`) und zeigt die Zahl der verbundenen Personen. Es bleibt auch in schmalen Fenstern in der Leiste, weil es die einzige Anzeige der laufenden Session ist, wenn der Bereich geschlossen ist.
- Das Menü hängt am rechten Ende der Leiste statt am Symbol, damit es ein schmales Fenster nicht verlässt.
- Beim Folgen: Rahmen um den Arbeitsbereich in der Farbe der Person und unten eine Leiste mit Abzeichen, Name und „Nicht mehr folgen" (Höhe `--chrome-height`). Dieselbe Farbe wie in Liste und Mauszeiger.
- Die Bewegung der Ansicht wird über wenige Bilder geglättet (Ausschnitte kommen zehnmal je Sekunde); bei reduzierter Bewegung springt sie.

## Bedenken und Grenzen

| Nr. | Fehlerfall | Auswirkung | Umgang |
| --- | --- | --- | --- |
| 1 | A folgt B, C folgt A. | C sieht den letzten eigenen Ausschnitt von A, nicht den von B. | Folge der Regel gegen gegenseitiges Herauszoomen. Offen; lösbar, indem ein Folgender den Ausschnitt der gefolgten Person weiterreicht. |
| 2 | Die gefolgte Person ist auf einer Seite, die beim Folgenden noch nicht angekommen ist. | Die Ansicht bleibt stehen, bis die Seite da ist. | Der nächste gemeldete Ausschnitt versucht es erneut. |
| 3 | Ein Gast, dessen Session vom Gastgeber beendet wurde, sieht das Symbol weiter. | Er muss die Session noch verlassen, um seine Kopie zu behalten. | Gewollt: Das Menü bietet dann „Session verlassen". |
| 4 | Offene Seitenbereiche verdecken einen Teil der Zeichenfläche. | Der eingepasste Ausschnitt liegt teilweise unter dem Bereich. | Nicht berücksichtigt; der gemeldete Ausschnitt ist die ganze Zeichenfläche. |
| 5 | Wer folgt, sieht nicht, wer ihm folgt. | Keine Anzeige „… folgt dir". | Nicht Teil des Auftrags. |

## Prüfung

Siehe Issue #223. Nicht geprüft: die gebaute Electron-App auf einem echten Gerät und Verbindungen über echte Relay-Helfer.
