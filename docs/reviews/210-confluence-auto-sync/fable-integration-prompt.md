Implement the narrowly scoped UI integration for GitHub issue J-ARTS/de.sketchdraw.io#210, using the current worktree ONLY:
/Users/jeremyteichmann/.codex/worktrees/210-confluence-integration/de.sketchdraw.io

You are the actual Claude Code/Fable 5.2 implementer. No simulated review. This worktree is based on c572671 (main after #211 Design System); Root has already applied the unchanged, independently reviewed #210 backend/domain/store changes and new tests. Do not change those product sources, network behavior or acceptance requirements.

Read this worktree's AGENTS.md, CLAUDE.md, docs/design-system/README.md and relevant entries in docs/design-system/manifest.md first. The older working copy /Users/jeremyteichmann/Desktop/sketchdraw/de.sketchdraw.io is READ ONLY and has another native-test writer; do not change anything there. No live app, real profile, Tenant or credentials. No Git commit/push/merge, GitHub changes, ledger/graph writes or background processes.

Source of truth for the TWO existing UI deltas is /tmp/sketchdraw-210-integration-reference/:
- base-App.vue, local-App.vue, App.vue.patch
- base-PluginSettings.vue, local-PluginSettings.vue, PluginSettings.vue.patch
- manifest.json describes what Root already copied.
Apply only their #210 changes to current files, preserving upstream:
1. App.vue stays the tiny current wrapper. Put the modal keyboard guard in src/renderer/design-system/pages/WorkspacePage.vue. Preserve its template/layout/imports.
2. Put PluginSettings UI changes into src/renderer/design-system/organisms/PluginSettings.vue, retaining current alias imports, AppButton and adding intlLocale as needed. Preserve focus restoration and all live-link status/actions/accessibility from local diff.
3. New or touched text buttons/input/labels must use existing atoms (AppButton/AppTextField/AppFieldLabel etc.), no increasing raw-element legacy allowance. AppButton refs are component instances, so retain native focus contract correctly. Review latest APIs before using them. Do not weaken design-system tests or widen baselines.
4. Add/update appropriate PluginSettings story for live linked/unlinked/error states with synthetic data only; update WorkspacePage story if meaningful. Generate manifest with npm run design-system:manifest. No new parallel UI abstractions.
5. i18n was cleanly patched by Root; preserve both #210 strings and main's four isometric additions.

Required bounded checks: npm run typecheck; npm run test:unit (includes design-system test); npm run build:storybook; targeted UI confluence-live.spec.ts plus existing plugins and modal/keyboard regression tests relevant to the two changed components. Inspect package/config before commands. Do not run test:electron; Root owns it. If a non-UI test fails from copied changes, report precise failure before changing unrelated source. No need repeatedly run passed whole suites without new edits.

Review own UI integration critically; prove behavior and source-contract preservation, identify residual limitations. Write final report to /tmp/sketchdraw-210-fable-integration.md, giving changed files, actual commands/results, limitations and any concerns. Do not claim real Confluence acceptance: no Tenant writes have happened, and Root must still demonstrate an already-open LiveDoc updating without reload.
