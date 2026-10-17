# Sketchdraw

Ein lokaler Visual Workspace für Windows, macOS und Linux. Menschen und Agenten bearbeiten dasselbe Diagramm – auf dem Canvas oder als lesbaren Quelltext.

> Everything you can draw, an agent can understand. Everything an agent can create, a human can edit.

## Funktionen

- Whiteboard mit Formen, Freihandzeichnungen, Text, Bildern, Verbindungen und Containern.
- Erweiterbare Komponentenbibliothek für AWS, Azure, GCP und allgemeine Architekturen.
- Synchronisierter Diagrammtext mit Validierung, Konfliktprüfung und erhaltenen Entwürfen.
- SVG- und draw.io-Austausch mit einer Vorschau möglicher Konvertierungsverluste.
- MCP-Zugriff nach ausdrücklicher lokaler Freigabe, getrennt nach Lesen und Schreiben.
- Verschlüsselte direkte Zusammenarbeit mit manuellem Einladungsaustausch und Rollen.

Dokumente werden lokal gespeichert. Die Zusammenarbeit verwendet keine zentralen Dokument-, Signaling-, STUN-, TURN- oder Relay-Dienste. Direkte Erreichbarkeit ist deshalb nicht in jedem Netzwerk gegeben. Eine Agentenänderung wird nicht automatisch auf die Festplatte gespeichert.

## Entwicklung

Voraussetzungen und Plattformdetails stehen in [docs/setup.md](docs/setup.md). Der verwendete Stack ist Electron, Vue 3 und TypeScript; Abhängigkeiten sind über das Lockfile festgelegt.

```sh
npm ci
npm run build:mcp
npm run dev:electron
```

Für die Browservorschau: `npm run dev:browser`. Der lokale MCP-Zugriff benötigt die Desktop-App.

```sh
npm run typecheck
npm run test:unit
node --test tests/unit/*.test.mjs
npx playwright install chromium
npm run test:ui
npm run test:electron
```

## Dokumentation

- [MCP verbinden und verwenden](docs/agent-integration.md)
- [Installer und Releaseprüfungen](docs/release.md)
- [Architektur](docs/architecture.md), [Sprints](docs/sprints.md) und [geprüfte Bedenken](docs/concerns.md)
- [GitHub-Tickets](https://github.com/J-ARTS/de.sketchdraw.io/issues) als dauerhafte Statusquelle
- [Graphify und Aufwandserfassung](docs/graphify-traceability.md)

Das Zielbild und die verbindliche Zusammenarbeit stehen in [AGENTS.md](AGENTS.md) und [CLAUDE.md](CLAUDE.md). Einzelne Testberichte gelten jeweils für den dort genannten Stand; offene Prüfungen sind kein bestandener Release.
