# Gemeinsame DocumentAuthority — Implementierung und Prüfnachweis

Stand: 17.10.2026. Issues [#13](https://github.com/J-ARTS/de.sketchdraw.io/issues/13), [#14](https://github.com/J-ARTS/de.sketchdraw.io/issues/14), Architektur [#6](https://github.com/J-ARTS/de.sketchdraw.io/issues/6). Implementierung: echter interner **Codex**-Subagent `domain_review`, nach ausdrücklicher Root-Delegation und Nutzerfreigabe zur Übernahme; kein Claude-Code-/Antigravity-Beitrag. Änderungen sind lokal, noch nicht integriert/committet. Root koordiniert GitHub-Status und unabhängige Abnahme.

## Ergebnis und öffentliche API

`src/session/index.ts` exportiert den unveränderten gemeinsamen Vertrag aus §2/§8 von `docs/contracts-p2p.md`: `createDocumentAuthority`, `SessionAccessError` und Gateway-/Source-/Binding-/Commit-/Lifecycle-Typen. Nur die von Root freigegebene Ergänzung PP-01 wurde zusätzlich im Vertrag aufgenommen: `peerSessionId` an Peer-Bindings und `finalizePeerSession(peerSessionId)`.

- Eine Authority übernimmt exklusiv genau einen bestehenden Domaincontroller und erzeugt die Epoche mittels Web Crypto. Derselbe Controller lässt sich nicht erneut übernehmen. Es gibt keinen direkten Schreibexport und keine Abhängigkeit von Vue, Electron, MCP oder Collaboration.
- Unveränderliche Bindings halten Actor, Source, Grant und Generation. Synchrone Guards prüfen Reads, History, Benachrichtigungen, Ergebnisabfragen und Writes. Promise-, Throw-, fehlerhafte und reentrante Guards werden verweigert.
- Die FIFO-Queue registriert IDs vor der ersten asynchronen Verarbeitung. Canonical JSON und SHA-256 unterscheiden identische Wiederholungen von veränderten Payloads. Ein Pending pro Actor gilt auch über dessen Human-/Code-/Import-Bindings hinweg. Angenommene fachliche Ablehnungen und No-Ops verbrauchen ihre Sequenz. Verdrängte Journalergebnisse bleiben über den High-Water-Mark gegen Wiederholung gesperrt.
- Direkt vor Dispatch/Undo/Redo werden Grant, Authority, Gate und CAS synchron erneut geprüft. Die echte Domainhistory bleibt actorbezogen erhalten. Source- und Commitlistener erhalten Kopien; Journalabschluss erfolgt vor Benachrichtigung, Listenerfehler werden isoliert, reentrante Writes hinten eingereiht.
- Controllerumgehung führt zum dauerhaften `AUTHORITY_DIVERGED`-Stopp ohne erfundene Commitmetadaten. Ist der eigene linearisierte Ausgang dadurch nicht vertrauenswürdig bestimmbar, lautet er `outcome-unknown`; ein bereits möglicherweise erfolgter Commit wird nicht als zurückgerollt dargestellt.
- Revoke und Transition sperren schon synchron. Noch nicht linearisierte Einträge werden terminalisiert; Barrieren warten auf keine entfernten ACKs. Tokenidentität, Revision, Epoche und vom Store übergebene Draftgeneration sichern asynchrone Dialogfortsetzungen. Close/Replace legen die Authority endgültig still; Revoke-Abschluss erlaubt weiterhin berechtigte lokale Bindings.
- Finalisierung vollständig widerrufener Peer-Gruppen entfernt ausschließlich deren Retentionsbudgets. Alte Gateway-/Sourceobjekte und die abgeschlossene Session-ID bleiben gesperrt. Lokale Bindings, History und Revision bleiben bestehen. Wiederholter Widerruf bleibt auch nach Finalisierung idempotent.

Canonicalisierung akzeptiert reine JSON-Daten, keine Accessoren, Funktionen, Zyklen oder nicht endliche Zahlen; sie begrenzt UTF-8-Payloads auf 40 MiB. Der Vertrag begrenzt die Queue auf 64 Einträge, lokale Pendingeinträge auf 32, Retention auf 1.024 kleine Ergebnisse beziehungsweise 4 MiB und Bindingzahlen auf die festgelegten Grenzen. Bereits widerrufene, aber noch hashende Payloads behalten ihre Byte-Reservierung bis zum lokalen Abschluss: schnelles Widerrufen darf das Speicherbudget nicht umgehen. Diese Bytebudgets sind keine Gesamt-RAM-Garantie; große produktive Dokumente und Domainhistory benötigen weiterhin Lasttests.

## Prüfungen

Umgebung: macOS, Node 22.16.0, Vitest 5.0.5, TypeScript 6.0.3. Letzte gezielte Wiederholung am 17.10.2026, 16:02:43 lokale Toolzeit.

| Prüfung | Ergebnis |
| --- | --- |
| `npx vitest run tests/unit/session/authority.spec.ts` | **19/19 bestanden** mit echtem Domaincontroller |
| `npx tsc -p tsconfig.node.json --noEmit` | **Bestanden** |
| `npx tsc --ignoreConfig --noEmit --target ES2022 --module ESNext --moduleResolution bundler --lib ES2023,DOM --strict --noUnusedLocals --noUnusedParameters --noUncheckedIndexedAccess --skipLibCheck src/session/index.ts` | **Bestanden**, isolierter Session-/Domain-Importbaum |
| Prüfung der Sessionimports | **Bestanden**, keine Node-/MCP-/Collaboration-/Vue-/Electronimporte |
| Vollständiges `tsc -p tsconfig.app.json` um 15:58 | **Fehlgeschlagen** im gleichzeitig bearbeiteten Interop- und Rendererstand: `src/interop/xml.ts` Diagnostic-Arrayform und `src/renderer/state/whiteboard.ts` Typfehler; keine Sessionfehler. Der jeweilige Implementierer/Root wiederholt nach Integration. |
| Browser-/Electron-/MCP-/P2P-Gesamtabnahme | **Nicht ausgeführt**: separater Integrationsumfang, Authority allein ist kein bestandener Produkt- oder Netzwerktest |

Die 19 Fälle prüfen Pending-/Terminal-Deduplizierung, Payloadabweichung und Detachment, Sequenzlücken, No-Op, CAS-Konflikt, Grantgeneration vor Commit, synchronen Revoke, sourceübergreifende Humanhistory, fremde Actoränderungen, Undo/Redo-CAS und History-Konflikte, atomare ungültige Commands, Subscriberisolation und reentrante Queue, eine Pendingoperation pro Actor, Barrier/Cancel/stale Tokens, Close/Replace, direkte und reentrante Controllerumgehung, fehlerhafte Guards, Peergruppenfreigabe mit 32 alten und 32 neuen Scopes, Bindinglimits, Eingabe-/Bytegrenzen, Proxyreentranz, Leserechte bei Subscriberzustellung und High-Water-Mark nach Journalverdrängung.

## Übergabe

Der Renderer-Implementierer `dependency_review` erhielt Composition und konkrete API direkt. Der Store hält weiterhin `savedRevision`, Dirtyzustand und Entwürfe; jede Pointer-/Text-/IME-/Codeänderung erhöht seine Draftgeneration synchron. Nach jeder asynchronen Dialog-/Speicherfortsetzung ist `isCurrent(barrier, aktuelleGeneration)` erforderlich. Die Sessionauthority kann einen nicht gemeldeten UI-Draft nicht erkennen.

Root prüft die Implementierung unabhängig, führt die Ergebnisse zusammen und aktualisiert Tickets/Ledger/Graph. Anschließend werden MCP, Collaboration und Renderer gegen dieselbe Authority integriert. Es wurden keine Domain-/Renderer-/Collaboration-/MCP-/Rootkonfigurationsdateien geändert und keine GitHub-/Graph-Schreiboperationen durch diesen Subagenten ausgeführt.

## Geprüfte Dateistände

SHA-256 des abschließend geprüften lokalen Stands:

| Datei | SHA-256 |
| --- | --- |
| `src/session/authority.ts` | `9811f336b4dcf3069aa7b385818ff90924cbe889f3d916036f2512dbebb5dd99` |
| `src/session/errors.ts` | `62eed4a9d10b076ebc4541404db57e535e7622a44275590910a9465c6bbb8f63` |
| `src/session/index.ts` | `f58ef4ef3b49202bce249d7e41d35944dcfbcf9a53ec74a427f9578c02b513ce` |
| `src/session/types.ts` | `398a4b8adf7d5e3bf8da9b395b46e3e963439cc17a5bcab446d882f90bd99fdb` |
| `src/session/validation.ts` | `98b72fa4f253b1a1708ec28580b5830619930740c53e3d459f4a2726abd566cc` |
| `tests/unit/session/authority.spec.ts` | `b5339cea273c922e498100f3caa9f57c8f176763fda4b875ab02296b32c54180` |
| `docs/contracts-p2p.md` | `d262b9cff5d312a9c47f6a90a921bb634a24708c8ee422f81caddfc2e6148acb` |
| `src/domain/controller.ts` | `7b15a3d2e63c365a91f8cf92041ac8e5ee6135c923f9c03d5e925051eb21b09b` |
