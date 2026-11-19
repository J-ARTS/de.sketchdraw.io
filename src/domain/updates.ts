/** Where the update of the desktop app stands. Every phase is something the settings can say in one sentence. */
export type UpdatePhase = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'installing' | 'ready' | 'error';

/**
 * Why a check or an installation stopped:
 * - `network`: GitHub did not answer.
 * - `release`: the answer was not a release this app understands.
 * - `checksum`: the downloaded file does not match the size or SHA-256 the release states.
 * - `install`: the installer of the platform failed.
 * - `cancelled`: the user declined the system prompt for administrator rights.
 */
export type UpdateProblem = 'network' | 'release' | 'checksum' | 'install' | 'cancelled';

export interface UpdateStatus {
  /** False for a start from the sources: nothing is checked or installed there. */
  readonly supported: boolean;
  /** Whether this installation can replace itself. Otherwise only the release page is offered. */
  readonly canInstall: boolean;
  /** Whether the app asks for a newer release on its own. */
  readonly autoCheck: boolean;
  readonly currentVersion: string;
  readonly phase: UpdatePhase;
  /** The newest published version once a check has answered. */
  readonly latestVersion: string | null;
  /** 0 to 1 while downloading. */
  readonly progress: number | null;
  readonly problem: UpdateProblem | null;
}

/** Optional desktop capability: check for a newer release and install it. Browser builds omit it. */
export interface UpdateBridge {
  getStatus(): Promise<UpdateStatus>;
  check(): Promise<UpdateStatus>;
  /** Downloads, verifies and installs the available version; the app restarts afterwards. */
  install(): Promise<UpdateStatus>;
  setAutoCheck(enabled: boolean): Promise<UpdateStatus>;
  openReleasePage(): Promise<void>;
  onStatus(listener: (status: UpdateStatus) => void): () => void;
}
