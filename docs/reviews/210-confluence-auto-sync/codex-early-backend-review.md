# Independent preliminary backend review for #210

Codex `/root/plugins_audit` reviewed Fable's still-running implementation at baseline `96c0039431dcee973ff94f80ce1e4a707d07abcb` plus local changes. `electron/plugin-service.ts` SHA-256: `4735bc34dc328c9c59d162852734087fd7e79b728b1c7c64186de05df28313fd`. Node v22.16.0. All runtime probes used the real PluginService with synthetic Mock responses only; no Tenant or UI operations. This is not final approval.

| Priority | Reproduced finding | Required correction and regression |
| --- | --- | --- |
| P1 | Legacy whole-body Send reads site A, then PUTs site B after configureAtlassian switches the site during its GET. A correct expectedBodyHash for A does not prevent this. Lines 901–910. | Snapshot and irrevocably guard the operation's context before each request. Deferred GET A → change site → release must issue no PUT. |
| P1 | Live upload replaces a foreign same-name attachment v9 with v10. After a known publication, a foreign v20 is also replaced with v21. No attachment ID is retained. Lines 1001–1043. | Unknown name collisions and foreign versions are conflicts. Persist and validate attachment ID and known version/ownership; update the known ID. Do not promise atomic CAS where Confluence offers none. |
| P2 | Missing expectedBodyHash bypasses protection against content changed within the same Live Doc version. Lines 905 and renderer whiteboard 2137. | Legacy annotations without a trusted baseline must reload before Send; no PUT. |
| P2 | A 429 with Retry-After: 3600 permits another publish GET after 0 ms; the request wrapper discards the header. Line 760. | Carry and enforce the server deadline in backend and scheduler, including edits/manual retry; controlled-clock regression. |
| P2 | A committed upload whose response is lost is uploaded again when subsequent attachment metadata has no digest; v1 becomes v2. Lines 1040 onward. | Persist uncertain operation state and reconcile the actual content or pause explicitly. A missing digest is not proof the write failed. |
| P2 | Deactivate then reactivate while a GET is blocked revives the old job, which uploads and returns synced. Direct same-folder A→B→A has the same result. Lines 720, 947. | Irrevocable context epoch invalidated on every relevant authority change, not equality of final values only. Zero uploads after release. |

One source-only P2 remains to be runtime-tested: navigation, renderer crash and window close only dispose DirectService in `electron/main.ts:514`; PluginService is disposed at before-quit (623), while macOS can retain the process without a window. Invalidate queued/in-flight publication authority at those renderer boundaries, without breaking normal app reopen. Deferred GET → close/crash/navigation → release must cause no subsequent remote mutation. Main SHA: `d940a6712a071e90a526f1f4f2c6bc83599d205bcfcf5f2a904b557b2d57d664`.

Positive controls: an uncertain upload with a visible matching digest reconciles with exactly one upload; normal lasting site/profile changes are guarded in Live Publish. The cross-site failure above specifically affects legacy Send. Existing IPC sender checks and basic handle/image validation are present.

All nine Mock cases, including positive control: `backend-review-probes.json`. Original harness was `/tmp/sketchdraw-210-backend-review/probe.mjs`. No Vitest, Electron or live acceptance is claimed by this review.
