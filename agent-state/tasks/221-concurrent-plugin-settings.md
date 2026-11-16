# Gleichzeitige Plugin-Einstellungsänderungen können unabhängige Werte überschreiben

Issue: https://github.com/J-ARTS/de.sketchdraw.io/issues/221

Status: geplant, offen. Von Root nach Duplikatsuche als vorbestehender Befund erfasst. Quelle: tatsächlicher Fable-Bericht `docs/reviews/210-confluence-auto-sync/full-fable-review/fable-correction.md`, Abschnitt verbleibende Lücken.

Zwei unabhängige Einstellungsoperationen können aus demselben alten Konfigurationsschnappschuss schreiben und Werte der anderen Operation überschreiben. Bisher statische Beobachtung, keine eigenständige Reproduktion oder erfolgreiche Behebung. B1 schützt inzwischen den Live-Link-Fortschritt, ersetzt aber keinen vollständigen atomaren Vertrag für sämtliche Einstellungswerte.

Nächster Schritt: isolierte Konkurrenzreproduktion; danach atomare Teiländerungen bzw. den serialisierten Vertrag gemeinsam festlegen und passende Regression ausführen. Nicht Teil der sechs abgeschlossenen Korrekturen; keine Produktänderung, Veröffentlichung oder Schließung durch diese Nachweisverwaltung.
