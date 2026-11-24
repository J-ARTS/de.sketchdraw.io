# Lizenzierung von Sketchdraw

Sketchdraw steht, soweit einzelne Bestandteile nicht anders gekennzeichnet sind, unter der **Functional Source License, Version 1.1, ALv2 Future License** (SPDX-Kennung `FSL-1.1-ALv2`). Maßgeblich ist der englische Text in [LICENSE](../../LICENSE); diese Seite fasst ihn nur zusammen. Hinter dem Lizenztext steht dort, durch eine Linie getrennt, ein Abschnitt mit Hinweisen zu früheren Versionen und ein Abschnitt „Third-Party Notices" mit den Hinweisen zu mitgelieferten Werken Dritter. Der Lizenztext der FSL ist unverändert bis auf die Zeile mit dem Urheberhinweis; die Lizenz ist unter <https://fsl.software> veröffentlicht.

Der Quellcode ist einsehbar. Sketchdraw ist damit „source-available", aber **nicht Open Source im Sinne der Open Source Definition**: Die Lizenz verbietet konkurrierende kommerzielle Nutzung. Jede Version wird **zwei Jahre nach ihrer Veröffentlichung** zusätzlich unter der **Apache License 2.0** nutzbar und ist ab dann Open Source. In `package.json` steht deshalb `FSL-1.1-ALv2`.

Rechteinhaber und Lizenzgeber ist Jeremy Teichmann (J-ARTS).

## Was erlaubt ist

Erlaubt ist jeder Zweck außer einer konkurrierenden Nutzung („Competing Use"). Ausdrücklich genannt sind:

- **Nutzen:** Sketchdraw kostenlos benutzen – privat und für die interne Nutzung der eigenen Organisation, auch im Rahmen bezahlter Arbeit.
- **Lesen, ändern, ableiten:** Den Quellcode lesen, daraus bauen, ändern und abgeleitete Werke erstellen.
- **Weitergeben:** Kopien, Änderungen und abgeleitete Werke weitergeben, etwa als Fork. Dabei müssen die Lizenzbedingungen (oder ein Link darauf) und alle Urheberhinweise erhalten bleiben; die Bedingungen gelten für alles Weitergegebene.
- **Bildung und Forschung:** Nichtkommerzielle Lehre und nichtkommerzielle Forschung.
- **Dienstleistungen:** Professionelle Dienstleistungen für Kunden, die Sketchdraw im Rahmen der Lizenz nutzen (Beratung, Einrichtung, Schulung).
- **Eigene Inhalte:** Diagramme, Dokumente und Exporte gehören denen, die sie erstellen, und dürfen beliebig, auch kommerziell, verwendet werden.
- **Patente:** Soweit die erlaubte Nutzung zwingend Patente des Rechteinhabers verletzen würde, schließt die Lizenz eine Patentlizenz ein. Sie endet, wenn man selbst wegen Sketchdraw eine Patentklage erhebt.

## Was nicht erlaubt ist

**Konkurrierende Nutzung:** Sketchdraw darf nicht anderen in einem kommerziellen Produkt oder Dienst zur Verfügung gestellt werden, das

1. Sketchdraw ersetzt,
2. ein anderes Produkt oder einen anderen Dienst des Rechteinhabers ersetzt, der Sketchdraw nutzt und zum Zeitpunkt der Veröffentlichung besteht, oder
3. dieselbe oder im Wesentlichen ähnliche Funktionalität wie Sketchdraw bietet.

Beispiele: ein bezahltes oder werbefinanziertes Whiteboard-Produkt auf Basis des Sketchdraw-Codes, ein gehosteter Dienst „Sketchdraw as a Service" oder ein verkauftes, unter anderem Namen vertriebenes Sketchdraw. Nicht darunter fällt, was Sketchdraw nicht ersetzt, etwa ein eigenes Produkt, das Sketchdraw-Dateien über dokumentierte Schnittstellen liest oder schreibt.

**Marken:** Name, Produktname und Logo „Sketchdraw" dürfen nur genutzt werden, um die Lizenzangaben anzuzeigen und den Rechteinhaber als Ursprung zu nennen. Für eigene Angebote gilt kein Recht an der Marke.

Die Grenzen der „Competing Use" im Einzelfall legt der Lizenztext fest; im Zweifel den Rechteinhaber fragen.

## Zustimmung einholen

Wer mehr braucht, als die Lizenz erlaubt, kann den Rechteinhaber um eine gesonderte Erlaubnis bitten. Anfragen laufen über die [Issues des Repositorys](https://github.com/J-ARTS/de.sketchdraw.io/issues) oder das Profil [J-ARTS](https://github.com/J-ARTS).

## Zukünftige Lizenz (Apache-2.0)

Mit dem Abschnitt „Grant of Future License" gewährt der Rechteinhaber unwiderruflich eine zusätzliche Lizenz: Am zweiten Jahrestag des Tages, an dem eine Version veröffentlicht wurde, darf diese Version auch unter der Apache License 2.0 genutzt werden. Die Frist läuft für jede Version einzeln. Beispiel: Eine Version, die am 1. Dezember 2026 veröffentlicht wird, ist ab dem 1. Dezember 2028 zusätzlich unter Apache-2.0 nutzbar.

## Grenzen, die man kennen sollte

- **Frühere Versionen:**
  - Alle bis einschließlich v0.1.6 veröffentlichten Versionen standen unter der **PolyForm Noncommercial License 1.0.0**.
  - Die Versionen **0.1.7 bis 0.1.10** standen unter dem **Sketchdraw End User License Agreement, Version 1.0** (20. November 2026).
  - Für Kopien dieser Versionen gelten die Bedingungen, unter denen sie veröffentlicht wurden, weiter; sie lassen sich nicht nachträglich zurücknehmen.
  - Die FSL gilt ab **v0.1.11** und für jeden Stand des Repositorys, der sie enthält.
- **Hosting-Plattform:** Die Nutzungsbedingungen von GitHub geben jedem Nutzer das Recht, ein öffentliches Repository dort anzusehen und zu forken. Die FSL schränkt das nicht ein; ein Fork darf aber nicht für eine konkurrierende Nutzung verwendet werden.
- **Haftung:** Die Software wird ohne Gewährleistung überlassen, die Haftung ist im Lizenztext ausgeschlossen. Ob und wie weit dieser Ausschluss nach deutschem Recht wirksam ist, ist nicht geprüft.
- **Keine Rechtsberatung:** Diese Zusammenfassung ersetzt keine anwaltliche Prüfung. Bei geschäftlicher Bedeutung oder vor einer Durchsetzung sollte eine Anwältin oder ein Anwalt den Lizenztext und seine Wirkung nach deutschem Recht prüfen. Die FSL ist nicht von der Open Source Initiative geprüft oder anerkannt.

## Drittanbieter und Schriften

Drittanbieterkomponenten behalten ihre jeweiligen Lizenzen; die Sketchdraw-Lizenz ersetzt diese nicht und schränkt die Rechte daraus nicht ein. Die direkt verwendeten Kollaborationspakete und ihre festgeschriebenen Versionen stehen in den [Third-party software notices](../../THIRD_PARTY_NOTICES.md). Insbesondere werden **Inter** und **JetBrains Mono** unter der **SIL Open Font License 1.1 (OFL-1.1)** bereitgestellt. Beide vollständigen Schriftlizenzen samt Urheberhinweisen stehen in [public/FONT_LICENSES.txt](../../public/FONT_LICENSES.txt).

Die Schriften bleiben unter der OFL. Bei ihrer Weitergabe müssen die jeweiligen Urheberhinweise und Lizenzbedingungen erhalten bleiben. Die OFL erlaubt die Bündelung mit Software unter ihren Bedingungen; sie gilt nicht automatisch für Dokumente, die mit den Schriften erstellt werden. Siehe den [offiziellen OFL-Text](https://openfontlicense.org/open-font-license-official-text/).

## Bereits gebaute Installer und künftige Pakete

Die Installer für **v0.1.1** wurden aus Revision `c4bdfd6e38ac4f6db470ff7f8bf3f3788e78e1ee` gebaut und bleiben unverändert. Die nachträgliche Aufnahme einer Lizenzdatei in das Repository bedeutet nicht, dass die neue Datei `LICENSE` in bereits gebauten Installern enthalten ist. Versionsbezogene Lizenzhinweise werden gesondert in den Release Notes geführt.

Die [Paketkonfiguration](../../electron-builder.json) nimmt `LICENSE` für künftige Pakete ausdrücklich auf. Diese Konfigurationsänderung ist kein Nachweis eines neu gebauten Installers.

## Herkunft des Lizenztexts

- Die FSL-1.1-ALv2 ist der offizielle Standardtext von <https://fsl.software> (Vorlage `FSL-1.1-ALv2.template.md` im Repository `getsentry/fsl.software`). Ersetzt wurden nur Jahr (2026) und Lizenzgeber (Jeremy Teichmann (J-ARTS)).
- Bis zum 20. November 2026 enthielt `LICENSE` den unveränderten Text der [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0); danach bis einschließlich v0.1.10 das Sketchdraw End User License Agreement 1.0. Beide stehen in der Git-Historie.
