# Custom dropdown review — #158

- Implementation: actual Claude Code CLI, `claude-sonnet-5-5`, high effort; result and measured usage in `158-claude-dropdowns.json`. The CLI did not execute tests; its code is not treated as accepted on that basis.
- Independent review: Codex `/root/dropdown_collaboration`, read-only core/Interop/widgets review (not its own collaboration migration). Root separately reviewed the role migration: defaults, event values and existing busy/invitation guards preserved.
- Findings and Codex disposition:
  1. P2: anchored list minimum height 120 px overflows a short viewport. Confirmed by Playwright at 360×240 (list bottom 264.98). Removed the floor; available space bounds the scrolling list. Regression now passes.
  2. Root runtime review: filtering an open editable list to no matches reset the filter and reopened every suggestion. Reproduced; preserve the typed filter while closing the empty list. Regression now passes.
  3. Root runtime review: disabling the active option in place left a disabled active descendant. Reproduced; deep option observation and enabled-only active id repair it. Regression now passes.
- Follow-up independent static review: no further actionable findings in those corrections or Escape/Tab/editable/disabled handling. Runtime evidence is recorded separately by root.
- Initial fixture-only TypeScript declarations were missing; reference the existing renderer declaration. Initial axe run sampled the entry fade; await the actual animation completion before measuring final contrast. No contrast rule disabled.
- Final validation: typecheck, 830 unit tests, 47 UI tests (including six focused component regressions), 7 Electron tests, 3 native P2P tests and build passed. One public-network test intentionally not enabled. Source hashes and commands in `158-local-validation.json`.
- Manual screen-reader and Windows/Linux UI execution not performed in this task; axe is not a full accessibility certification.
