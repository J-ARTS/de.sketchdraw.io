# Sketchdraw

Ein lokaler Visual Workspace für Windows, macOS und Linux. Menschen und Agenten bearbeiten dasselbe Diagramm – auf dem Canvas oder als lesbaren Quelltext.

> Everything you can draw, an agent can understand. Everything an agent can create, a human can edit.

## Download

[Release v0.1.1](https://github.com/J-ARTS/de.sketchdraw.io/releases/tag/v0.1.1) enthält drei nativ geprüfte Installer:

- [Windows x64 – Installer](https://github.com/J-ARTS/de.sketchdraw.io/releases/download/v0.1.1/Sketchdraw-0.1.1-windows-x64.exe)
- [macOS Apple Silicon / M1 – DMG](https://github.com/J-ARTS/de.sketchdraw.io/releases/download/v0.1.1/Sketchdraw-0.1.1-macos-arm64.dmg)
- [Linux Debian/Ubuntu x64 – DEB](https://github.com/J-ARTS/de.sketchdraw.io/releases/download/v0.1.1/Sketchdraw-0.1.1-linux-x64.deb)

Windows ist unsigniert; die macOS-App ist ad-hoc-signiert und nicht notarisiert. Hinweise zum ersten Start stehen in den Release-Notes, die konkreten Prüfungen im [Release-Nachweis](docs/reviews/release-validation.md).

## Funktionen

- Whiteboard mit Formen, Freihandzeichnungen, Text, Bildern, Verbindungen und Containern.
- Erweiterbare Komponentenbibliothek für AWS, Azure, GCP und allgemeine Architekturen.
- Synchronisierter Diagrammtext mit Validierung, Konfliktprüfung und erhaltenen Entwürfen.
- SVG- und draw.io-Austausch mit einer Vorschau möglicher Konvertierungsverluste.
- Automatischer lokaler MCP-Zugriff auf das aktuell geöffnete Desktop-Dokument, ohne Freigabe-Tab.
- Verschlüsselte direkte Zusammenarbeit mit manuellem Einladungsaustausch und Rollen.

Dokumente werden lokal gespeichert. Die Zusammenarbeit verwendet keine zentralen Dokument-, Signaling-, STUN-, TURN- oder Relay-Dienste. Direkte Erreichbarkeit ist deshalb nicht in jedem Netzwerk gegeben. Eine Agentenänderung wird nicht automatisch auf die Festplatte gespeichert.

## Lizenz

Sketchdraw steht unter der **PolyForm Noncommercial License 1.0.0**, soweit einzelne Bestandteile nicht anders gekennzeichnet sind. Nutzung, Änderungen und Weitergabe sind für die im [Lizenztext](LICENSE) erlaubten Zwecke möglich. Für darüber hinausgehende kommerzielle Nutzung ist eine gesonderte Erlaubnis der Rechteinhaber erforderlich.

Die [Lizenz-README](docs/licensing/README.md) erklärt die Bedingungen, Drittanbieter-Lizenzen und den Auslieferungsstand. Die Lizenzen der verwendeten Bibliotheken und Schriften bleiben erhalten.

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
