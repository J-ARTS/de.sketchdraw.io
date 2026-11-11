# Task160 — plugin marketplace and configuration

- Issue: https://github.com/J-ARTS/de.sketchdraw.io/issues/160
- Branch: codex/158-custom-dropdowns; base 3bd7ab9 includes previous #158/#159 work, preserved. #160 changes committed to local main in 7224888.
- Status: local acceptance complete, committed to local main in 7224888; remote publication and CI pending before closure.
- Contract: Git/Jira bundled installed but disabled; explicit existing uninstall retained. Configuration stays with the local document folder; unsaved/import/guest clears it; same folder reuses it. Public snapshots omit encrypted credentials.
- Actual tools: Claude Code CLI Fable5.2/high read-only sparring completed. Additional Fable UI attempt and resumed attempt (Sonnet requested, no new model output) interrupted without source edits. Actual UI and backend implementation by Codex under temporary authorization; no Claude UI implementation attributed.
- Ownership: root PluginSettings.vue/en.ts/native test/GitHub/ledger; plugin_configuration_audit backend/store/units; plugin_backend_review independent backend acceptance; theme_settings_review independent UI review and focushelper correction; plugin_ui_tests UI acceptance. All delegated scopes completed and reviewed.
- Concerns: PL-160-01 through PL-160-08 addressed locally. Unreadable/unknown configuration recovery remains planned #161.
- Evidence: docs/reviews/160-plugin-marketplace-review.md; 160-local-validation.json; 160-fable-sparring.md/json; native Proxy probe and theme screenshots.
- Tests: final report contains exact commands/results. No live Jira/Confluence/Git credentials or remote service exercised; no release/installer created.
- Next: publish local main, confirm remote CI, then close #160. #161 is independently scoped.

- Graphify: code refresh safely refused by known #145; traceability merge/check passed (2488 nodes, 3371 links). No force applied.

- Integration update: user requested all changes committed on main; local main contains 3bd7ab9 and 7224888. Source hashes match tested implementation. No push or remote CI performed in this commit task.
