# #149 — HyperDHT und verschlüsselter Relay-Fallback

- Issue: https://github.com/J-ARTS/de.sketchdraw.io/issues/149
- Ausgangsstand: `bd610f6`, Branch `codex/149-hyperdht-relay`.
- Aktueller Status: lokale Produktabnahme bestanden; Review / Zielbranchintegration ausstehend. Kein Release oder öffentlicher Netzwerk-Nachweis. Die folgenden Zwischenstände bleiben als Historie erhalten.
- Ausführung: Claude Code CLI 2.1.185, `claude-sonnet-5-5`, `--effort high`; Run/Sitzung `7fcd65b3-bd16-4c09-8731-18ec7a9f4487`. Modell im initialen CLI-Ereignis bestätigt; kein Modellfallback konfiguriert.
- Root/Codex: Architektur, GitHub, unabhängiges Review, Gesamtprüfung, Ledger/Graphify.
- Lesendes Codex-Subreview: `/root/hyperdht_architecture_review`, bestehende Verträge/Rollen/Build und Sicherheits-/Testlücken; keine parallelen Codeänderungen.
- Claude-Umfang: Collaboration-Transport, notwendige Electron-IPC-/Build-Anbindung, URL/PIN-Oberfläche, Relay-Dienst, fokussierte Tests und Implementierungsbericht.
- Grenzen: native HyperDHT-Direktverbindung plus tatsächlicher verschlüsselter WSS-Datenfallback. Die ausdrückliche Relay-Anforderung ersetzt für diesen Modus das alte relayfreie Ziel. Dokumentautorität, Rollen und Yjs bleiben erhalten. Kein erfundener öffentlicher Relay-Endpunkt.
- Artefakte: `docs/reviews/claude-149-hyperdht-relay.md` (in Erstellung); Laufprotokoll lokal `/tmp/sketchdraw-149-claude-run.jsonl`, Auftrag `/tmp/sketchdraw-149-claude-prompt.md`.
- Prüfplan: reales lokales HyperDHT und WebSocket-Relay, bidirektionaler Dokumentabgleich, falsche PIN/Manipulation/Replay/Viewer, direkter Timeout→Relay, Reconnect/Abbruch/Cleanup, Payload-/Backpressure-Limits, Typecheck/Unit/UI/Electron/Build. Reale verschiedene NAT-/Proxy-Netze und Windows/Linux bleiben ohne entsprechende Umgebung unbestätigt.
- Bekannte angrenzende Lücken: #72 externe Trystero-Netzwerkabnahme, #145 Graphify-Knotenschutz. Diese Aufgaben werden nicht pauschal als erledigt behauptet.
- Nächster Schritt: Claude-Änderungen unabhängig reviewen, Findings beheben, Testnachweise und verbleibende Grenzen im Issue veröffentlichen.

## Review-Hinweise vor Abnahme

- Bestehender Automatic-Viewer-/MCP-Bug ist separat #150 erfasst.
- Codex-Vorprüfung: `bootstrapRoomDocument` muss bei verlorener erster Sync-Anfrage nach Reconnect erneut anfragen (bisher dauerhaftes `requested`).
- Claudes Vorentwurf nennt `adoptRoomDocument(..., { readOnly })`; das allein genügt nicht für MCP-Gastautorität und Schreibsperre während Reconnect. Endgültige Umsetzung ausdrücklich darauf prüfen.
- Baseline: 9 Dateien/85 Collaboration-/Session-Tests bestanden; kein Nachweis für den neuen Transport.

## Nutzerkorrektur 11.11.2026 19:46

Kein eigener Server/Domain vorhanden; ausdrücklich dezentrale Discovery und dezentrales Relay prüfen. Root hat anhand offizieller Quellen und zweier unabhängiger Reviews die Umsetzung auf native freiwillige Peer-Relays mit HyperDHT-Discovery umgestellt. WSS bleibt optional, keine Pflichtinfrastruktur. Entscheidung: `docs/reviews/149-decentralized-relay-decision.md`.

Claude-Sitzung unverändert, Fortsetzung mit `claude-sonnet-5-5 --effort high`; aktueller Auftrag `/tmp/sketchdraw-149-claude-decentralized.md`, Log `/tmp/sketchdraw-149-claude-run5.jsonl`. Vorherige Teilaufrufe wurden ausdrücklich für Review-/Scope-Checkpoints unterbrochen; nicht als vollständig erfolgreiche Runs werten. Keine Änderungen verworfen, keine konkurrierenden Implementierungsedits.

Zusätzliche Abnahme: reale DHT-Discovery von Helfern, Drei-Peer-Nutzdatenrelay ohne manuelle Endpoint-Eingabe, Ausfallwechsel zwischen zwei Helfern, Helferteilnahme ausdrücklich aktiviert und begrenzt. Restbefunde R16 synchrones Attach-Replay, R17 Bootstrap-Gleichidentitäts-Reconnect/Send nach Abort, R18 Commit nach Verbindungsverlust sind im Live-Feedback festgehalten.

### Community-Relay-Anhang und laufendes Review
Der zusätzliche Nutzeranhang bestätigt freiwilliges Community-Relaying, Discovery und Failover. Offizielle API-Beispiele abgeglichen, HyperDHT #296/#300 weiterhin offen. Architektur bleibt begrenzter gemeinsamer E2E-Anwendungsrelay über native DHT-Streams; optional WSS, keine erfundene öffentliche Infrastruktur. Reviewer besitzen getrennt Hub/Session, Native/Lifecycle und Store/UI/MCP. R20–R27 als konkrete lokale Befunde an laufende Claude-Sitzung übergeben; Details in `docs/reviews/codex-149-validation.md`. #150 jetzt in-progress: https://github.com/J-ARTS/de.sketchdraw.io/issues/150#issuecomment-6804558821 . Keine Integration oder Abschlussbehauptung.

## Claude-Limit und bestätigte Vertretung
Segment6 endet mit API429/is_error=true: „session limit“, Reset00:40 Europe/Berlin. Kein erfolgreicher Abschluss trotz CLI subtype success. Gemäß bestehender AGENTS.md-Vertretungsfreigabe vom17.10.2026 übernimmt Codex die offenen Implementierungsfixes, UI und Tests. Tatsächliche Rollen getrennt: bisheriger Code Claude CLI Sonnet5.5/high; folgende Änderungen Codex. Getrennte Besitzbereiche vor Start: Native/Lifecycle +Tests; Hub/ChannelSocket/PeerRelayHosts +Tests; Gast-Store/CRDT/UI +Tests; Root Sessionintegration/Mehrpeer-Abnahme/Tracking. Kein weiterer Claude-Aufruf vor Reset und keine Umgehung des Limits.

## Bestätigter Zwischenstand nach Codex-Abnahme

- Stand lokal/uncommitted; Code auf `codex/149-hyperdht-relay`. Kein Release/keine Integration behauptet.
- R1–R31 einschließlich nativer Firewall-Abweisung, Fragmentbudget und Desktop-Abschlussreihenfolge behoben; konkrete Nachweise in `docs/reviews/codex-149-validation.md`.
- Fullunit692/692;61Build-Lifecycle;Typecheck/Build;6vorhandeneElectronfälle plus neuer echter2-Prozess-Nativfall;7HDHT-UI-Fälle nach letzter Änderung bestanden. Echtes macOSarm64-Paket mitSandbox/MCP und gepackten Native-Addons/8MiBübertragung geprüft.
- Zusätzlicher ausdrücklicher Nutzerauftrag: Fable5.2/high Sparring über ClaudeCode. ÄltereCLI inkompatibel, bereits installierteCLI2.1.321 startet tatsächlich `claude-fable-5-2`, Session5db4e51b-d87f-4bd2-a71a-44ca84903e8c. Nur lesend; Ergebnis noch ausstehend. Run/Artefakt imLedger; nicht mitSonnetErstimplementierungverwechseln.
- Nächster Schritt: Fable-Befunde prüfen, nötigeFixes + erneute betroffeneTests, Graphify/Traceability und Integration. #72 externeNetze/Skalierung weiterhinoffen.


## Finale Übergabe nach Fable-Sparring und Bild-Sync

- GitHub maßgeblich: #149, #150 und #151 offen mit `status: review`, lokale Abnahme bestanden, Integration ausstehend. Bestätigte Kommentare: [#149](https://github.com/J-ARTS/de.sketchdraw.io/issues/149#issuecomment-6805630473), [#150](https://github.com/J-ARTS/de.sketchdraw.io/issues/150#issuecomment-6805631636), [#151](https://github.com/J-ARTS/de.sketchdraw.io/issues/151#issuecomment-6805632850). Kein Ticketabschluss vor Integration.
- Tatsächlicher Review-Run `claude-149-fable-sparring-5db4e51b`: Claude Code 2.1.321, `claude-fable-5-2`, high, abgeschlossen. 50 Turns / 508,246 s, keine Fable-Tests/Edits. Originalbericht und gemessene Metriken unter `docs/reviews/claude-149-fable-sparring.md` und `149-fable-metrics.json`. Früherer Sonnet-Run mit Limit bleibt separat.
- Codex-Run `codex-149-fallback-review-fixes`: fünf Befundgruppen und R31-Nachbesserung korrigiert; neue Großtransferfehler unabhängig reproduziert und behoben. Drei Subagenten abgeschlossen, keine aktiven konkurrierenden Edits. Nur Root änderte Issue-/Ledger-/Graphstatus.
- Neuer separater bounded Yjs-Transfer synchronisiert große echte PNGs und sämtliche unterstützten Dokumentinhalte: Shapes/Freihandpfade, Seiten, Texte, Notizen, Annotationen, Kommentare, Aufgaben. Exakte Yjs-IDs erhalten, Schattenvalidierung/Dokument-ID/Rollen geschützt. Viewer und unterbrochene Gäste bleiben lokal schreibgeschützt und ohne MCP.
- Finale Prüfung: **751 Unit-, 10 UI-, 7 Electron-, 61 Build-Lifecycle- und 22 Python-Tests bestanden**; Typecheck und Build grün. Tatsächliches neues macOS-arm64-Verzeichnispaket/Sandbox/MCP sowie 8-MiB-Nativprobe aus app.asar bestanden. Alle Quell-/Pakethashes und Befehle in `docs/reviews/149-local-validation.json`, Historie/Fehlläufe in `codex-149-validation.md`.
- Zwei frühere UI-Abbrucherwartungen erwiesen sich als unpassend für erholbare Socketfehler; ausschließlich Tests korrigiert, tatsächliche Unterbrechung/Schreibschutz/Nachlieferung/Gegenrichtung nachgewiesen. Finale ganze UI-Suite zehn Fälle grün.
- Offene Folgearbeit: #152 Backoff/Eignung/Weiterleitungsprüfung für Helfersuche geplant; #72 reale NAT-/CGNAT-/Proxy-/Skalierungsabnahme offen. Keine öffentliche Helferflotte belegt. Windows/Linux/Signierung/Installer/Release dieser Revision nicht geprüft.
- Graphify: letztes Codeupdate verweigert durch Knotenschutz (5.801 neu / 6.036 vorhanden), #145 mit Repro aktualisiert; nicht erzwungen. Ledger-/Traceability-Projektion getrennt regeneriert und geprüft, kein frischer vollständiger Codegraph behauptet.
- Nächster konkreter Schritt: lokalen Stand von `codex/149-hyperdht-relay` auf Basis `bd610f6` integrieren; CI-/Plattformprüfungen und Release gesondert ausführen. Vor Fortsetzung aktuelle Issues und Quell-/Pakethashes abgleichen. Keine Dateien aus fremden `.claude/`-/`.idea/`-Änderungen übernehmen.
