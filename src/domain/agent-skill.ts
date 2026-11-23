/** The agents whose skill folder the desktop app can fill with its own skill (#265). */
export type AgentSkillClientId = 'claude' | 'codex' | 'antigravity';

/**
 * Where the skill stands for one agent:
 * - `absent`: the agent has no folder on this computer; nothing is created for it.
 * - `missing`: the agent is there, the skill is not.
 * - `current`: the folder holds the skill of this version of the app.
 * - `outdated`: the folder holds what an earlier version of the app wrote, unchanged since.
 * - `modified`: the folder holds something the app did not write, or that was changed since. It is never replaced
 *   without the user asking for it.
 */
export type AgentSkillClientState = 'absent' | 'missing' | 'current' | 'outdated' | 'modified';

export interface AgentSkillClient {
  readonly id: AgentSkillClientId;
  readonly name: string;
  /** The folder of the skill, with `~` for the home directory. */
  readonly folder: string;
  readonly state: AgentSkillClientState;
}

export interface AgentSkillStatus {
  /** False for a start from the sources: the skill is only set up by the installed app. */
  readonly supported: boolean;
  /** Whether the app keeps the skill up to date on its own. Null until the user has decided. */
  readonly automatic: boolean | null;
  readonly clients: readonly AgentSkillClient[];
}

/** Optional desktop capability: put the skill of the app into the skill folders of the agents. Browser builds omit it. */
export interface AgentSkillBridge {
  getStatus(): Promise<AgentSkillStatus>;
  /** Switching on sets the skill up at once; switching off leaves the folders as they are. */
  setAutomatic(enabled: boolean): Promise<AgentSkillStatus>;
  /** Replaces the folder of one agent with the skill of this version, also a copy that was changed. */
  replace(client: AgentSkillClientId): Promise<AgentSkillStatus>;
}
