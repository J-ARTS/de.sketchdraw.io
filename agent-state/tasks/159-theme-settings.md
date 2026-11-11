# Task159 — theme settings only

- Issue: https://github.com/J-ARTS/de.sketchdraw.io/issues/159
- Branch/worktree: codex/158-custom-dropdowns, existing uncommitted #158 changes preserved.
- Product: theme icon and compact-menu toggle removed; Settings > Design remains the only theme UI.
- Ownership: actual Claude CLI Sonnet 5.5/high only MainMenu.vue; root updates existing test interactions and validates; independent Codex theme_settings_review read-only.
- Result: typecheck and 12 existing UI/layout cases passed, including theme persistence after page reload and header geometry 320–1600 px.
- Evidence: docs/reviews/159-theme-settings-validation.json; no new tests or dependencies.
- Graphify #145 retains previous codegraph; traceability refreshed separately.
- Status: committed to local main in 3bd7ab9; remote publication and CI pending before closing #159.

- Integration update: user requested all changes committed on main; local main contains 3bd7ab9 and 7224888. Source hashes match tested implementation. No push or remote CI performed in this commit task.
