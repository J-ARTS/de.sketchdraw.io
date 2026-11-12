# ADR 0008 — Plugin-Konfiguration als Editor-Profile

Status: angenommen und umgesetzt ([#168](https://github.com/J-ARTS/de.sketchdraw.io/issues/168)). Nutzerentscheidung vom 12.11.2026. Löst den Vertrag „Konfiguration bleibt beim lokalen Dokumentordner“ aus #160 ab.

## Entscheidung

1. **Profile statt Ordnerdatei.** Die Konfiguration von Git und Jira (installiert, aktiv, Felder, verschlüsselte Tokens) gehört zu benannten Profilen des Editors. Sie liegt in `<userData>/plugins.json` (`version: 3`, `activeProfileId`, `profiles[]`) und nie im Diagramm oder dessen Ordner. Es gibt immer mindestens ein Profil („Standard“), höchstens zwölf; Namen sind eindeutig (ohne Beachtung der Groß-/Kleinschreibung) und höchstens 40 Zeichen lang.
2. **Aktives Profil gilt app-weit** und bleibt über Neustarts erhalten. Der Umschalter steht im Arbeitsbereich-Menü direkt über „Zusammenarbeiten“; im Plugin-Dialog lassen sich Profile wählen, anlegen, kopieren, umbenennen und löschen. Ein neues oder kopiertes Profil wird sofort aktiv. Eine Kopie übernimmt auch die verschlüsselt gespeicherten Tokens.
3. **Der Ordner bestimmt nur, wo Git arbeitet.** Ein Profilwechsel verändert kein Repository. Erst das ausdrückliche Speichern einer *aktivierten* Git-Konfiguration bei geöffnetem lokalem Diagramm richtet dessen Ordner ein (`git init`, Remote setzen). Der Git-Token bleibt an seine Remote-URL gebunden und wird nur an genau diese gesendet.
4. **Dokumentgebundene Aktionen brauchen ein lokales Diagramm.** Jira- und Confluence-Aufrufe sowie Git-Status/-Sync lehnt der Hauptprozess ohne Projektordner ab; ungespeicherte, importierte und Gast-Diagramme lösen keine Plugin-Aktion aus. Die Konfiguration selbst und der Verbindungstest sind ohne Diagramm möglich.
5. **Kontextwechsel.** Ordner- und Profilwechsel erhöhen dieselbe Generation im Dienst; laufende Arbeit des alten Kontexts wird verworfen. Eine Konfiguration wird immer in dem Profil gespeichert, das beim Start des Speicherns aktiv war. Schreibzugriffe auf die Profildatei laufen nacheinander und atomar (temporäre Datei, Modus 0600).
6. **Übernahme alter Ordnerdateien.** Eine vorhandene `.sketchdraw-plugins.json` wird beim Öffnen ihres Ordners einmalig in das aktive Profil übernommen, solange dieses noch unkonfiguriert ist. Die Datei bleibt unverändert liegen; ein bereits konfiguriertes Profil wird nie ersetzt.
7. **Unlesbare Profildatei.** Sie wird als `plugins.json.unreadable` daneben gesichert, bevor der Editor mit einem leeren Standardprofil weiterarbeitet.

## Folgen und Grenzen

- Ein aktives Profil mit eingeschaltetem Git gilt für jeden Ordner, den man öffnet. Ist der Ordner kein Repository, meldet das Plugin das, statt ihn ungefragt einzurichten.
- Alte Ordnerdateien werden nicht gelöscht und können Tokens (verschlüsselt) enthalten; Aufräumen bleibt dem Nutzer überlassen.
- Profile sind nicht pro Fenster oder Diagramm wählbar und werden nicht zwischen Geräten synchronisiert; Tokens sind an die sichere Ablage dieses Geräts gebunden.
- Die Oberfläche fragt vor dem Löschen eines Profils nach; ein Rückgängig gibt es nicht.
- Nicht geprüft: Verhalten mit realen Jira-/Git-Servern und die sichere Ablage auf Windows/Linux von Hand.
