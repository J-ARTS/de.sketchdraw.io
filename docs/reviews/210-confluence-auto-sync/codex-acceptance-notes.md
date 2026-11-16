# Independent acceptance findings for #210

Read-only Codex research and source audit. Not implementation or live evidence.

- Native Live Docs share Pages v2, status current / N+1 is generally supported. Content can change without version increment. Version-only CAS is not sufficient.
- Attachment data update is POST /wiki/rest/api/content/{pageId}/child/attachment/{attachmentId}/data, multipart, X-Atlassian-Token:nocheck. Prefer persisted ID, no full body write for ordinary refreshes. Endpoint has no expected-version CAS, so detect foreign versions and pause; do not promise atomic multi-writer safety.
- Successful attachment version upload does not guarantee an already-open Live Doc renders new bytes without reload. Prove visually; do not substitute an HTTP-success assertion.
- Context identity must include normalized site, page ID, attachment ID, local file/document and profile authority. Existing configureAtlassian does not increment projectGeneration for site/token change in same profile; activateDocument only distinguishes project folder. Test same-folder document switch and same-profile tenant edit during delayed work.
- Only one upload per binding in flight. Coalesce later edits to latest snapshot; old completion cannot mark newest document synced. Reconcile an uncertain result before duplicate upload.
- prepareSvgExport defaults to first page and embedded native metadata. Publish all intended diagram pages explicitly and disable hidden native metadata for visual uploads to avoid publishing invisible source pages/notes.
- acceptExternalDocument resets authority revision to 0. Detect actual document content/generation, not only numeric monotonic revision.
- Test Git remote push -> app auto pull -> accepted external document -> actual rendered Confluence diagram change. Preserve unsaved local work and visible conflicts.
- Test persistence after reload/restart, profile/doc transitions, guest/nonlocal/disabled, offline/recovery, remote foreign text/table/macro/link preservation, and no feedback loops from Confluence annotations/metadata.

Sources: official Atlassian Pages v2 and v1 Content Attachments docs; https://community.developer.atlassian.com/t/please-test-update-your-confluence-cloud-apps-to-function-in-live-docs-by-may-30-2025/89849 . Full reviewer handoff follows.
