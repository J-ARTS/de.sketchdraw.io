# B8 – unabhängige finale Nachprüfung

Codex, 2026-11-16 12:25:20 UTC, finaler Service-SHA256 `91b4310efad6c074dcc9cd29565395005eb5fe169f20ae60b356ff360a59a2c4`. Nachherhashes geprüft 12:26:30 UTC.

**Ergebnis: PASS für den isolierten Service-Regressionsfall.** Die historische Reproduktion unter `b8-independent-before/` bleibt unverändert und belegt den vorherigen Fehler.

Die ursprüngliche eigene Probe wurde in einem separaten `/tmp`-Verzeichnis erneut aus den echten aktuellen Produktquellen gebündelt. Nur die Erwartungen wurden auf den gesunden Zustand umgestellt: Nach einer erfolgreichen Zweibild-Publikation wird Upload 1 der Folgepublikation bestätigt und Upload 2 synthetisch vor Anwendung mit HTTP 403 abgelehnt. Es gibt keine gleichzeitigen Einstellungen-Schreibvorgänge; Remote-GETs liefern keinen Digest.

Tatsächlicher Befund:
- Datei **und** Arbeitsspeicher enthalten nach dem Teilfehler `published` v2/v1 und `pending` ausschließlich für Bild 2.
- Die erste Dienstinstanz wurde beendet, die nächste aus derselben Datei gestartet.
- Danach genau ein Upload, ausschließlich Bild 2; Ergebnis `synced`, beide Bilder v2, `pending` leer. Bild 1 wird weder fälschlich angezweifelt noch doppelt übertragen.
- `findingReproduced: false`, `productRegressionPass: true`, Prozess Exit 0.

Tatsächlich ausgeführt:

```text
node /tmp/sketchdraw-210-b8-final-probe/build.mjs
node /tmp/sketchdraw-210-b8-final-probe/probe.mjs
```

Der Produktdiff gegenüber dem vorigen Snapshot `87caa6ee…` betrifft ausschließlich `updateLiveLinks` und seinen Kommentar. Er speichert den Rückgabewert von `parseConfluenceLinks` statt der eingegebenen Referenzen. Der Parser baut Link, Maps und Einträge neu auf. Der leere Rückgabewert entfernt das Linkfeld; Callbackfehler bleiben außerhalb des Parser-catch unverfälscht. Historische Eigentumsnachweise und Pending-Absichten werden nicht pauschal verworfen. Kein weiterer materieller Befund im engen Diff.

Die neuen Fable-Tests in `tests/unit/confluence-live-service.spec.ts:927` wurden unabhängig gelesen. Sie decken diesen Teilfehler in derselben und einer neu geladenen Instanz ab. Der zweite Test lässt Upload 2 tatsächlich ankommen und nur die Antwort verschwinden: Ohne Digest bleibt dann ausschließlich Bild 2 blockiert und es entsteht keine weitere Uploadversion. Dieser Schutz wurde in dieser eigenen Probe nicht noch einmal ausgeführt; er ist Gegenstand der gelesenen Fable-Regression und dessen Prüfnachweise.

Alle 22 tatsächlich gebündelten Produktquellen und die als Fixturevorlage gelesene Testdatei waren nach Bundle-Erstellung und nach Probe hashgleich. Vollständiges Manifest beigefügt; exakte Produkt-Snapshots und Bundle bleiben ausschließlich unter `/tmp/sketchdraw-210-b8-final-probe/`.

- Harness: `edfba1db49049584e88aeb83ec0966605fccffadfd4a19741ac7971e41f4bb33`
- Bundle: `70a804be73ae393a8cdbe4953c47e3af38cdbae0984a69a73c5916a9830417c6`
- Resultat: `104a9b38b4c46e06287d384d700a610e92899654049e5da5339c406572eb0c17`

Keine Produkt-/Repository-Testdateien verändert, keine App oder Tenant benutzt, keine nativen Tests oder Repository-Builds ausgeführt. Es handelt sich um eine synthetische Service-/Dateisystemprüfung, **keine native, Tenant- oder Zielbranch-Integrationsabnahme**. Root führt die weitergehenden Prüfungen separat durch.
