import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { AgentSkillClientState, AgentSkillStatus } from '../../src/domain';

type SkillControl = { status: AgentSkillStatus; calls: string[] };
type TestWindow = Window & { __agentSkill: SkillControl };

/** A desktop app whose skill service lives in memory: it answers like the main process does. */
async function desktop(page: Page, options: { theme?: 'light' | 'dark'; language?: 'de' | 'en'; supported?: boolean; automatic?: boolean | null; states?: AgentSkillClientState[] } = {}): Promise<void> {
  await page.addInitScript(({ theme, language, supported, automatic, states }) => {
    localStorage.setItem('sketchdraw.preferences.v1', JSON.stringify({ theme, language, canvasBackground: null }));
    const clients = [
      { id: 'claude' as const, name: 'Claude Code', folder: '~/.claude/skills/sketchdraw-desktop', state: states[0]! },
      { id: 'codex' as const, name: 'Codex', folder: '~/.codex/skills/sketchdraw-desktop', state: states[1]! },
      { id: 'antigravity' as const, name: 'Antigravity', folder: '~/.gemini/config/skills/sketchdraw-desktop', state: states[2]! },
    ];
    const control: SkillControl = { status: { supported, automatic, clients }, calls: [] };
    const set = (change: (state: AgentSkillClientState, id: string) => AgentSkillClientState, automaticNow = control.status.automatic) => {
      control.status = { ...control.status, automatic: automaticNow, clients: control.status.clients.map((client) => ({ ...client, state: change(client.state, client.id) })) };
      return control.status;
    };
    Object.defineProperty(window, '__agentSkill', { value: control });
    Object.defineProperty(window, 'sketchdraw', { value: {
      platform: 'electron',
      openDocument: async () => ({ status: 'cancelled' }), saveDocument: async () => ({ status: 'cancelled' }),
      exportFile: async () => ({ status: 'cancelled' }), openExternal: async () => {},
      onCloseRequested: () => () => {}, respondToClose: async () => {}, onMenuCommand: () => () => {},
      agentSkill: {
        getStatus: async () => control.status,
        // Switching on writes what is missing or older; a changed copy stays.
        setAutomatic: async (enabled: boolean) => { control.calls.push(`automatic:${enabled}`); return set((state) => (enabled && (state === 'missing' || state === 'outdated') ? 'current' : state), enabled); },
        replace: async (id: string) => { control.calls.push(`replace:${id}`); return set((state, client) => (client === id && state !== 'absent' ? 'current' : state)); },
      },
    } });
  }, { theme: options.theme ?? 'light', language: options.language ?? 'de', supported: options.supported ?? true, automatic: options.automatic ?? null, states: options.states ?? ['missing', 'modified', 'absent'] });
  page.on('pageerror', (error) => { throw error; });
  await page.goto('/');
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
}

async function openSettings(page: Page, language: 'de' | 'en' = 'de') {
  await page.getByTestId('workspace-menu-button').click();
  await page.getByRole('menuitem', { name: language === 'de' ? 'Einstellungen' : 'Settings' }).click();
  const dialog = page.getByTestId('settings-dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}
const calls = (page: Page) => page.evaluate(() => (window as unknown as TestWindow).__agentSkill.calls);
const axe = async (page: Page) => (await new AxeBuilder({ page }).include('[data-testid=settings-dialog]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;

test('the settings switch the skill for the agents on, show each folder and replace a changed copy only on request (#265)', async ({ page }) => {
  await desktop(page);
  const dialog = await openSettings(page);
  const section = dialog.getByRole('region', { name: 'KI-Agenten' });
  const automatic = section.getByRole('switch', { name: 'Skill für KI-Agenten aktuell halten' });
  // Nothing is decided yet: the switch is off, and every agent says where it stands.
  await expect(automatic).not.toBeChecked();
  const claude = section.getByTestId('agent-skill-claude');
  const codex = section.getByTestId('agent-skill-codex');
  const antigravity = section.getByTestId('agent-skill-antigravity');
  await expect(claude).toContainText('Claude Code');
  await expect(claude).toContainText('Nicht eingerichtet');
  await expect(claude).toContainText('~/.claude/skills/sketchdraw-desktop');
  await expect(codex).toContainText('Geändert oder von Hand abgelegt – wird nicht automatisch ersetzt');
  await expect(antigravity).toContainText('Nicht auf diesem Computer gefunden');
  await expect(antigravity.getByRole('button')).toHaveCount(0);
  expect(await axe(page)).toEqual([]);

  // Switching on sets up what is missing; the changed copy of Codex stays and keeps its own action.
  await automatic.click();
  await expect(automatic).toBeChecked();
  await expect(claude).toContainText('Aktuell');
  await expect(claude.getByRole('button')).toHaveCount(0);
  await expect(codex).toContainText('wird nicht automatisch ersetzt');
  expect(await calls(page)).toEqual(['automatic:true']);

  await codex.getByRole('button', { name: 'Ersetzen: Skill für Codex' }).click();
  await expect(codex).toContainText('Aktuell');
  await expect(codex.getByRole('button')).toHaveCount(0);
  expect(await calls(page)).toEqual(['automatic:true', 'replace:codex']);

  await automatic.click();
  await expect(automatic).not.toBeChecked();
  await expect(claude).toContainText('Aktuell');
  expect(await calls(page)).toEqual(['automatic:true', 'replace:codex', 'automatic:false']);
});

for (const theme of ['light', 'dark'] as const) {
  test(`the agent section reads in English, fits a narrow window and follows the ${theme} theme (#265)`, async ({ page }) => {
    await desktop(page, { theme, language: 'en', automatic: false, states: ['outdated', 'missing', 'current'] });
    await page.setViewportSize({ width: 420, height: 760 });
    const dialog = await openSettings(page, 'en');
    const section = dialog.getByRole('region', { name: 'AI agents' });
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByRole('switch', { name: 'Keep the skill for AI agents up to date' })).not.toBeChecked();
    await expect(section.getByTestId('agent-skill-claude')).toContainText('Older version');
    await expect(section.getByRole('button', { name: 'Update: skill for Claude Code' })).toBeVisible();
    await expect(section.getByRole('button', { name: 'Set up: skill for Codex' })).toBeVisible();
    await expect(section.getByTestId('agent-skill-antigravity')).toContainText('Up to date');
    expect(await axe(page)).toEqual([]);
    // Nothing runs out of the dialog.
    const overflow = await dialog.evaluate((element) => { const box = element.getBoundingClientRect(); return [...element.querySelectorAll('[data-testid="agent-skill-settings"] *')].filter((child) => { const inner = child.getBoundingClientRect(); return inner.width > 0 && (inner.left < box.left - 0.5 || inner.right > box.right + 0.5); }).length; });
    expect(overflow).toBe(0);
    if (process.env['SKETCHDRAW_SHOTS']) await section.screenshot({ path: `${process.env['SKETCHDRAW_SHOTS']}/agent-skill-${theme}.png` });
  });
}

test('a start from the sources shows the folders but offers nothing to set up; the browser has no agent section (#265)', async ({ page }) => {
  await desktop(page, { supported: false });
  const dialog = await openSettings(page);
  const section = dialog.getByRole('region', { name: 'KI-Agenten' });
  await expect(section.getByTestId('agent-skill-unsupported')).toHaveText('Den Skill richtet nur die installierte App ein.');
  await expect(section.getByRole('switch')).toHaveCount(0);
  await expect(section.getByRole('button')).toHaveCount(0);
  await expect(section.getByTestId('agent-skill-claude')).toContainText('~/.claude/skills/sketchdraw-desktop');
});

test('the browser preview has no agent section in the settings (#265)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
  const dialog = await openSettings(page);
  await expect(dialog.getByTestId('agent-skill-settings')).toHaveCount(0);
});
