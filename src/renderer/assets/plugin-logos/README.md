# Plugin-Logos

Die Plugin-Einstellungen zeigen für jedes Plugin eine weiße Kachel. Liegt hier eine Datei mit der Plugin-ID als Namen, erscheint sie in der Kachel; sonst zeigt die Kachel den Anfangsbuchstaben. Aktuell liegen `git.svg` und `jira.svg` hier; Herkunft und Bedingungen stehen in `THIRD_PARTY_ICONS.md`.

| Plugin | Dateiname |
| --- | --- |
| Git | `git.svg` oder `git.png` |
| Jira | `jira.svg` oder `jira.png` |

- SVG wird bevorzugt, wenn beide Formate vorhanden sind. Quadratische Dateien mit transparentem Hintergrund passen am besten; die Datei wird unverändert und unverzerrt eingepasst.
- Hierher gehören nur die **offiziellen, unveränderten** Dateien der Hersteller. Es sind Marken Dritter: Vor dem Ablegen die jeweiligen Nutzungsbedingungen prüfen und Quelle, Lizenz bzw. Markenrichtlinie und Abrufdatum in `THIRD_PARTY_ICONS.md` eintragen.
- Die Dateien werden beim Build eingebunden; ein Neustart von `npm run dev:electron` bzw. ein neuer Build zeigt sie an (#165).
