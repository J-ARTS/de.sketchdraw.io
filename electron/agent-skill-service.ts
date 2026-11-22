import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AgentSkillClient, AgentSkillClientId, AgentSkillClientState, AgentSkillStatus } from '../src/domain/agent-skill';

/**
 * Puts the skill the app ships into the skill folders of Claude Code, Codex and Antigravity and keeps it up to date
 * (#265). These folders belong to other programs, so the service is strict about what it touches:
 *
 * - It writes only after the user has agreed, and only in the installed app.
 * - It creates and replaces nothing but its own folder `sketchdraw-desktop`.
 * - It creates no folder for an agent that is not on this computer.
 * - It replaces a copy only if that copy is what the app wrote itself. A copy the user changed, placed by hand in
 *   another version, or linked from elsewhere stays until the user asks for the replacement.
 * - The renderer names an agent by its id; every path is built here.
 */
export const AGENT_SKILL_FOLDER = 'sketchdraw-desktop';

const CLIENTS: ReadonlyArray<{ id: AgentSkillClientId; name: string; home: string; skills: readonly string[] }> = [
  { id: 'claude', name: 'Claude Code', home: '.claude', skills: ['skills'] },
  { id: 'codex', name: 'Codex', home: '.codex', skills: ['skills'] },
  { id: 'antigravity', name: 'Antigravity', home: '.gemini', skills: ['config', 'skills'] },
];
export const AGENT_SKILL_CLIENT_IDS: readonly AgentSkillClientId[] = CLIENTS.map((client) => client.id);

/** A skill is a few text files; more than this is not ours to copy or compare. */
const MAX_FILES = 64;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface AgentSkillServiceOptions {
  /** The home directory of the user. */
  readonly homeDir: string;
  /** The folder of the skill the app ships. */
  readonly sourceDir: string;
  /** Where the decision of the user and the fingerprints of the written copies are kept. */
  readonly statePath: string;
  /** False for a start from the sources: the status is shown, nothing is written. */
  readonly supported: boolean;
}

interface StoredState { automatic: boolean | null; written: Partial<Record<AgentSkillClientId, string>> }

async function kind(target: string): Promise<'none' | 'directory' | 'other'> {
  try {
    const stat = await fs.lstat(target);
    return stat.isDirectory() ? 'directory' : 'other';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'none';
    throw error;
  }
}

/** The regular files of a folder, relative and sorted. Anything else in it (a link, a device) makes it not ours. */
async function listFiles(root: string, relative = '', found: string[] = []): Promise<string[] | null> {
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) { if (!(await listFiles(root, name, found))) return null; }
    else if (entry.isFile()) found.push(name);
    else return null;
    if (found.length > MAX_FILES) return null;
  }
  return found.sort();
}

/** A fingerprint of the names and contents of a folder, or null for a folder that is not a plain skill folder. */
export async function fingerprint(root: string): Promise<string | null> {
  const files = await listFiles(root);
  if (!files) return null;
  const hash = createHash('sha256');
  for (const name of files) {
    const contents = await fs.readFile(path.join(root, ...name.split('/')));
    if (contents.byteLength > MAX_FILE_BYTES) return null;
    hash.update(`${name}\0${contents.byteLength}\0`).update(contents);
  }
  return hash.digest('hex');
}

export class AgentSkillService {
  private state: StoredState | null = null;
  /** One change at a time: two writers must not replace the same folder. */
  private queue: Promise<unknown> = Promise.resolve();

  public constructor(private readonly options: AgentSkillServiceOptions) {}

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async load(): Promise<StoredState> {
    if (this.state) return this.state;
    let state: StoredState = { automatic: null, written: {} };
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(this.options.statePath, 'utf8'));
      if (typeof parsed === 'object' && parsed !== null) {
        const record = parsed as Record<string, unknown>;
        const written: StoredState['written'] = {};
        const stored = typeof record['written'] === 'object' && record['written'] !== null ? record['written'] as Record<string, unknown> : {};
        for (const id of AGENT_SKILL_CLIENT_IDS) { const value = stored[id]; if (typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)) written[id] = value; }
        state = { automatic: typeof record['automatic'] === 'boolean' ? record['automatic'] : null, written };
      }
    } catch { /* no file yet, or one that cannot be read: the user has not decided */ }
    this.state = state;
    return state;
  }

  private async save(state: StoredState): Promise<void> {
    this.state = state;
    await fs.mkdir(path.dirname(this.options.statePath), { recursive: true });
    const temporary = `${this.options.statePath}.${randomBytes(6).toString('hex')}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporary, this.options.statePath);
  }

  private target(client: (typeof CLIENTS)[number]): { home: string; skills: string; folder: string } {
    const home = path.join(this.options.homeDir, client.home);
    const skills = path.join(home, ...client.skills);
    return { home, skills, folder: path.join(skills, AGENT_SKILL_FOLDER) };
  }

  private async stateOf(client: (typeof CLIENTS)[number], state: StoredState, source: string | null): Promise<AgentSkillClientState> {
    const target = this.target(client);
    try {
      if (await kind(target.home) !== 'directory') return 'absent';
      const found = await kind(target.folder);
      if (found === 'none') return 'missing';
      if (found !== 'directory') return 'modified';
      const present = await fingerprint(target.folder);
      if (present !== null && present === source) return 'current';
      return present !== null && present === state.written[client.id] ? 'outdated' : 'modified';
    } catch {
      // A folder that cannot be read is not ours to judge or to replace.
      return 'modified';
    }
  }

  private async describe(state: StoredState): Promise<AgentSkillStatus> {
    const source = await fingerprint(this.options.sourceDir).catch(() => null);
    const clients: AgentSkillClient[] = [];
    for (const client of CLIENTS) {
      clients.push({ id: client.id, name: client.name, folder: ['~', client.home, ...client.skills, AGENT_SKILL_FOLDER].join('/'), state: await this.stateOf(client, state, source) });
    }
    return { supported: this.options.supported && source !== null, automatic: state.automatic, clients };
  }

  /** Writes the shipped skill into the folder of one agent: beside it first, then in its place. */
  private async write(client: (typeof CLIENTS)[number], state: StoredState): Promise<StoredState> {
    const source = await fingerprint(this.options.sourceDir);
    const files = await listFiles(this.options.sourceDir);
    if (!source || !files) throw new Error('The skill of the app cannot be read.');
    const target = this.target(client);
    await fs.mkdir(target.skills, { recursive: true });
    const staging = path.join(target.skills, `.${AGENT_SKILL_FOLDER}.${randomBytes(6).toString('hex')}.tmp`);
    try {
      for (const name of files) {
        const to = path.join(staging, ...name.split('/'));
        await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.copyFile(path.join(this.options.sourceDir, ...name.split('/')), to);
      }
      // A link is removed as a link; what it points to is never touched.
      if (await kind(target.folder) === 'directory') await fs.rm(target.folder, { recursive: true, force: true });
      else await fs.rm(target.folder, { force: true });
      await fs.rename(staging, target.folder);
    } finally {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
    return { ...state, written: { ...state.written, [client.id]: source } };
  }

  private async syncNow(state: StoredState): Promise<StoredState> {
    if (!this.options.supported || state.automatic !== true) return state;
    const source = await fingerprint(this.options.sourceDir).catch(() => null);
    if (!source) return state;
    let next = state;
    for (const client of CLIENTS) {
      const found = await this.stateOf(client, next, source);
      try {
        if (found === 'missing' || found === 'outdated') next = await this.write(client, next);
        // A copy that already matches is taken over as ours, so the next version of the app may update it.
        else if (found === 'current' && next.written[client.id] !== source) next = { ...next, written: { ...next.written, [client.id]: source } };
      } catch { /* a folder that cannot be written keeps its state; the settings show it */ }
    }
    if (next !== state) await this.save(next);
    return next;
  }

  public status(): Promise<AgentSkillStatus> {
    return this.serial(async () => this.describe(await this.load()));
  }

  /** The start of the app: brings the folders up to date when the user has agreed to it. */
  public sync(): Promise<AgentSkillStatus> {
    return this.serial(async () => this.describe(await this.syncNow(await this.load())));
  }

  /** True when the user has not decided yet and at least one agent is on this computer. */
  public async shouldAsk(): Promise<boolean> {
    const status = await this.status();
    return status.supported && status.automatic === null && status.clients.some((client) => client.state !== 'absent');
  }

  public setAutomatic(enabled: boolean): Promise<AgentSkillStatus> {
    return this.serial(async () => {
      const state = { ...(await this.load()), automatic: enabled };
      await this.save(state);
      return this.describe(await this.syncNow(state));
    });
  }

  /** The user asks for the skill of this version in the folder of one agent, whatever is there now. */
  public replace(id: AgentSkillClientId): Promise<AgentSkillStatus> {
    return this.serial(async () => {
      const client = CLIENTS.find((entry) => entry.id === id);
      let state = await this.load();
      if (!client || !this.options.supported) return this.describe(state);
      if (await kind(this.target(client).home) === 'directory') {
        state = await this.write(client, state);
        await this.save(state);
      }
      return this.describe(state);
    });
  }
}
