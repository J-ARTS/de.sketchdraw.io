# Task158 — custom dropdowns

- Issue: https://github.com/J-ARTS/de.sketchdraw.io/issues/158
- Branch: codex/158-custom-dropdowns; base fe63bb3.
- Scope: reuse AppSelect for every native select/datalist, retain existing custom action menus. Document exact AppSelect/AppDialog/specialized dialog locations and rules in AGENTS/CLAUDE.
- Contract: string values, labelled/optionally disabled options; placeholder/compact/editable/maxlength/id; update:modelValue. Caller converts domain types.
- Ownership: actual Claude CLI core AppSelect/anchoring/TaskBoard; Codex agents disjoint Interop/widgets and collaboration migrations. Root docs, focused component harness, testing, independent review, ledger/graph.
- Skills: design-accessibility-review, dual-agent-architecture-review, existing evo-agent-state-management workflow. APG reference: https://www.w3.org/WAI/ARIA/apg/patterns/combobox/.
- Status: committed to local main in 3bd7ab9; remote publication and CI pending. Issue remains review.
- Validation: 830 unit, 47 UI, 7 Electron, 3 native P2P passed; typecheck and final build passed. Public-broker network case intentionally not enabled. No Windows/Linux UI or manual screen-reader claim.
- Actual Claude run: f2c30253-0bd4-48a7-9306-39d012be8bb6, Sonnet 5.5/high, completed; metrics in docs/reviews/158-claude-dropdowns.json. Root corrected three reproduced edge cases after independent review.
- Evidence: docs/reviews/158-local-validation.json (source hashes/commands), 158-dropdown-review.md, 158-dropdowns screenshots.
- Graphify: existing #145 safety refusal (5953 candidate / 6093 existing), retained prior graph; traceability refresh/check done separately.
- Next: integrate reviewed changes into main when included in the next integration request; verify remote CI, then close #158. No pending product correction from this scoped review.

- Integration update: user requested all changes committed on main; local main contains 3bd7ab9 and 7224888. Source hashes match tested implementation. No push or remote CI performed in this commit task.
