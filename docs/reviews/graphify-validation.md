# Graphify-Validierung

Geprüft am 2026-10-17T12:28:13.494757+00:00. Ticket #7; lokal, noch nicht integriert.

- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tools/tests -v`: 22 Tests bestanden.
- Unabhängige Nachprüfung der drei P2-Befunde: alle behoben; ursprüngliche Repros zusätzlich bestätigt.
- `graphify update .`: AST-Graph erneuert (kein semantischer Dokument-Research-Lauf).
- `python3 tools/graphify-links.py`: 73 Traceability-Knoten und 109 Links aus dem geprüften Ledger ergänzt.
- `graphify cluster-only . --no-label`: vorhandenen Graph visualisiert.
- Erneuter Merge und `--check`: Referenzen, Metriken und Projektion aktuell.
- `graphify path 'Ticket #7:' 'Tool codex-subagent'`: direkte uses_tool-Verbindung bestätigt.

## Umfang und Grenzen

Pfadkollisionen, einfache/parallele Kanten, Hyperedges, Fremddatenerhalt, doppelte Runs und unbekannte Messwerte geprüft. Kein Produkt-UI-/Electron-Test; der Adapter ist ein Entwicklungswerkzeug. Keine automatische GitHub- oder Kostenabrechnungssynchronisation. Mehrere Graph-Schreiber sind weiterhin zu serialisieren. Messungen und Graphzustand gelten nur für den jeweiligen Ledgerstand; nach Änderungen neu projizieren.

## Geprüfte Dateihashes

- `tools/graphify-links.py`: `d87452c751f641b271eb6de4cdf302a7e9aaf59e4c7e0d79a504fcc7c4404ded`
- `tools/tests/test_graphify_links.py`: `df416fe218931808863be120ee6025343e67b583da56edb2f821b82e7848f4dc`
- `docs/graphify-traceability.md`: `35b3abaa56fb0bc0eca31e055230093b11027427a93a0fc4c6504ca613eeae18`
- `AGENTS.md`: `86c4e48aadef392d0dd66d6faaa7bfb3e6b4f2c1d800919accf91598b6d62be2`
- `CLAUDE.md`: `cfa7d11c43847671e26748a4126d0e0e81e6fb3b01b4453e812c8d2281ba7a58`
