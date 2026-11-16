# B8 – Korrektur des Codex-Befunds

B8 ist behoben und durch eine Regression belegt, die gegen den unkorrigierten Stand fehlschlägt. Der Befund stammt aus der unabhängigen Codex-Prüfung (`/tmp/sketchdraw-210-b8-alias-probe/result.json`); ich habe ihn weder im Erstreview noch im Korrekturlauf gefunden. Typecheck und Build sind nach dieser Korrektur nicht gelaufen (im Harness gesperrt) und bleiben bei Root.

**Identität:** Modell laut Systemkontext `claude-fable-5-2` (Claude Agent SDK), dieselbe Sitzung. CLI-Version und Effort-Stufe sind für mich nicht einsehbar.

## Ursache
`remember()` reichte die jobeigenen Maps `published` und `pending` per Referenz in `updateLiveLinks`. Die dort von `parseConfluenceLinks` gebaute Kopie wurde nur zur Prüfung benutzt und verworfen. Damit war der gespeicherte Profilstand im Speicher dasselbe Objekt wie die Arbeitskopie des Laufs.

Die Upload-Schleife änderte nach dem Vorab-Journal also auch den vermeintlich gespeicherten Stand. Das `remember()` im `catch` fand dann keinen Unterschied und schrieb nichts. Die Voraussetzung ist eine bereits nicht leere `published`-Map; deshalb fiel der Fehler bei Erstveröffentlichungen nicht auf.

Das Aliasing bestand schon vor meinem Korrekturlauf. Meine B2-Änderung hatte die Prüfung eingeführt, das Ergebnis aber nicht übernommen.

## Korrektur
`updateLiveLinks` (`electron/plugin-service.ts:752-755`) speichert jetzt die frisch gebaute, geprüfte Kopie des Parsers statt der übergebenen Objekte. Persistierter Stand und Arbeits-Maps sind damit getrennt.

Unverändert bleiben:
- Token-, Profil- und Autoritätsprüfungen,
- die Historie der Besitznachweise,
- atomares Schreiben,
- das Vorab-Journal vor dem ersten Upload,
- der Schutz bei unbestätigten Uploads,
- die Fehler aus dem `update`-Callback (z. B. zu viele Verknüpfungen), die weiterhin unverfälscht durchgereicht werden.

## Regression
Neuer Block in `tests/unit/confluence-live-service.spec.ts:927`, ohne gleichzeitige Einstellungsänderung, mit zwei zuvor erfolgreich veröffentlichten Seiten und einem Confluence-Fake ohne Digest.

**Upload 2 wird vor dem Anwenden abgelehnt (`:949`):**
- Upload 1 wird bestätigt, Upload 2 bekommt ein synthetisches 403.
- Auf Platte steht danach Bild 1 als Version 2 mit neuem Hash, Bild 2 als Version 1, und nur Bild 2 ist als gesendet vermerkt.
- Dieselbe Instanz versucht beim nächsten Lauf nur Bild 2; der Record bleibt unverändert.
- Nach Neustart ohne Remote-Digest gibt es keine Blockade wegen Bild 1 und keinen erneuten Upload von Bild 1.
- Sobald Confluence annimmt, wird genau Bild 2 gesendet. Sein früherer Upload ist nachweislich nie angekommen (Version unverändert), also ist erneutes Senden vertragsgemäß.
- Endstand: beide Bilder Version 2, kein Vermerk mehr.

**Antwort auf Upload 2 geht verloren (`:985`):**
- Der Upload kommt an, die Antwort nicht. Der Record ist derselbe wie oben.
- Der Lauf stoppt weiterhin mit „bestätigt seinen Inhalt nicht“, aber ausschließlich für die Datei von Bild 2.
- Es folgt kein weiterer Upload, auch nach Neustart. Der Schutz ist also nicht gelockert.

## Prüfläufe

| Befehl | Stand | Ergebnis |
|---|---|---|
| `npx vitest run --config vitest.config.ts tests/unit/confluence-live-service.spec.ts -t "stops between two uploads"` | vor der Korrektur | 2 von 2 fehlgeschlagen |
| `npx vitest run --config vitest.config.ts` mit Service-, `plugin-service`-, Scheduler-, Image-, Store-, Domain- und `i18n-coverage`-Spec | nach der Korrektur | 7 Dateien, 139/139 bestanden |

Der Fehlschlag vor der Korrektur zeigt auf Platte `published` v1/v1 und `pending` für beide Bilder, mit denselben Dateinamen und Hashes wie in `result.json`.

Nicht ausgeführt:
- `npm run typecheck` und `npm run build` nach dieser Korrektur,
- Hash-Berechnung (`shasum` gesperrt),
- native Tests, Browser, Tenant.

Vitest prüft keine Typen. Die neue Zuweisung im `try` mit werfendem `catch` und der Testcode sind nur per Durchsicht typgeprüft.

## Geänderte Dateien
- `electron/plugin-service.ts`: nur `updateLiveLinks` und der Kommentar darüber.
- `tests/unit/confluence-live-service.spec.ts`: ein neuer `describe`-Block mit zwei Tests.

Sonst ist nichts angefasst. Die Abdeckung der übrigen Dateien aus dem vorigen Lauf gilt weiter.

## Verbleibende Grenzen
- **Gespeicherte Form:** Der gespeicherte Linkstand ist jetzt immer die normalisierte Form des Parsers. Ein Record ohne Anhangs-ID, den der Ladepfad ohnehin verwirft, wird damit auch beim nächsten Schreiben nicht mehr mitgeführt. Das entspricht dem bisherigen Ladeverhalten.
- **Andere Aliasing-Stellen:** Ich habe keine weitere gefunden. `saveConfig` und `configOf` teilen das Link-Array weiterhin per Referenz, es wird aber nirgends in place verändert. `runLivePublish` kopiert die Maps beim Start und ersetzt Einträge nur in der eigenen Kopie.
- **B3/#219, B6/#220 und die #217-Registrierungsbeobachtung** sind unverändert offen.
- **Abnahme:** Native Abnahme, Tenant-Prüfung und Zielbranch-Integration sind nicht erfolgt und werden nicht beansprucht.
