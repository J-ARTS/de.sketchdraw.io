# Referenzexport für draw.io

`cards-reference.drawio` ist der draw.io-Export (ohne eingebettetes Dokument) einer Seite mit einer EC2-Karte, einer
Ressourcenkarte mit zwei Links, einem Kubernetes-Pod, einem isometrischen Icon, einer generischen Komponente und einem
Pfeil zwischen zwei Karten. `tests/unit/interop/drawio-components.spec.ts` prüft, dass der Exporter genau diese Datei
schreibt.

Die Datei ist die Vorlage für den Vergleich im draw.io-Editor (#260): Komponenten stehen dort als Bild ihrer Karte, so
wie die Zeichenfläche sie zeigt. Nach einer bewussten Änderung des Exports mit
`UPDATE_FIXTURES=1 npx vitest run --config vitest.config.ts tests/unit/interop/drawio-components.spec.ts` neu schreiben
und erneut in draw.io öffnen, z. B. über
`https://app.diagrams.net/?splash=0#U<URL der Rohdatei>`.
