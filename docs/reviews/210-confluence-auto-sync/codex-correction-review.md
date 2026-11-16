# Independent correction review #210

Reviewer: Codex `/root/live_correction_review`, with a read-only scheduler review by Codex `/root/live_correction_review/scheduler_read`. This is not a Claude/Fable review. All source files were read only. Reproduction scripts, bundles and synthetic profiles were created only under `/tmp/sketchdraw-210-correction-review/`. No Tenant, credentials, real app UI, GitHub, repository build outputs or source files were changed.

Environment: Node v22.16.0. Review performed 2026-11-15 around 22:19–22:23 UTC against baseline `96c0039431dcee973ff94f80ce1e4a707d07abcb` plus uncommitted changes. Fable's correction process was still running. These findings concern exact snapshots; root must recheck hashes at terminal completion. Known deliberate mutation tests were not treated as final defects.


## Source snapshots

| File | SHA-256 |
| --- | --- |
| electron/plugin-service.ts | c539133102c2bb45e1518414606fa28123e000a54adf429ab877b0f6914b226a |
| electron/main.ts | dcce42fad5ec3764edc15ce1f95f22460d02cde32385d8b692ae2a464fc1ba0b |
| electron/preload.ts | e87a75fc5981373f46aeeb171eb55a56857d0c77f0e4ec16ef49462bf54a6018 |
| src/renderer/state/whiteboard.ts | 7674802e0439fbc6b4c1d6afcc2adffbe5973c65d694413d7f11e70ee51d84cd |
| src/renderer/state/confluence-live-sync.ts | 92f350fd0e7240544521bae6b9d3a18ed184deb05d3abcfb6263b79da83b8766 |
| src/renderer/lib/confluence-live-image.ts | 47e08ef4df287e23ba9196bb47447e99b9de932bf71d13dba07c5c65a2c2b867 |
| src/interop/export.ts | cf939fe572f13adbe02fc05459a6b901ad29dfc4902b75321365b628be0b193e |

Backend hashes were identical before and after bundling and at the last source check. Backend results are in `results.json`, scripts in `probe.mjs`/`service.mjs`, source metadata in `source.json`. Store results are in `fingerprint-results.json`, scripts in `fingerprint-probe.mjs`/`store-entry.ts`/`store.cjs`.

## New confirmed findings

### CF-210-10 — P1: cancelling a queued job deletes the stored attachment ownership and uncertain-upload state

`electron/plugin-service.ts:1193–1208,1296–1298` initializes `published` and `pending` to empty objects, then checks the queued job's authority before loading the existing link state. When that first check rejects an obsolete queued job, the unconditional `remember()` in the catch persists the empty objects into the still-existing link. Cancelling a job which never started must not erase the history of earlier successful or uncertain writes.

Reproduction used the real PluginService and a temporary on-disk profile, synthetic HTTP responses only:

1. Publish a known attachment successfully, establishing id `att101`, version 1 and digest.
2. Hold the GET of a second publication; queue a third publication behind it.
3. Save the same Atlassian settings, invalidating both jobs irreversibly, then release the GET.
4. Both jobs correctly return `cancelled`; however the profile on disk now has no `published` map.
5. Simulate version 20 published by another Sketchdraw writer (a recognized Sketchdraw digest different from our new content).
6. A subsequent publication returns `synced` and POSTs `/child/attachment/att101/data`, replacing that other writer's version with 21. With the retained version-1 ownership record this would be a conflict.

A queued obsolete job also arises around rapid renderer reloads while an older request is outstanding. The direct service probe intentionally creates the scheduling deterministically; no native reload claim is made.

Required correction: do not persist an uninitialized job state. Keep existing `published` and `pending` intact when authority fails before state initialization. Preserve the useful catch persistence for jobs that actually performed uploads. Avoid an unconditional early return that loses a real pending upload after a later authority change.

Minimal regression: seed an owned attachment and pending entry in a persisted profile; hold active publication, queue another, invalidate authority, release. Assert both cancelled, zero later network mutation, and both maps unchanged on disk/restart. Then introduce a foreign recognized Sketchdraw version and assert the next attempt conflicts without POST. The current reproduction specifically confirms the ownership deletion and resulting overwrite; preservation of pending should be covered by the implementation regression too.

### CF-210-11 — P2: valid icon-only or equal-length asset edits never trigger automatic publication

`src/renderer/state/whiteboard.ts:170` excludes `document.componentSets` and reduces assets to id, MIME type and data-URL length. The `sync()` fingerprint comparison at lines 474–476 thus misses visible changes. `applyCode()` performs a document replacement under the same authority (809–817), so it does not get the new-context publication that opening or installing a Git version can trigger.

Two runtime probes used the real WhiteboardStore, code parser/domain validation and real SVG exporter. Desktop bridge and rasterizer were synthetic; no browser/native/Tenant acceptance is claimed:

- Change only a used custom component's valid SVG icon from red to blue.
- Change only a used valid 1×1 PNG from red to blue, both data URLs length 118.

Both return `applyCode() === true`, no diagnostics, and produce different SVG hashes. After 200 ms with a configured 10 ms debounce, publication count remains 1 and status still says synced. Manual sync then produces publication 2 with the changed content. This establishes missing automatic publication, not a raster or server failure.

Required correction: fingerprint all document data that can change the visible export, including component-set icon definitions and actual asset content (or reliable content identity). Retain the existing behavior that nonvisual task/comment-only changes do not needlessly publish.

Minimal regression: for both variants above, begin with a linked, synced local document; apply a valid code replacement changing only that data; assert a second automatic publication and changed image hash without `syncConfluenceLive()`. Keep task-only no-publication regression. Git-specific failure is not claimed: its install/off/on path may already trigger publication independently.

## Independently confirmed corrections

Eleven targeted backend Mock probes passed against the source hash above:

- CF03: legacy Send held at GET A, then configure tenant B: rejection and exactly the one GET A, no PUT anywhere.
- CF04: missing expectedBodyHash rejects before any request.
- CF05: foreign name collision without digest is blocked; known update uses attachment-id POST; changed foreign version is blocked without upload.
- CF06: Retry-After 3600 prevents repeated manual publishes and same-site settings save from starting another HTTP request; at 3599999 ms no request, at 3600000 ms a request resumes.
- CF07: committed upload with lost answer and missing digest remains a visible failure after service restart using a persisted profile, exactly one upload/version; matching digest is the positive control, reconciled with one upload and no repeat.
- CF08: same-folder A→B→A and disable→enable permanently cancel deferred jobs, zero remote writes.
- CF09 service boundary: releaseRenderer() followed by reopen cancels active and queued obsolete jobs, no remote writes. Main source wires navigation, render-process-gone and closed to this release method. Actual Electron lifecycle dispatch remains for the separate native fixture; it was not executed here.

The new CF10 probe completed and explicitly records `passed: false, failureConfirmed: true`; it is not an acceptance pass.

Scheduler source review found no remaining Retry-After bypass through edits, sync-now, network recovery or dirty follow-up; context A→B→A and dispose advance the epoch irreversibly. Backend site cooldown remains authoritative when a renderer context resets. Browser Live Doc automatic visual refresh, actual tenant attachment behavior and Git end-to-end acceptance remain root responsibilities and are not inferred from these mocks.

## Repeat after active-request cancellation was added (22:24 UTC)

The PluginService was freshly bundled again after Fable added AbortController revocation and AbortSignal.any. The new service SHA-256 was `f35b01385dcb4dba3cc2fc5c7bee95a1ec91cac6db2fdca5bc2aa685ea04ef51`; it stayed identical before/after bundling. Main, preload, domain and scheduler hashes in `source.json` stayed as previously documented. The initial bundle/source/results are preserved as `initial-service.mjs`, `initial-source.json`, `initial-results.json`; `service.mjs`, `source.json` and `results.json` now refer to the new snapshot.

All eleven existing correction probes passed again. CF10 still reproduces with the new snapshot. The old deferred fake deliberately waits for an explicit release and does not react to AbortSignal; these cases still prove the post-await authority guards, but alone would not prove active cancellation.

Therefore two additional independent probes in `abort-probe.mjs`/`abort-results.json` explicitly observe the passed AbortSignal:

- `releaseRenderer()` aborts a pending fetch without releasing its gate, the job promptly settles `cancelled`, and no remote mutation follows: **passed**.
- A known version-1 link, held active fetch and queued publish, then same-site configuration save: the active fetch is actually aborted, both jobs settle `cancelled`, but on-disk `published` is still removed. A subsequent foreign recognized Sketchdraw version 20 is overwritten with 21: **CF10 reconfirmed**, even with an abort-aware fake.

CF10 line numbers shifted to initialization/assert at 1207–1222 and unconditional remember at 1310–1312. Its cause and required correction are unchanged. CF11's store hash and runtime evidence are unchanged. Fable process15314 was still in final tests when this repeat was made; root must verify final hashes.
