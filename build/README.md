# App-Icon

- `icon-source.png` – Vorlage des Icons, wie geliefert (Icon-Körper auf dunklem Hintergrund). Nur diese Datei wird von Hand ersetzt.
- `icon.icns` (macOS), `icon.ico` (Windows), `icons/<n>x<n>.png` (Linux) – daraus erzeugte Installer-Icons; `electron-builder.json` verweist darauf.
- `../public/app-icon.png` – Fenster-Icon unter Windows/Linux und Icon im Browser-Tab.

Neu erzeugen nach einem Tausch der Vorlage (benötigt Python 3 mit Pillow):

```bash
python3 tools/build-app-icons.py
node --test tests/unit/app-icon.test.mjs
```

Das Skript stellt den Icon-Körper frei (transparenter Rand), setzt ihn für macOS auf das übliche Raster (824 von 1024 px mit weichem Schatten) und füllt für Windows und Linux die Fläche bis auf einen schmalen Rand. Die erzeugten Dateien werden eingecheckt; die Release-Pipeline erzeugt sie nicht selbst.
