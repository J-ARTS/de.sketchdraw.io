# Electron-Backend: bestätigter Laufzeitnachweis

Issues: [#8](https://github.com/J-ARTS/de.sketchdraw.io/issues/8), [#15](https://github.com/J-ARTS/de.sketchdraw.io/issues/15). Stand: 17.10.2026. Ausführung: interner Codex-Subagent `dependency_review`, kein Claude-Code-/Antigravity-Beitrag.

## Ergebnis und geprüfter Stand

Der abschließende Lauf von `tests/electron/backend-shell.spec.ts` bestand mit **3 bestandenen Tests in 7,7 Sekunden**, Exit-Code 0:

```text
npx playwright test --project=electron tests/electron/backend-shell.spec.ts
```

Umgebung: macOS (`darwin`), ARM64, Host-Node.js 22.16.0, Electron 44.9.0, Playwright 1.64.1. Die Node-Version bezeichnet den aufrufenden Testprozess, nicht eine separat ermittelte Node-Version innerhalb Electron. Die Electron-Bundles waren zuvor durch Root gebaut worden; der Subagent führte keinen weiteren Produktbuild aus.

| Geprüftes Artefakt | SHA256 |
| --- | --- |
| `tests/electron/backend-shell.spec.ts` | `867f36d56e246d898869d6f05dea4736f42d4aed846de94d8d3951fa6de549bf` |
| `dist-electron/main.cjs` | `48cdde8a86727f831ea79d1ca008cca5b67b3db94572f3c5c9fd30af2823568f` |
| `dist-electron/preload.cjs` | `6e968c20920b30d63909e0451619f3369b3e619c9c1b05af879948259700b3e6` |

Diese Ergebnisse beziehen sich auf die genannten lokalen Artefakte. Sie bestätigen weder eine Integration in den Zielbranch noch den Abschluss der gesamten Issues.

## Aufbau des Nachweises

Jeder Test startet einen eigenen echten Electron-Prozess mit einem privaten temporären App-Verzeichnis. Ein kurzer Fixture-Main setzt ausschließlich private User-/Session-Datenpfade und lädt das echte gebaute Main-Bundle. Weil dessen Rendererpfad relativ zu `__dirname` aufgelöst wird, werden Main und Preload unverändert in `temp/dist-electron/` kopiert. Der Test vergleicht beide Kopien byteweise mit den ursprünglichen Build-Artefakten.

`temp/dist/index.html` und `fixture.js` bilden ausdrücklich eine minimale Testseite. Sie registriert Listener für Menü- und Close-Ereignisse, enthält aber keine Produktoberfläche oder Whiteboard-Implementierung. Protokollhandler, Bridge, IPC-Validierung, Persistenzhandler, Navigationsschutz und Close-Koordinator stammen aus dem echten Produktbuild. `app.getAppPath()` zeigt nachweislich auf die Fixture.

Es wurden keine Sandbox-/Web-Sicherheitsflags abgeschaltet. Störende Node-/Electron-Startvariablen werden für den Kindprozess bereinigt. Cleanup betrifft nur die gestartete Test-App und deren temporäres Verzeichnis; Prozessbeendigung und Dateientfernung sind begrenzt. Nach dem abschließenden Lauf waren **0 Fixture-Verzeichnisse** übrig.

## Die drei bestandenen Fälle

1. **App-Protokoll, Isolation und Bridge:** Start über `app://sketchdraw/index.html`; Fixture- und private Datenpfade stimmen. Electron meldet für den Renderer auf macOS eine aktive OS-Sandbox. Eine Main-World-Markierung ist im isolierten Preload-Kontext nicht sichtbar. Die eingefrorene DesktopBridge ist vorhanden; `require`, `process`, `Buffer` und rohes `ipcRenderer` sind im Seitenkontext nicht verfügbar. Der reale App-Protokollabruf liefert HTTP-Status 200 und die erwarteten CSP-Regeln. Ein gültig geformtes unbekanntes Handle erreicht Main und wird mit `UNKNOWN_HANDLE` zurückgewiesen; ein roher Dateipfad wird mit `INVALID_HANDLE` abgewiesen. Ungültiges URL-Schema und externer Link ohne aktive Nutzeraktion werden abgewiesen.
2. **Navigation, Popup und fremder Sender:** `window.open` erzeugt kein Fenster. Eine tatsächlich ausgelöste externe Navigation wird durch den Produktlistener verhindert. Ein zweites echtes, ebenfalls sandboxiertes BrowserWindow mit demselben `app://`-Ursprung und demselben Preload-Build erhält beim Speicherversuch `UNAUTHORIZED_SENDER`.
3. **Menü und Close-Handshake:** Der echte Menüeintrag sendet `save` durch die Bridge. Ein unbeantworteter Close lässt das Fenster offen. Ein erneuter Close erzeugt eine neue Request-ID; die vorherige ID wird abgewiesen. Cancel hält das Fenster offen. Eine neue, gültige Bestätigung schließt das Fenster tatsächlich.

## Testharness-Korrekturen und weitere Prüfungen

Vorläufe scheiterten an korrigierten Testannahmen: macOS normalisiert temporäre Pfade; `getLastWebPreferences` ist keine geeignete öffentliche Diagnoseabfrage; das Sandbox-`process`-Objekt steht nicht als frei lesbares Global für nachträglich injizierten Code bereit. Der endgültige Test verwendet kanonische Pfade, die öffentliche OS-Prozessmetrik und einen Vergleich der JavaScript-Kontexte.

Außerdem kann Playwrights `page.evaluate` Chromium-Nutzeraktivierung setzen. Ein früher Vorlauf öffnete deshalb den Testlink `https://example.invalid/`, statt den erwarteten Negativfall auszulösen. Das war kein bestätigter Produktfehler. Der endgültige Test wartet beobachtbar auf inaktive Nutzeraktivierung, verwendet `webContents.executeJavaScript(..., false)` und prüft die Vorbedingung nochmals unmittelbar vor dem Aufruf; bei falscher Vorbedingung wird kein externer Link geöffnet.

- **Bestanden:** isolierte strenge TypeScript-Prüfung der neuen Testdatei, Exit-Code 0:

  ```text
  npx tsc --ignoreConfig --noEmit --target ES2022 --module ESNext --moduleResolution bundler --lib ES2023,DOM --types node --strict --skipLibCheck --noUnusedLocals --noUnusedParameters --noUncheckedIndexedAccess tests/electron/backend-shell.spec.ts
  ```

- **Fehlgeschlagen:** `npx tsc -p tsconfig.node.json --noEmit`, Exit-Code 2. Der letzte Lauf meldete Fehler in `src/catalog/builtin.ts`, `src/catalog/icon.ts`, `src/catalog/index.ts` und `tests/unit/catalog/catalog.test.ts`; keine Fehler in der neuen Electron-Testdatei. Diese fremden Dateien wurden nicht geändert.
- **Bestanden:** abschließende Inhalts-/Whitespace-Prüfung der Testdatei; keine verbliebenen Fixture-Verzeichnisse.

## Grenzen und Fortsetzung

Der Nachweis gilt für die gebaute Electron-Hülle mit einer **Fixture statt der Produktoberfläche**. Er bestätigt keine Whiteboard-Funktion, keine fertige UI, keinen vollständigen Datei-Öffnen-/Speichern-Dialogablauf und keine Zusammenarbeit mit MCP oder P2P. Er prüft die Zurückweisung eines fremden WebContents; damit sind nicht automatisch alle Subframe-/Origin-Angriffsfälle abgedeckt.

Es wurde eine ungepackte App mit realen Build-Artefakten gestartet, kein ausgeliefertes Installationspaket. **Kein Packaging-, Signierungs-, Windows-, Linux- oder Dreiplattformnachweis.** Die verwendete öffentliche OS-Sandbox-Metrik ist auf macOS und Windows verfügbar; unter Linux bleibt dieser spezifische OS-Nachweis durch den Test offen.

Nächster Schritt: Root integriert den Test, hält den Nachweis in #8/#15 aktuell und koordiniert anschließend Produkt-Renderer-, Packaging- und Zielplattformprüfungen. Der Subagent hat weder GitHub noch Graphify geändert und keine Issue-Schließung vorgenommen.
