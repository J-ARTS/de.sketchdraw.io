# Lizenzierung von Sketchdraw

Sketchdraw steht, soweit einzelne Bestandteile nicht anders gekennzeichnet sind, unter dem **Sketchdraw End User License Agreement, Version 1.0** vom 20. November 2026. Maßgeblich ist der englische Text in [LICENSE](../../LICENSE); diese Seite fasst ihn nur zusammen. Hinter der Vereinbarung steht dort, durch eine Linie getrennt, der Abschnitt „Third-Party Notices" mit den Hinweisen zu mitgelieferten Werken Dritter.

Der Quellcode ist einsehbar. Sketchdraw ist damit „source-available", aber **keine Open-Source-Software**: Die Vereinbarung erlaubt weder Verkauf noch freie Weitergabe. In `package.json` steht deshalb `SEE LICENSE IN LICENSE` statt einer SPDX-Kennung.

Rechteinhaber und Lizenzgeber ist Jeremy Teichmann (J-ARTS).

## Was erlaubt ist

- **Nutzen:** Sketchdraw aus den offiziellen Quellen (dieses Repository und seine Releases) laden, auf beliebig vielen Geräten installieren und kostenlos benutzen – privat und für die internen Zwecke der eigenen Organisation, auch im Rahmen bezahlter Arbeit.
- **Eigene Inhalte:** Diagramme, Dokumente und Exporte gehören denen, die sie erstellen, und dürfen beliebig, auch kommerziell, verwendet werden.
- **Lesen und für sich anpassen:** Den Quellcode lesen, daraus bauen und für die eigene Nutzung ändern. Geänderte Fassungen dürfen nicht weitergegeben werden.
- **Agent-Skills:** Die mitgelieferten Skills in den eigenen Agentenwerkzeugen installieren und in nicht öffentlichen Repositories der eigenen Organisation ablegen.
- **Beitragen:** Das Repository auf der Hosting-Plattform kopieren, um dem Rechteinhaber Änderungen vorzuschlagen.

## Was ohne Zustimmung nicht erlaubt ist

1. **Kein Verkauf (4.1):** Sketchdraw darf nicht verkauft, vermietet, gegen Entgelt lizenziert oder als bezahlter Dienst angeboten werden – weder allein noch im Paket, vorinstalliert oder gehostet.
2. **Kein Code in kommerziellen Produkten (4.2):** Quellcode, Oberfläche, Design System, Grafiken und Dokumentation dürfen nicht – auch nicht verändert oder in eine andere Sprache übertragen – in Software oder Dienste einfließen, die verkauft, gegen Entgelt angeboten, über Werbung, Abos oder Bezahlfunktionen finanziert oder sonst mit Gewinnabsicht angeboten werden. Das Lesen und Schreiben der Sketchdraw-Dateiformate und die Anbindung über dokumentierte Schnittstellen (z. B. MCP) fallen nicht darunter.
3. **Keine Weiterveröffentlichung (4.3):** Sketchdraw darf weder unverändert noch verändert veröffentlicht, verteilt oder gespiegelt werden – etwa in anderen Repositories, Paket-Registries, App-Stores oder Download-Portalen, auch nicht unter anderem Namen. Der Verweis auf die offiziellen Quellen ist immer erlaubt.
4. **Weiteres (4.4):** Urheber- und Lizenzhinweise bleiben erhalten; Name und Logo „Sketchdraw" dürfen nicht für eigene Angebote verwendet werden; Rechte sind nicht übertragbar oder unterlizenzierbar.

Bei einem Verstoß gegen diese Verbote enden die Nutzungsrechte automatisch (Abschnitt 12).

## Zustimmung einholen

Der Rechteinhaber kann Ausnahmen erlauben. Anfragen laufen über die [Issues des Repositorys](https://github.com/J-ARTS/de.sketchdraw.io/issues) oder das Profil [J-ARTS](https://github.com/J-ARTS). Eine Zustimmung gilt nur in Textform, für die darin genannte Nutzung; Schweigen ist keine Zustimmung (Abschnitt 6).

## Grenzen, die man kennen sollte

- **Frühere Versionen:** Alle bis einschließlich v0.1.6 veröffentlichten Versionen standen unter der PolyForm Noncommercial License 1.0.0. Diese Lizenz gilt für Kopien jener Versionen weiter und lässt sich nicht nachträglich zurücknehmen; sie erlaubt die nichtkommerzielle Weitergabe. Die neue Vereinbarung gilt ab v0.1.7 und für jeden Stand des Repositorys, der sie enthält.
- **Hosting-Plattform:** Die Nutzungsbedingungen von GitHub geben jedem Nutzer das Recht, ein öffentliches Repository dort anzusehen und zu forken. Die Vereinbarung schränkt das nicht ein (Abschnitt 5); ein Fork darf aber nicht für Verbotenes genutzt werden.
- **Haftung und Recht:** Die Software wird unentgeltlich überlassen. Gewährleistung und Haftung sind so weit beschränkt, wie es das Gesetz zulässt; für Vorsatz, grobe Fahrlässigkeit und Personenschäden wird unbeschränkt gehaftet (Abschnitte 13 und 14). Es gilt deutsches Recht; zwingender Verbraucherschutz des Wohnsitzlandes bleibt bestehen (Abschnitt 15).
- **Keine Rechtsberatung:** Der Text wurde ohne anwaltliche Prüfung erstellt. Vor einer Durchsetzung oder bei geschäftlicher Bedeutung sollte ihn eine Anwältin oder ein Anwalt prüfen, insbesondere die Abschnitte 13 bis 15.

## Drittanbieter und Schriften

Drittanbieterkomponenten behalten ihre jeweiligen Lizenzen; die Sketchdraw-Lizenz ersetzt diese nicht und schränkt die Rechte daraus nicht ein (Abschnitt 8 der Vereinbarung). Die direkt verwendeten Kollaborationspakete und ihre festgeschriebenen Versionen stehen in den [Third-party software notices](../../THIRD_PARTY_NOTICES.md). Insbesondere werden **Inter** und **JetBrains Mono** unter der **SIL Open Font License 1.1 (OFL-1.1)** bereitgestellt. Beide vollständigen Schriftlizenzen samt Urheberhinweisen stehen in [public/FONT_LICENSES.txt](../../public/FONT_LICENSES.txt).

Die Schriften bleiben unter der OFL. Bei ihrer Weitergabe müssen die jeweiligen Urheberhinweise und Lizenzbedingungen erhalten bleiben. Die OFL erlaubt die Bündelung mit Software unter ihren Bedingungen; sie gilt nicht automatisch für Dokumente, die mit den Schriften erstellt werden. Siehe den [offiziellen OFL-Text](https://openfontlicense.org/open-font-license-official-text/).

## Bereits gebaute Installer und künftige Pakete

Die Installer für **v0.1.1** wurden aus Revision `c4bdfd6e38ac4f6db470ff7f8bf3f3788e78e1ee` gebaut und bleiben unverändert. Die nachträgliche Aufnahme einer Lizenzdatei in das Repository bedeutet nicht, dass die neue Datei `LICENSE` in diesen bereits gebauten Installern enthalten ist. Versionsbezogene Lizenzhinweise werden gesondert in den Release Notes geführt.

Die [Paketkonfiguration](../../electron-builder.json) nimmt `LICENSE` für künftige Pakete ausdrücklich auf. Diese Konfigurationsänderung ist kein Nachweis eines neu gebauten Installers.

## Herkunft des Lizenztexts

- Die Vereinbarung ist ein eigener Text für Sketchdraw (Version 1.0, 20. November 2026), keine übernommene Standardlizenz.
- Bis zum 20. November 2026 enthielt `LICENSE` den unveränderten Text der [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0); er steht in der Git-Historie.
