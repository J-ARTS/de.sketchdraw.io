# Codex MCP-Integration: geprüfter Teilstand

17.10.2026, macOS arm64, Node22.16.0, Electron44.9.0, Playwright1.64.1, MCP SDK2.3.1. Lokaler Arbeitsbaum ohne integrierten Commit. Issue #13, Gesamtprüfung #15.

Regulärer Owner Antigravity. Echte Gemini- und später Opus5.5High-Läufe erreichten Kontingentgrenzen; Typen/Fehler/Fingerprint-Teillieferungen erhalten. RootCodex implementierte mit ausdrücklicher vorübergehender Nutzerfreigabe Host/SDK/Authority-Integration, Main/Preload und Sessionmanager. Codex-Frontendagent ergänzte das Panel; interne Arbeit wird nicht als Claude-/Antigravity-Lauf ausgegeben.

## Bestätigte Prüfungen

- `npx vitest run tests/unit/mcp`:14/14 Fälle bestanden (16:20Europe/Berlin). Reale lokale Socketverbindungen, SDKstdio, Authentifizierung, Schreibrechte, gleiche Authority, Revisionsprüfung, Deduplizierung, Timeoutretry, Widerruf, gleicheDokumentID/neueSession, Größenlimit, falscherServer, abgeschlosseneAuthorityCleanup, detachedPayload und revoke-before-install.
- `npx tsc -p tsconfig.mcp.json --noEmit` und Electron-Typecheck:bestanden vor letzter UI-Testergänzung; Gesamtcheck läuft separat.
- `npx playwright test --project=electron tests/electron/backend-shell.spec.ts`:3/3 bestanden nach Main/Preload-Anbindung,23s. Reales Electron mit minimaler Fixture, kein vollständiger Produktnachweis.
- `npm run build`:Renderer,Main/Preload und SDKadapter erfolgreich gebaut.
- `npx playwright test --project=electron tests/electron/agent-product.spec.ts --output=/tmp/sketchdraw-agent-product-results`:1/1 bestanden,3,9s. Unveränderte Produktbundles aus eigenem Tempverzeichnis mit Leerzeichen, echte UI-Granterteilung, echter SDKclient startet Electron als Node, sichtbare Elementmutation, anschließende menschliche Titeländerung, Agentenänderung während ungültigem Codeentwurf, Readonly-Ablehnung, Widerruf und Dokumentwechsel. Kein Testersatz für Host/Preload/Renderer. Temporäre Capabilities werden nicht in Traces/Screenshots/Anhänge geschrieben.

Erster Produktlauf endete am60s-Test-/30s-Teardownlimit, ohne eindeutige Phase. Der diagnostische Folgelauf bestätigte alle Produktphasen; begrenzte Cleanup-Aufrufe verhindern, dass das Beenden des Testprozesses den Test endlos hält. Danach bestanden. Debugausgaben wurden wieder entfernt.

## Noch offen

Unabhängiger Codereview, positive Windows-Loopback- und Linux-Plattformabnahme, tatsächlich gepackter ASAR-/Installerstart, endgültige Gesamt-App-Integration mit Interop/P2P. Aktuelle Agentenfreigaben beziehen sich auf die lokale Ownerauthority; GuestMCP ist gemäß Vertrag gesperrt. Keine Behauptung fertiger Plattformreleases.

## Dateifingerprints dieses Übergabestands

- `electron/agent-access/auth.ts`: `b1ae37c65a3efc0bf69f756da4d0d0a708d308df899b0143e91e0d32079cb00f`
- `electron/agent-access/electron-bridge.ts`: `d53e32e403761c230fdd196e065f6ced7b1ec9c1d6fce33cf16f5a3e401cc8dd`
- `electron/agent-access/frames.ts`: `1810020afae84759f3e215ebc046e7d9e6ca250fe049b4de5c1c6265f8b82863`
- `electron/agent-access/host.ts`: `7be1d35e5f27f261a2f6ab45ca9c5c33600bb65d26373effef706f92b3c5f343`
- `electron/agent-access/ipc.ts`: `407ce9fef0252a5937ce71c2abf389aad758fd4e5d848425dfe9acf8e79bb875`
- `electron/agent-access/preload.ts`: `502686bfc633f6788984f125a145151bca44ca957d80fe25fb6c090adff481dd`
- `electron/main.ts`: `1c906fdfb6fe97661234c9ce68e2b754ba48f01cfb02365ee73016501a6ff951`
- `electron/preload.ts`: `e2cf4b1226512b26dc5f5edde1e983b619ab47f4a886ad48d279e541454ddd5e`
- `src/agent-access/errors.ts`: `abfdef78857fecf10a6248bce37f4c76a584439f20483c7b67e9305aceeb5161`
- `src/agent-access/fingerprint.ts`: `52824260c12bf67b11f8af12e68516d8cfad9de033c5b326d51af23f792faded`
- `src/agent-access/renderer-handler.ts`: `9528a24cdab3ef5ffd1cc9d358f892bba2fa072dec485c82c19fa52e46c3f836`
- `src/agent-access/renderer-session.ts`: `1192ee432c64eedaeb4b516552542d054f24b97ad3d4d61fd5f66e1d33678882`
- `src/agent-access/schema.ts`: `dad1a1faa738cf227749d811511c42f1ef14e01da89b190d96d5e8996ff17df2`
- `src/agent-access/types.ts`: `f43fcb5c9fc6f5e6baf606c1be3d5d0fb850d74a636d4e1ac9f2566dae9e8410`
- `src/mcp/client.ts`: `cf73f49324329253e7203e4772f7186a9a7f3bb85fe2456414373b3891ba4422`
- `src/mcp/server.ts`: `d2af97ac3b8a95e854d3819df4b9830e33e55046fb1fdb161dc9fd7da5a08d00`
- `tests/electron/agent-product.spec.ts`: `44df18278951a0db369a46ccd3ee960696b7b5a553d44cdb2d3e02c1f335c7da`
- `tests/unit/mcp/backend.spec.ts`: `46f898e6ca5c6088ea15a1e7d7ea2a712a03dbed1d00be740833771e04b3b443`
- `tests/unit/mcp/renderer-session.spec.ts`: `d28eb85577a0389d89a6034c166a45fb662c646468547fd0619058b9eb1f682a`
