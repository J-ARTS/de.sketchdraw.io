# Independent preliminary domain review for #210

Reviewer: Codex `/root/plugins_audit` with a separate read-only adversarial probe. Actual implementation author: Claude Code / `claude-fable-5-2`; its process was still running. This is not final approval of the full change.

Reviewed SHA-256: `src/domain/confluence-live.ts` = `745001554f17732e711d1d92159f29c9bcd095659b682cc8f3da477b2f1f317b`; `src/domain/plugins.ts` = `6045f3b7eb320262475bbc5a2cef27cd63295d6d9320116bf54aa3ad68254f74`.

## P1: cross-page attachment references treated as locally owned

The image ownership check at lines 115–123 only compares filenames. A matching `ri:attachment` containing `<ri:page ri:content-title="Foreign page" ri:space-key="OTHER" />` refers to a different page. The planner deletes this foreign image when absent from the desired local set, or returns `unchanged` when the desired local image uses the same filename. Neither outcome is valid. Container references must be resolved or conservatively treated as foreign, without satisfying local-image completeness.

Read-only reproduction: `domain-probe.json`. [Atlassian storage format](https://confluence.atlassian.com/doc/confluence-storage-format-790796544.html) documents the different containers.

## P2: XML character references break filename identity

The same raw comparison misses `sketchdraw&#45;12345678-abcdef12.png`, appending a duplicate, and treats `sketchdraw-12345678-&#97;bcdef12.png` as stale, moving its replacement to the end and losing the existing width. Both decode to `sketchdraw-12345678-abcdef12.png`. Decode safe XML references for identity comparisons, or return `unsafe` when uncertain. The original markup must remain byte-preserved when no update is needed.

Read-only reproduction and independent XML parser confirmation: `adversarial-domain-probes.json`.

## Other observations, not final blockers

- Foreign surrounding text, links and formatting survive ordinary middle-image insertions/removals.
- Comments and CDATA are not interpreted as images; 263 truncated inputs terminated.
- Reordering desired pages does not move existing images: current code intentionally preserves human placement. State that contract explicitly.
- Duplicate desired filenames produce duplicate insertions unless the caller validates uniqueness.
- Optional body hashes require full backend/store review to prove write protection.
- No Tenant writes, live visual refresh, all-page rendering, or context-isolation acceptance was performed by this review.

These findings must be sent to Fable for correction and independently rechecked on the final implementation.
