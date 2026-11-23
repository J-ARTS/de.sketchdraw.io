import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { askForAgentSkill } from '../../electron/agent-skill-dialog';
import { AGENT_SKILL_FOLDER, AgentSkillService, fingerprint } from '../../electron/agent-skill-service';
import { IPC_CHANNELS, isAgentSkillStatus, validateAgentSkillRequest } from '../../electron/ipc-contract';
import { createPreloadDesktopBridge } from '../../electron/preload';
import type { AgentSkillClientState } from '../../src/domain';

describe('agent skill in the skill folders of the agents (#265)', () => {
  let root: string;
  let home: string;
  let source: string;
  const folder = (client: '.claude' | '.codex' | '.gemini') => path.join(home, client, ...(client === '.gemini' ? ['config', 'skills'] : ['skills']), AGENT_SKILL_FOLDER);
  const service = (supported = true) => new AgentSkillService({ homeDir: home, sourceDir: source, statePath: path.join(root, 'userData', 'agent-skill.json'), supported });
  const states = async (instance: AgentSkillService): Promise<AgentSkillClientState[]> => (await instance.status()).clients.map((client) => client.state);
  /** Everything below the home directory, as relative paths. */
  const tree = (directory = home, prefix = ''): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? [`${prefix}${entry.name}/`, ...tree(path.join(directory, entry.name), `${prefix}${entry.name}/`)] : [`${prefix}${entry.name}`])).sort();

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'sketchdraw-agent-skill-')));
    home = path.join(root, 'home');
    source = path.join(root, 'app', 'skills', AGENT_SKILL_FOLDER);
    mkdirSync(home);
    mkdirSync(path.join(source, 'reference'), { recursive: true });
    writeFileSync(path.join(source, 'SKILL.md'), '---\nname: sketchdraw-desktop\n---\nVersion 1\n');
    writeFileSync(path.join(source, 'reference', 'tools.md'), 'tools\n');
  });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('writes nothing before the user has agreed, and nothing for a start from the sources', async () => {
    mkdirSync(path.join(home, '.claude'));
    const undecided = service();
    expect(await undecided.sync()).toEqual({ supported: true, automatic: null, clients: [
      { id: 'claude', name: 'Claude Code', folder: '~/.claude/skills/sketchdraw-desktop', state: 'missing' },
      { id: 'codex', name: 'Codex', folder: '~/.codex/skills/sketchdraw-desktop', state: 'absent' },
      { id: 'antigravity', name: 'Antigravity', folder: '~/.gemini/config/skills/sketchdraw-desktop', state: 'absent' },
    ] });
    expect(tree()).toEqual(['.claude/']);

    const fromSources = service(false);
    const status = await fromSources.setAutomatic(true);
    expect(status).toMatchObject({ supported: false, automatic: true });
    await fromSources.replace('claude');
    expect(tree()).toEqual(['.claude/']);
  });

  it('sets the skill up for the agents that are on this computer and creates no folder for the others', async () => {
    mkdirSync(path.join(home, '.claude'));
    mkdirSync(path.join(home, '.gemini'));
    const instance = service();
    const status = await instance.setAutomatic(true);
    expect(status.clients.map((client) => client.state)).toEqual(['current', 'absent', 'current']);
    expect(tree()).toEqual([
      '.claude/', '.claude/skills/', '.claude/skills/sketchdraw-desktop/', '.claude/skills/sketchdraw-desktop/SKILL.md', '.claude/skills/sketchdraw-desktop/reference/', '.claude/skills/sketchdraw-desktop/reference/tools.md',
      '.gemini/', '.gemini/config/', '.gemini/config/skills/', '.gemini/config/skills/sketchdraw-desktop/', '.gemini/config/skills/sketchdraw-desktop/SKILL.md', '.gemini/config/skills/sketchdraw-desktop/reference/', '.gemini/config/skills/sketchdraw-desktop/reference/tools.md',
    ]);
    expect(readFileSync(path.join(folder('.claude'), 'SKILL.md'), 'utf8')).toContain('Version 1');
    expect(existsSync(path.join(home, '.codex'))).toBe(false);
    expect(await fingerprint(folder('.claude'))).toBe(await fingerprint(source));
  });

  it('renews its own copy when the app brings a new skill, and takes a matching copy over as its own', async () => {
    mkdirSync(path.join(home, '.claude'));
    mkdirSync(path.join(home, '.codex', 'skills', AGENT_SKILL_FOLDER, 'reference'), { recursive: true });
    // Codex already holds the same skill, copied by hand as the README describes.
    writeFileSync(path.join(folder('.codex'), 'SKILL.md'), readFileSync(path.join(source, 'SKILL.md')));
    writeFileSync(path.join(folder('.codex'), 'reference', 'tools.md'), 'tools\n');
    await service().setAutomatic(true);

    // The update of the app: a changed file, a new one, and one that is gone.
    writeFileSync(path.join(source, 'SKILL.md'), 'Version 2\n');
    writeFileSync(path.join(source, 'examples.md'), 'examples\n');
    rmSync(path.join(source, 'reference'), { recursive: true });
    const afterUpdate = service();
    expect(await states(afterUpdate)).toEqual(['outdated', 'outdated', 'absent']);
    expect((await afterUpdate.sync()).clients.map((client) => client.state)).toEqual(['current', 'current', 'absent']);
    for (const client of ['.claude', '.codex'] as const) {
      expect(readdirSync(folder(client)).sort()).toEqual(['SKILL.md', 'examples.md']);
      expect(readFileSync(path.join(folder(client), 'SKILL.md'), 'utf8')).toBe('Version 2\n');
    }
    // Nothing is left beside the folders.
    expect(readdirSync(path.join(home, '.claude', 'skills'))).toEqual([AGENT_SKILL_FOLDER]);
  });

  it('never replaces a copy the user changed, placed in another version or linked, until the user asks for it', async () => {
    for (const client of ['.claude', '.codex', '.gemini']) mkdirSync(path.join(home, client));
    const instance = service();
    await instance.setAutomatic(true);
    // Claude Code: the user edits the copy. Codex: a copy from somewhere else. Antigravity: a link into a checkout.
    writeFileSync(path.join(folder('.claude'), 'SKILL.md'), 'My own notes\n');
    rmSync(folder('.codex'), { recursive: true });
    mkdirSync(folder('.codex'));
    writeFileSync(path.join(folder('.codex'), 'SKILL.md'), 'Another version\n');
    const checkout = path.join(root, 'checkout');
    mkdirSync(checkout);
    writeFileSync(path.join(checkout, 'SKILL.md'), 'From my checkout\n');
    rmSync(folder('.gemini'), { recursive: true });
    symlinkSync(checkout, folder('.gemini'));

    writeFileSync(path.join(source, 'SKILL.md'), 'Version 2\n');
    const afterUpdate = service();
    expect((await afterUpdate.sync()).clients.map((client) => client.state)).toEqual(['modified', 'modified', 'modified']);
    expect(readFileSync(path.join(folder('.claude'), 'SKILL.md'), 'utf8')).toBe('My own notes\n');
    expect(readFileSync(path.join(folder('.codex'), 'SKILL.md'), 'utf8')).toBe('Another version\n');
    expect(lstatSync(folder('.gemini')).isSymbolicLink()).toBe(true);

    // Asked for: the folder becomes the skill of this version. A link is removed as a link; its target stays.
    expect((await afterUpdate.replace('claude')).clients[0]!.state).toBe('current');
    expect(readFileSync(path.join(folder('.claude'), 'SKILL.md'), 'utf8')).toBe('Version 2\n');
    expect((await afterUpdate.replace('antigravity')).clients[2]!.state).toBe('current');
    expect(lstatSync(folder('.gemini')).isSymbolicLink()).toBe(false);
    expect(readFileSync(path.join(checkout, 'SKILL.md'), 'utf8')).toBe('From my checkout\n');
    expect((await afterUpdate.status()).clients[1]!.state).toBe('modified');
  });

  it('remembers the decision, leaves the folders alone once switched off, and replaces nothing for an absent agent', async () => {
    mkdirSync(path.join(home, '.claude'));
    await service().setAutomatic(true);
    const off = await service().setAutomatic(false);
    expect(off.automatic).toBe(false);
    expect(existsSync(path.join(folder('.claude'), 'SKILL.md'))).toBe(true);
    writeFileSync(path.join(source, 'SKILL.md'), 'Version 2\n');
    expect((await service().sync()).clients[0]!.state).toBe('outdated');
    expect(readFileSync(path.join(folder('.claude'), 'SKILL.md'), 'utf8')).toContain('Version 1');
    await service().replace('codex');
    expect(existsSync(path.join(home, '.codex'))).toBe(false);
    // A state file that cannot be read means: not decided.
    writeFileSync(path.join(root, 'userData', 'agent-skill.json'), '{ not json');
    expect((await service().status()).automatic).toBeNull();
  });

  it('asks once, only in the installed app and only when an agent is there, and keeps either answer', async () => {
    const text = (german: string) => german;
    const showMessage = vi.fn(async (_options: unknown) => ({ response: 0, checkboxChecked: false }));
    // No agent on this computer: no question, and still undecided for a later start.
    expect(await askForAgentSkill({ service: service(), showMessage, text })).toBe('skipped');
    mkdirSync(path.join(home, '.codex'));
    expect(await askForAgentSkill({ service: service(false), showMessage, text })).toBe('skipped');
    expect(showMessage).not.toHaveBeenCalled();

    expect(await askForAgentSkill({ service: service(), showMessage, text })).toBe('asked');
    expect(showMessage).toHaveBeenCalledTimes(1);
    const question = showMessage.mock.calls[0]![0] as { message: string; detail: string; buttons: string[]; cancelId: number };
    expect(question.message).toBe('Skill für KI-Agenten einrichten?');
    expect(question.detail).toContain('Codex: ~/.codex/skills/sketchdraw-desktop');
    expect(question.detail).not.toContain('Claude Code');
    expect(question).toMatchObject({ buttons: ['Einrichten', 'Nicht einrichten'], cancelId: 1 });
    expect(existsSync(path.join(folder('.codex'), 'SKILL.md'))).toBe(true);
    expect(await askForAgentSkill({ service: service(), showMessage, text })).toBe('skipped');

    // "Do not set up" is an answer too: nothing is written and the question does not come back.
    rmSync(path.join(root, 'userData'), { recursive: true });
    rmSync(folder('.codex'), { recursive: true });
    showMessage.mockResolvedValueOnce({ response: 1, checkboxChecked: false });
    expect(await askForAgentSkill({ service: service(), showMessage, text })).toBe('asked');
    expect((await service().sync()).automatic).toBe(false);
    expect(existsSync(folder('.codex'))).toBe(false);
    expect(await askForAgentSkill({ service: service(), showMessage, text })).toBe('skipped');
  });
});

describe('agent skill at the IPC boundary (#265)', () => {
  it('accepts three commands, an agent only by its id, and no path', () => {
    expect(validateAgentSkillRequest({ action: 'status' })).toEqual({ action: 'status' });
    expect(validateAgentSkillRequest({ action: 'set-automatic', enabled: true })).toEqual({ action: 'set-automatic', enabled: true });
    expect(validateAgentSkillRequest({ action: 'replace', client: 'codex' })).toEqual({ action: 'replace', client: 'codex' });
    for (const bad of [null, {}, { action: 'install' }, { action: 'status', path: '/tmp' }, { action: 'set-automatic', enabled: 'yes' }, { action: 'replace', client: '../../etc' }, { action: 'replace', client: 'codex', folder: '/tmp' }, { action: 'replace' }]) {
      expect(() => validateAgentSkillRequest(bad)).toThrow();
    }
  });

  it('passes a status of the main process on to the page and drops anything else', async () => {
    const status = { supported: true, automatic: null, clients: [{ id: 'claude', name: 'Claude Code', folder: '~/.claude/skills/sketchdraw-desktop', state: 'missing' }] };
    expect(isAgentSkillStatus(status)).toBe(true);
    for (const bad of [null, { ...status, automatic: 'yes' }, { ...status, clients: [{ ...status.clients[0], state: 'installed' }] }, { ...status, clients: [{ ...status.clients[0], id: 'cursor' }] }, { supported: true, automatic: true }]) expect(isAgentSkillStatus(bad)).toBe(false);

    const invoke = vi.fn(async (_channel: string, _request: unknown): Promise<unknown> => status);
    const bridge = createPreloadDesktopBridge({ ipc: { invoke, on: () => undefined, removeListener: () => undefined, send: () => undefined } as never });
    expect(await bridge.agentSkill!.getStatus()).toEqual(status);
    await bridge.agentSkill!.setAutomatic(false);
    await bridge.agentSkill!.replace('antigravity');
    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.AGENT_SKILL_INVOKE, { action: 'status' }],
      [IPC_CHANNELS.AGENT_SKILL_INVOKE, { action: 'set-automatic', enabled: false }],
      [IPC_CHANNELS.AGENT_SKILL_INVOKE, { action: 'replace', client: 'antigravity' }],
    ]);
    invoke.mockResolvedValueOnce({ supported: true });
    await expect(bridge.agentSkill!.getStatus()).rejects.toThrow('invalid status');
    await expect(bridge.agentSkill!.replace('cursor' as never)).rejects.toThrow();
  });
});
