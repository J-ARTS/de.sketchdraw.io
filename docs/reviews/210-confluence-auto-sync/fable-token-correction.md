# #210: Token-Korrektur UI-210-INTEGRATION-01 (P2)

- Ticket: J-ARTS/de.sketchdraw.io#210
- Worktree: `/Users/jeremyteichmann/.codex/worktrees/210-confluence-integration/de.sketchdraw.io`
- Werkzeug / Modell: Claude Code, Claude Fable 5.2 (`claude-fable-5-2`), tatsächliche Umsetzung
- Zeitpunkt: 16.11.2026, ca. 00:10–00:20 Ortszeit des Rechners
- Zeit, Tokens, Kosten: nicht gemessen, unbekannt
- Kein Commit, Push, GitHub-, Ledger-, Graph- oder Memory-Schreibvorgang, kein `test:electron`, kein App- oder Tenant-Zugriff, Desktop-Checkout nicht berührt

## Ergebnis

Der neue Live-/Fokus-CSS-Block in `PluginSettings.vue` verwendet für Abstände, Größen, Radius und Schriftgrößen jetzt ausschließlich vorhandene Tokens. `tokens.css` blieb unverändert: Es war kein neues Token nötig.

## Geänderte Dateien

| Datei | Änderung |
| --- | --- |
| `src/renderer/design-system/organisms/PluginSettings.vue` | Nur der #210-CSS-Block (jetzt Zeilen 361–362: eine Kommentarzeile, eine Regelzeile). Skript, Template, Atoms, Legacy-Styles unverändert. |
| `src/renderer/styles/tokens.css` | unverändert (`git diff --stat` zeigt keinen Diff) |

Alle anderen Quellen blieben unberührt. Außerhalb des Repos habe ich in meiner eigenen `/tmp/sketchdraw-210-fable-pw/playwright.config.mts` das `outputDir` von `<Worktree>/test-results` auf `/tmp/sketchdraw-210-fable-pw/results-ui` umgestellt, damit mein Lauf den Ordner im Worktree nicht mehr anfasst.

## Umstellung im Einzelnen

| Regel | vorher | jetzt |
| --- | --- | --- |
| `.plugin-shell:focus` | `outline:0` | `outline:none` |
| `.integration-section h3:focus-visible` | `outline:2px solid var(--accent); outline-offset:4px` | nur `outline-offset:var(--space-1)`; der Ring selbst ist der gemeinsame aus `base.css` (`2px solid var(--focus-ring)`) |
| `.live-copy` | `margin:0 0 12px; font-size:12px; line-height:1.5` | `margin:0 0 var(--space-3); font-size:var(--font-size-s)` |
| `.live-card` | `gap:8px; padding:14px; border-radius:12px` | `gap:var(--space-2); padding:var(--space-3); border-radius:var(--radius-2)` |
| `.live-target` | `gap:2px` | kein `gap` |
| `.live-target strong` | `font-size:14px` | `font-size:var(--font-size-l)` |
| `.live-target span, .live-synced` | `font-size:11px` | `font-size:var(--font-size-s)` |
| `.live-label` | `font-weight:750; letter-spacing:.06em; text-transform:uppercase` | nur `text-transform:uppercase` |
| `.live-status` | `gap:8px; font-size:12px; line-height:1.45` | `gap:var(--space-2); font-size:var(--font-size-s)` |
| `.live-dot` | `width:8px; height:8px; margin-top:5px` | `width/height:var(--space-2); margin-top:calc((1lh - var(--space-2)) / 2)` |
| `.live-actions` | `margin-top:4px` | `margin-top:var(--space-1)` |
| `.live-note` | `gap:8px; margin:12px 0 0; font-size:11px; line-height:1.5` | `gap:var(--space-2); margin:var(--space-3) 0 0; font-size:var(--font-size-s)` |
| `.live-note svg` | `width:16px; height:16px; margin-top:1px` | `width:1lh; height:1lh` |

Verwendete Tokens: `--space-1`, `--space-2`, `--space-3`, `--radius-2`, `--font-size-s`, `--font-size-l`; Farben wie zuvor aus `--accent`, `--border-subtle`, `--surface-raised`, `--text-muted`, `--status-ok`, `--status-error`. Zeilenhöhe erbt den gemeinsamen Wert aus `base.css` (1.4).

Sichtbare Folgen, bewusst klein gehalten:

- Karte: Innenabstand 12 statt 14 px, Radius 14 statt 12 px.
- Titel der Zielseite 15 statt 14 px; Nebentexte 12 statt 11 px.
- „Verknüpft mit" bleibt in Großbuchstaben, ohne Sperrung und Sonderschriftstärke.
- Statuspunkt und Info-Symbol richten sich an der ersten Textzeile aus (`1lh`) statt an festen Pixelwerten.

## Statische Prüfung des neuen Blocks

Zeile 362 gelesen. Verbliebene Literale:

- `border:1px solid …` an `.live-card`: Haarlinie wie in den gemeinsamen Klassen von `base.css` (`.sd-panel`, `.sd-btn`); ein Token für Randstärken gibt es nicht.
- `28%` und `5%` in `color-mix(...)`: Mischverhältnisse zweier Farb-Tokens; laut Review dürfen die Farben so bleiben.
- `border-radius:50%` am Statuspunkt: Kreisform, kein Radius der Skala.
- `0`, `auto`, `1lh`: Null, Schlüsselwort, relative Einheit.

Keine festen px-Werte mehr für Abstände, Größen, Radien oder Schrift; keine `font-weight`-, `letter-spacing`- oder `line-height`-Literale. Die automatisierte Zählung per `grep -oE` wurde vom Berechtigungsmodus abgelehnt; die Prüfung erfolgte durch Lesen der Zeile.

## Prüfungen (Stand nach der Korrektur)

| Prüfung | Befehl | Ergebnis |
| --- | --- | --- |
| Design-System-Spezifikation | `npx vitest run --config vitest.config.ts tests/unit/renderer/design-system.spec.ts` | bestanden: 14 von 14 |
| Storybook | `npm run build:storybook` | bestanden |
| Vier Stories hell und dunkel inkl. axe, dazu Fokus | `npm run test:ui -- --config /tmp/sketchdraw-210-fable-pw/stories.config.mts` | bestanden: 9 von 9 |
| Confluence-UI im echten Renderer, eigener Server auf Port 5183 | `npm run test:ui -- --config /tmp/sketchdraw-210-fable-pw/playwright.config.mts tests/ui/confluence-live.spec.ts` | bestanden: 1 von 1 |

Die Screenshots `linked-light.png` und `error-dark.png` unter `/tmp/sketchdraw-210-fable-pw/shots/` habe ich nach dem Lauf angesehen: Karte, Statuspunkt, Info-Symbol und Schaltflächen sitzen in beiden Themes richtig.

Nicht ausgeführt, wie vereinbart: die volle Unit-Suite (1255), die früheren 85 UI-Tests, `npm run typecheck` (nur CSS geändert), `test:electron`, `graphify-update`.

## Frühere Ergebnisse (unverändert gültig für den damaligen Stand)

Siehe `/tmp/sketchdraw-210-fable-integration.md`: Typecheck, 1255 Unit-Tests, 29 + 56 UI-Tests auf Port 5183 und 9 Story-Prüfungen bestanden vor dieser CSS-Korrektur. Der damals ungültige erste UI-Lauf gegen den fremden Server auf Port 5173 (27 bestanden, 2 fehlgeschlagen) bleibt dort dokumentiert.

## Grenzen

- **`lh`-Einheit:** Statuspunkt und Info-Symbol nutzen `1lh`. Chromium ab 109 (also auch Electron 44), Firefox ab 120 und Safari ab 16.4 kennen sie. Ein älterer Browser verwirft die Deklaration; dann sitzt der Punkt am oberen Zeilenrand und das Symbol hat seine Eigengröße.
- **Kein Pixelvergleich:** Die Optik ist per Screenshot von zwei der acht Story-Zustände begutachtet, nicht automatisiert verglichen.
- **Früherer Zugriff auf `test-results`:** Meine UI-Läufe vor diesem Auftrag schrieben in `<Worktree>/test-results`, und Playwright leert diesen Ordner beim Start. Falls dort fremde Artefakte lagen, sind sie durch diese früheren Läufe überschrieben worden. In diesem Auftrag wurde der Ordner nicht mehr angefasst.
- **Keine Tenant-Abnahme:** Es gab keinen Confluence-Zugriff. Der echte LiveDoc-Lese-/Schreibtest und die nativen Tests bleiben bei Root.
- **Graphify:** nicht ausgeführt (Vorgabe; die CLI ist in dieser Sitzung ohnehin gesperrt).
