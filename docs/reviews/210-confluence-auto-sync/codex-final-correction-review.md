# Independent recheck of CF-210-10 and CF-210-11

Reviewer: Codex `/root/live_correction_review`. Scope: repeat the existing synthetic backend and real-store/SVG reproductions, without product changes. Tested at 2026-11-15 22:40 UTC, Node v22.16.0. Fable process55371 was still active; this is acceptance of the recorded snapshot, subject to root comparing terminal hashes. The `final-` filename prefix separates these corrected-snapshot artifacts from the preserved earlier failing reproductions; it does not claim native/tenant/final issue acceptance.

## Source boundary

Hashes stayed identical before bundling, after both bundles and after all probes (`final-source.json`, `unchangedThroughProbes: true`). Relevant changed files:

- `electron/plugin-service.ts`: `8b509dd9b25839f682eb52af14413f91f50061ad851737cf16abee80afad3380`
- `src/renderer/state/whiteboard.ts`: `4dbba88658312bd9257fbc26a8dfa3da5fece3fe40776f21b47a4acc9f05b19a`

Main, preload, scheduler, renderer helper and SVG exporter hashes remain as in the previous review; full list is in `final-source.json`.

## Results

**CF10 corrected in the tested snapshot.** `runLivePublish` now permits `remember()` only after taking over the stored link state (`started`). A cancelled queued job leaves the on-disk owned attachment record intact. Both the deferred-response fake and the AbortSignal-aware fake confirm:

- active and queued obsolete jobs cancel;
- stored attachment id `att101`, version 1 and original digest remain;
- a subsequent foreign recognized Sketchdraw version20 is refused with status `failed`;
- zero upload follows that conflict, and the remote version remains20.

The new rule still allows the catch to remember data for a job that actually started. Existing uncertain-upload/restart probes pass too; this recheck did not add a separate compound pending-entry-plus-cancel test.

**CF11 corrected in both tested variants.** A valid local code replacement changing only a used custom SVG icon, or a used PNG's content while preserving its data-URL length118, now causes the second publication automatically. The real SVG hash changes. No manual sync is needed: initial count1 → automatic count2. The retained manual positive control then produces count3. The real WhiteboardStore, domain/code handling and SVG exporter were used; desktop bridge and rasterizer were mocked.

All eleven earlier positive backend probes still pass (CF03–08 and service-level CF09). The additional active-fetch abort probe passes. No new finding was produced by this limited recheck.

## Artifacts and commands

- `final-source.json`: bundle and post-probe source hashes.
- `final-results.json`: twelve service probes, all passed (eleven previous positives plus corrected CF10).
- `final-abort-results.json`: active abort and corrected CF10 with AbortSignal-aware fetch, both passed.
- `final-fingerprint-results.json`: both code-edit variants, automatic publication confirmed.
- `final-probe.mjs`, `final-abort-probe.mjs`, `final-fingerprint-probe.mjs`: same reproductions as earlier with corrected expectations and separate bundle/output names.
- `final-service.mjs`, `final-store.cjs`: freshly bundled tested snapshots.

Executed: `node /tmp/sketchdraw-210-correction-review/final-probe.mjs`; `node /tmp/sketchdraw-210-correction-review/final-abort-probe.mjs`; `NODE_PATH=/Users/jeremyteichmann/Desktop/sketchdraw/de.sketchdraw.io/node_modules node /tmp/sketchdraw-210-correction-review/final-fingerprint-probe.mjs`.

No repository source, test, ledger or GitHub changes; no real credentials, Tenant, user UI or native test used. Prior artifacts remain unchanged. Actual Electron window events, Confluence LiveDoc visible refresh and Git end-to-end acceptance remain outside this synthetic recheck.
