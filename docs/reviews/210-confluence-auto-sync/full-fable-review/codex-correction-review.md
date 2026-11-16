# Unabhängiger Abschlussreview der Fable-Korrekturen

Codex, 2026-11-16. Umfang: B1/B2/B4/B5/B7 des Fable-Gesamtreviews, finale B8-Korrektur und belegte Review-/Prüfabdeckung. Arbeitsbaum `codex/210-confluence-integration`; keine Produktänderungen durch diesen Review. Der ursprüngliche Desktop-Arbeitsbaum wurde hier nicht aktualisiert.

**Ergebnis:** Die sechs abgegrenzten Befunde sind im geprüften Quellstand nachvollziehbar korrigiert. Kein weiterer materieller Befund im engen Korrekturdiff. B8 wurde vor der Korrektur unabhängig reproduziert und danach mit derselben isolierten Fallfolge erfolgreich nachgeprüft. Dies ist keine native, Tenant- oder Zielbranch-Integrationsabnahme.

## Quellen und Regressionen

| Befund | Unabhängige Beurteilung am finalen Stand |
|---|---|
| B1 | `electron/plugin-service.ts:563`: `saveConfig` übernimmt Links erst innerhalb der serialisierten Mutation aus dem aktuellen Profil; der vorab erstellte Settings-Snapshot trägt sie nicht mehr zurück. Laufzeitkonfiguration wird aus dem gespeicherten aktiven Profil gelesen. Jira-Deinstallation entfernt Links ausdrücklich, Git-Deinstallation erhält sie (`:772`). Die gelesenen Tests ab Service-Spec `:1028` halten das tatsächliche Dateiumbenennen an, lassen vier Settings-Operationen konkurrieren und prüfen Datei, nächste Veröffentlichung und Neustart. Pending-Phase separat geprüft. |
| B2 | Gemeinsamer Parser in `updateLiveLinks` (`:746`), Pfadprüfung vor Confluence-Zugriff (`:1104`), Kapazitätsreservierung vor jeglicher Remote-Anfrage (`:1285`). Historische Eigentumsnachweise bleiben erhalten. Tests ab `:1125` prüfen 400/401, unveränderte Datei und null Requests bei Ablehnung, Lesbarkeit nach Neustart, zurückkehrende Seite mit fremder Folgeversion sowie problematische Pfade. Kein unkontrolliertes Kürzen der Historie. |
| B4 | Seitenplan und Größenprüfung erfolgen vor Attachment-Abfragen und Uploads (`:1291`); erneutes Lesen und Konfliktprüfung unmittelbar vor dem Seiten-PUT bleiben erhalten. Tests `:1228`/`:1250` prüfen unsicheres Markup und Größenüberschreitung ohne Upload sowie erfolgreiches Fortsetzen nach Reparatur. |
| B5 | `src/renderer/state/confluence-live-sync.ts:189`: Auch eine während des laufenden Versuchs eingetroffene Änderung berücksichtigt danach `holdUntil`. Nur der ausdrücklich angeforderte Folgelauf darf diese lokale Fehlerhaltezeit umgehen; `schedule()` erzwingt weiterhin die Serverpause. Fake-Clock-Tests ab Scheduler-Spec `:103` prüfen Haltezeit, neuesten Inhalt, manuellen Folgelauf, normalen Erfolgsfall und Retry-After. Kein weiterer materieller Befund. |
| B7 | Größenablehnung vor Queue/Remote-Zugriff benennt die betroffene Seite und 10 MiB (`plugin-service.ts:1163`). Kontrollzeichen werden bereinigt, fehlender Name durch Seitenposition ersetzt. Test `:1265` prüft Limit+1, keine Requests auch für passende andere Bilder und Erfolg exakt am Limit. Die drei neuen Übersetzungen in `en.ts:882` passen zum vorhandenen dynamischen `tm`-Vertrag. |
| B8 | `updateLiveLinks` speichert die neu aufgebauten Parserobjekte; Jobmaps und gespeicherter Zustand sind getrennt. Callbackfehler bleiben außerhalb des Parser-catch. Neue Tests ab `:927` decken sowohl abgelehnten zweiten Upload als auch tatsächlich angewandten Upload mit verlorener Antwort ab. Eigene finale Probe: nach Teilfehler Datei=Memory v2/v1, Pending nur Bild 2; Neustart ohne Remote-Digest überträgt ausschließlich Bild 2, danach v2/v2 und Pending leer. |

B1/B2/B4/B7 wurden zuerst am eingefrorenen Vor-B8-Service `87caa6ee…` geprüft. Der finale Diff zu `91b4310…` verändert ausschließlich `updateLiveLinks` und den erklärenden Kommentar; die übrigen Korrekturen bleiben erhalten. Die B8-Nachprüfung schließt die dabei gefundene Aliaslücke, ohne die Eigentums-/Ungewissheitsschranken zu lockern.

## Tatsächlich belegte Prüfungen

Aus den Toolergebnissen, nicht allein aus Fables Abschlussbehauptung:

- `correction-events.jsonl:360`: 57/57 gezielte Tests.
- `:370`: 8 erwartete Fehlschläge / 49 Erfolge bei temporären Mutationen; darunter die neuen B1-/B5-Regressionen.
- `:391`: nach Rücknahme 137/137 in sieben Specs, 6,19 s.
- `:404`: erfolgreicher unverketteter Produktionsbuild mit abgeschlossenen Renderer-, Electron- und MCP-Schritten.
- `:395`: Typecheck-Aufruf ohne Fehlerausgabe. Der Befehl pipete jedoch zu `tail` ohne separat gesicherten Typecheck-Exitcode; dieser alte Nachweis allein wird hier nicht als unabhängig bestätigter Typecheck-Exit 0 ausgegeben. Root führt die Prüfung am finalen Stand neu aus.
- `b8-events.jsonl:62`: die zwei neuen B8-Tests vor Fix fehlgeschlagen; `:81`: final 139/139 in sieben Specs, 6,19 s.
- Eigene isolierte B8-Probe vor/nach Fix: historische Defektreproduktion und finale Gesundheitserwartung, jeweils mit exakten Quellen-/Harnesshashes. Keine weitere Testsuite durch diesen Reviewer ausgeführt.

B8-Artefakte sind unter `b8-independent-before/` und `b8-independent-after/` archiviert: jeweils nur Harness, Ergebnis, Manifest und Review. Drittbibliotheken, Bundle und temporäre Profil-/Testdaten wurden nicht ins Repository übernommen. Die historische Reproduktion wurde nicht überschrieben.

## Reviewabdeckung und nötige Präzisierung

Ausgangsmanifest: 33 geänderte Quell-/Testdateien im Integrationsarbeitsbaum, 22 im Original. Fables Restlektüre und Vergleiche ergänzen den Erstreview. Über beide Eventstreams existiert für alle 33 Integrationsdateien ein erfolgreicher Read-/Diff-Nachweis. **Keine konkret ungelesenen Änderungshunks identifiziert; eine Volllektüre jeder unveränderten Zeile sämtlicher Dateien wird nicht behauptet.**

Zwei zuvor unklare Bereiche sind durch tatsächliche erfolgreiche Toolausgaben geklärt:

- `events.jsonl:183`: vollständige ausgelagerte Diffausgabe (488/488 Zeilen), enthält alle vier Persistenzhunks.
- `events.jsonl:272`: vollständige ausgelagerte UI-Diffausgabe (348/348 Zeilen), enthält auch die PluginSettings-Hunks bei 325–346 und 358–365 einschließlich der vollständigen Live-CSS-Zeile. Die ersten kurzen Bash-Vorschauen waren nicht die einzige Lektüre.

Damit fehlt für diese beiden Bereiche kein Änderungsreview. Die Formulierung im Fable-Korrekturbericht „vollständig als Datei gelesen“ ist für `persistence.ts` und `PluginSettings.vue` dennoch zu stark: unveränderte Restzeilen sind nicht vollständig durch die Read-Nachweise gedeckt.

Der behauptete vollständige maschinelle Abgleich aller 64 ursprünglichen `en.ts`-Ergänzungen ist **nicht belegt**: Vergleichsbefehle in `correction-events.jsonl:446/453` wurden abgewiesen (`:448/455`), der spätere erfolgreiche Suchnachweis (`:473`) umfasst sieben Treffer. Daraus folgt kein belegter verlorener Übersetzungseintrag; wohl aber muss die Vollständigkeitsbehauptung präzisiert oder mit einem erfolgreichen vollständigen Abgleich ergänzt werden. Dieser Abgleich ist von der nachgewiesenen Lektüre der aktuellen Änderungshunks zu unterscheiden.

Die 16 hashidentischen Original-/Integrationsdateien gelten nur für das Ausgangsmanifest. Von diesen wurden im Korrekturlauf vier verändert (Service, Scheduler, beide zugehörigen Specs); `en.ts` war bereits vorher verschieden. Die historische Zahl darf nicht als heutige Gleichheit ausgegeben werden. Änderungen im Original enthalten die Korrekturen noch nicht.

## Stand und Grenzen

Finale Hashes:

- Service: `91b4310efad6c074dcc9cd29565395005eb5fe169f20ae60b356ff360a59a2c4`
- Scheduler: `d8ff6e0ecf8f8d5c14eba576583134d3f22ee7cdef8ca83435fea443ed8a3688`
- `en.ts`: `f7f690b6be8ebb8482b83684fcfb9d035d39fc6a38cc9d54305d399b47e000ef`
- Service-Spec: `98c92a13c4e8a22397fba5063b78486baf7c04bfbd3c13c1d95c4e787c9ff6b4`
- Scheduler-Spec: `dcdbfd35b82c1f25421e3c2a0db11648c3c7218df51565cb2da23ce3807e0655`

Die eigene B8-Probe hatte 22 gebündelte Produktquellen; alle Vor-/Nachherhashes sind gleich. Maßgebliche Details: `b8-independent-after/manifest.json` und `review.md`.

Keine vollständige Unit-/UI-/Storybook-/native Suite dieses Reviewers; keine Tenant-Nutzung, keine Integration oder Veröffentlichung. Roots neue native Prüfung läuft separat und wird nicht vorweggenommen. B3/#219 und B6/#220 bleiben außerhalb dieser Korrektur offen; die gesonderte #217-Registrierungsbeobachtung ist durch diesen Review ebenfalls nicht erledigt. Vollständige Änderungslektüre ist weder Fehlerfreiheit noch End-to-End-Abnahme.
