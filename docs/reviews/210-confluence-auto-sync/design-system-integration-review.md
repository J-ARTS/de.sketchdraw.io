# #210: PluginSettings integration into the design system

Read-only review. Target `origin/main` = `c572671f1ba17adf957fe4eff1e53457a4c20fc6`.
Local `src/renderer/components/PluginSettings.vue` SHA256 = `57ab3b895f9b799378a026fd1ecd7f10e91c39135c37aa55bb0520a206fcb034`.
No source, Git, graph, UI or tenant mutations; no tests or builds executed.

## Required transfer

Transfer the #210 logic/template changes into `src/renderer/design-system/organisms/PluginSettings.vue`. Do not retain or recreate `src/renderer/components/PluginSettings.vue`: the structure test permits only App.vue outside the design system.
Preserve target's first-line @component declaration, AppButton import, and already migrated Installieren/Konfigurieren buttons. Expand the description to name its actual modal plugin-settings role and automatic Confluence diagram publishing. Describe open and close with JSDoc while updating its contract documentation; do not invent new props solely for stories.

Exact imports:

```ts
import AppButton from '@/renderer/design-system/atoms/AppButton.vue'; // already in target
import AppTextField from '@/renderer/design-system/atoms/AppTextField.vue'; // add
import AppIcon from '@/renderer/design-system/atoms/AppIcon.vue'; // preserve target path
import { useWhiteboard } from '@/renderer/design-system/composables/use-whiteboard'; // preserve target path
import { intlLocale, t, tm } from '@/renderer/i18n'; // local #210 addition
```

Import components from their files, not the design-system index (product-code guard).

## Required markup conversions in the changed Confluence block

| Action/control | Required component |
| --- | --- |
| Jetzt synchronisieren | AppButton intent="primary", retain data-testid, disabled expression and click |
| In Confluence öffnen | AppButton, retain click and visible arrow/text |
| Verknüpfung lösen | AppButton intent="danger", retain disabled and click |
| Confluence search field | AppTextField v-model="confluenceQuery" type="search", retain data-testid, placeholder and aria-label |
| Suchen | AppButton **type="submit"**, retain disabled expression |
| Live verknüpfen | AppButton, retain disabled, aria-label and click |
| Einbinden (edited result row) | AppButton, retain aria-label and click |

AppButton defaults to type="button"; omitting type="submit" on Suchen breaks click submission even though the previous native button submitted implicitly. A visible AppFieldLabel is unnecessary for this field because its existing aria-label satisfies the atom contract. Do not add raw sd-btn classes to AppButton. Its own atom provides them.

Replace `.live-actions .text-button { margin-left:auto }` with a layout-only class on the unlink AppButton, e.g. `.live-unlink { margin-left:auto }`; danger appearance comes from intent, not copied text-button/danger styles.

The atom renders a native button and passes attributes/listeners through, so focusin.target, `querySelector('[data-testid=confluence-live-sync-now]')`, and the #210 remembered-focus logic still work. Keep the modal dialog/showModal and focus changes. If also migrating the existing close button, use AppIconButton icon="close" :label="t(...)" class="sd-panel-close" and type the ref as `InstanceType<typeof AppIconButton> | null`; the atom exposes focus().

## Exact raw-element count impact

Target's PluginSettings contains 12 raw sd-btn, 1 raw sd-icon-btn; the whole target baseline is sd-btn15, sd-icon-btn34, sd-input5, sd-textarea2. Current local source contains 17 raw sd-btn (including the two buttons already converted in main). A mechanical patch that retains target's two migrated buttons but adds the three new raw sd-btn would raise global sd-btn15 to18 and fail.

The minimum conversion above replaces the two existing raw search/result buttons plus all three new raw sd-btn (and new uncounted text-button). With other target files untouched, set sd-btn baseline15 ->13, because the test uses exact equality, not an upper bound. Other counts stay unchanged: the old search input had no sd-input class, and AppTextField's class lives inside an atom. Prefer finishing the touched organism's raw primitives if scope allows; converting all its 12 old raw sd-btn gives global sd-btn3. Converting its close button also gives sd-icon-btn33. Recount final source rather than assuming these values if additional edits happen. Never increase or disable the guard.

## Tokens and styles

#210 introduces fresh hardcoded spacing, radius, icon size and typography; target instructions require tokens. Reuse --space-1=4px, --space-2=8px, --space-3=12px, --space-4=16px, --radius-1=8px, --radius-2=14px, --radius-3=16px, --font-size-s=12px. Choose existing tokens consistently or add named shared tokens in tokens.css for missing values (e.g. 11px,14px typography or12px radius), with theme values where applicable. Keep colors based on --text-muted/--accent/--status-ok/--status-error and avoid private color variants. Existing target legacy styles need not all be redesigned for this transfer. Preserve narrow-viewport wrapping and status role=alert/status semantics. Do not broaden the raw-element detector as a workaround.

## Stories and generated manifest

Target already exports PluginSettings and WorkspacePage in design-system/index.ts. Do not add duplicates.
PluginSettings is currently shown only by `organisms/panels.stories.ts` export Plugins with `withWhiteboard()`; in a browser that shows the unavailable/empty plugin state and does not exercise the new Jira live section. It is therefore not enough coverage for #210.

Add `organisms/PluginSettings.stories.ts` (recommended for the new feature's meaningful states), title Organisms/PluginSettings, using withWhiteboard and story-local synthetic plugin settings. Important states: unavailable/unsaved; ready to link with search result; linked pending/syncing; synced with timestamp; retrying with Retry-After; paused; conflict/error; plus narrow viewport and light/dark coverage. Install only Jira in the fixture so the existing selection logic opens it, or drive the real Jira selection. Account for open-watch calling refreshPluginSettings: seeded state must not be replaced by browser fallback. Stub the relevant store/desktop operations locally, keep all mutations/network synthetic, clean up through withWhiteboard, and never call actual tenant or local credentials. Story fixtures must follow the final state types.

The existing `pages/WorkspacePage.stories.ts` EmptyDocument and target description should be preserved; WorkspacePage has no public props/events in the manifest. Parent reviewer owns moving #210 App changes to that page. If adding a workspace-level keyboard/focus story, keep its store/app lifecycle intact rather than injecting a second workspace. Its changed behavior still needs the real focused UI test.

Run `npm run design-system:manifest` after transfer/story/description edits. Never hand-edit manifest.md. A dedicated PluginSettings.stories.ts causes the generator to add its Story path; the current shared panels.stories.ts is recognized by the test but not linked by the manifest generator. Updated @component/prop/event docs appear in the generated section. Regeneration can be a no-op for WorkspacePage when its public description/API does not change.

## Guardrails and required checks (not run in this review)

- All renderer .vue components stay in exactly one level; only App.vue may remain outside.
- Every component has a first-line description and exactly matching index export.
- No upward or product-to-storybook imports; no store in atoms/molecules.
- No native select/datalist.
- Keep all existing catalogue/story coverage; missing-organism allowlist may only shrink.
- Generated manifest must match code; raw primitive baseline may only shrink.

Commands after integration:

```sh
npm run design-system:manifest
npm run design-system:check
npx vitest run --config vitest.config.ts tests/unit/renderer/design-system.spec.ts
npm run typecheck
npm run build:storybook
npm run test:ui -- tests/ui/confluence-live.spec.ts
```

Additionally inspect representative stories in light/dark and narrow viewports, and check Search click/Enter, disabled/focus restoration, Tab/Shift-Tab/Escape, unlink focus, retry/error announcements. These are integration requirements, not tests claimed passed by this static review. Root owns native/tenant acceptance separately.
