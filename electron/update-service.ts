import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { UpdatePhase, UpdateProblem, UpdateStatus } from '../src/domain/updates';
import { APP_DISPLAY_NAME, APP_REPOSITORY } from './branding';

/**
 * Update of the installed app (#237). The newest published GitHub release is the only source: the app asks for it,
 * downloads the installer of its platform, compares size and SHA-256 with what the release states and hands the file
 * to the installer of the platform. Network and installer are injected, so every step runs in tests without a GUI.
 */
export const LATEST_RELEASE_API_URL = `https://api.github.com/repos/${APP_REPOSITORY}/releases/latest`;
export const RELEASE_PAGE_URL = `https://github.com/${APP_REPOSITORY}/releases/latest`;
const DOWNLOAD_URL_PREFIX = `https://github.com/${APP_REPOSITORY}/releases/download/`;
const MAX_INSTALLER_BYTES = 1024 * 1024 * 1024;
const CHECK_TIMEOUT_MS = 15_000;
const STALL_TIMEOUT_MS = 60_000;
export const FIRST_CHECK_DELAY_MS = 15_000;
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export class UpdateError extends Error {
  constructor(public readonly problem: UpdateProblem, message: string) {
    super(message);
    this.name = 'UpdateError';
  }
}

export type Version = readonly [number, number, number];

/** Plain `major.minor.patch`; anything else (pre-releases, build metadata) is not a version this app installs. */
export function parseVersion(text: unknown): Version | null {
  if (typeof text !== 'string') return null;
  const match = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(text);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function compareVersions(left: Version, right: Version): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index]! < right[index]! ? -1 : 1;
  }
  return 0;
}

/** The installer the release workflow publishes for a platform, or null where there is none. */
export function installerAssetName(version: string, platform: NodeJS.Platform, arch: string): string | null {
  if (platform === 'win32' && arch === 'x64') return `${APP_DISPLAY_NAME}-${version}-windows-x64.exe`;
  if (platform === 'darwin' && arch === 'arm64') return `${APP_DISPLAY_NAME}-${version}-macos-arm64.dmg`;
  if (platform === 'linux' && arch === 'x64') return `${APP_DISPLAY_NAME}-${version}-linux-x64.deb`;
  return null;
}

export interface ReleaseAsset {
  readonly name: string;
  readonly url: string;
  readonly size: number;
  readonly sha256: string;
}

export interface ReleaseInfo {
  readonly version: string;
  /** Null when the release has no installer for this platform or states no usable checksum for it. */
  readonly asset: ReleaseAsset | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads the answer of `releases/latest`. The file name and the download address are built here and only compared with
 * the answer, so nothing the answer says can point the download or the file on disk somewhere else.
 */
export function parseLatestRelease(payload: unknown, platform: NodeJS.Platform, arch: string): ReleaseInfo {
  if (!isRecord(payload)) throw new UpdateError('release', 'The release answer is not an object.');
  if (payload['draft'] === true || payload['prerelease'] === true) throw new UpdateError('release', 'The newest release is a draft or a pre-release.');
  const tag = payload['tag_name'];
  const version = typeof tag === 'string' && tag.startsWith('v') ? tag.slice(1) : '';
  if (!parseVersion(version)) throw new UpdateError('release', 'The release tag is not a version.');

  const name = installerAssetName(version, platform, arch);
  const assets = Array.isArray(payload['assets']) ? payload['assets'] : [];
  const entry = name ? assets.find((asset) => isRecord(asset) && asset['name'] === name) : undefined;
  if (!name || !isRecord(entry)) return { version, asset: null };

  const url = `${DOWNLOAD_URL_PREFIX}v${version}/${name}`;
  const size = entry['size'];
  const digest = entry['digest'];
  const sha256 = typeof digest === 'string' ? /^sha256:([0-9a-f]{64})$/.exec(digest)?.[1] : undefined;
  if (entry['browser_download_url'] !== url || !Number.isSafeInteger(size) || (size as number) <= 0 || (size as number) > MAX_INSTALLER_BYTES || !sha256) {
    return { version, asset: null };
  }
  return { version, asset: { name, url, size: size as number, sha256 } };
}

/** What still has to happen once the installer of the platform has taken the verified file. */
export interface InstallPlan {
  /** Runs when the app has decided to quit, after unsaved documents were handled. */
  readonly onQuit?: () => void;
  /** The new version is already in place: the app only has to start again. */
  readonly relaunch?: boolean;
}

export interface PlatformInstaller {
  /** Whether this installation can replace itself (writable location, installer tools present). */
  canInstall(): boolean;
  install(file: string, version: string): Promise<InstallPlan>;
  /** Removes what an earlier update left behind. */
  cleanUp?(): Promise<void>;
}

export type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;

export interface UpdateServiceOptions {
  readonly currentVersion: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  /** Only the installed app updates itself; a start from the sources never asks GitHub. */
  readonly packaged: boolean;
  readonly settingsPath: string;
  readonly downloadDir: string;
  /** A step that runs after the app has quit writes the version here when it failed. */
  readonly failureMarker: string;
  readonly fetch: FetchLike;
  readonly installer: PlatformInstaller | null;
  emit(status: UpdateStatus): void;
  /** Quits the app through its normal path; `onQuit` runs once the quit is certain. */
  quit(plan: InstallPlan): void;
}

interface StoredSettings {
  autoCheck: boolean;
  /** The version the user answered "later" to; the start no longer asks about it. */
  dismissedVersion: string | null;
}

function readSettings(file: string): StoredSettings {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (isRecord(parsed)) {
      const dismissed = parsed['dismissedVersion'];
      return { autoCheck: parsed['autoCheck'] !== false, dismissedVersion: parseVersion(dismissed) ? (dismissed as string) : null };
    }
  } catch { /* no settings yet, or unreadable ones: the defaults apply */ }
  return { autoCheck: true, dismissedVersion: null };
}

export class UpdateService {
  private phase: UpdatePhase = 'idle';
  private problem: UpdateProblem | null = null;
  private progress: number | null = null;
  private release: ReleaseInfo | null = null;
  private settings: StoredSettings;
  private running: Promise<UpdateStatus> | null = null;
  private timers: Array<ReturnType<typeof setTimeout>> = [];
  private readonly supported: boolean;

  constructor(private readonly options: UpdateServiceOptions) {
    this.supported = options.packaged && parseVersion(options.currentVersion) !== null;
    this.settings = readSettings(options.settingsPath);
  }

  status(): UpdateStatus {
    return Object.freeze({
      supported: this.supported,
      canInstall: this.supported && this.release?.asset != null && (this.options.installer?.canInstall() ?? false),
      autoCheck: this.settings.autoCheck,
      currentVersion: this.options.currentVersion,
      phase: this.phase,
      latestVersion: this.release?.version ?? null,
      progress: this.progress,
      problem: this.problem,
    });
  }

  /** Whether the start may ask the user about the available version (not after "later" for that version). */
  shouldPrompt(): boolean {
    return this.phase === 'available' && this.release !== null && this.release.version !== this.settings.dismissedVersion;
  }

  /**
   * Starts the automatic checks: one shortly after the start, then one every few hours. `onChecked` hears the result of
   * every automatic check. Nothing happens for a start from the sources.
   */
  start(onChecked: (status: UpdateStatus) => void): void {
    if (!this.supported) return;
    const failed = this.takeFailedVersion();
    if (failed) {
      // The start does not offer the version that just failed again; "check for updates" still does.
      this.settings = { ...this.settings, dismissedVersion: failed };
      void this.persist();
      this.set('error', 'install');
      onChecked(this.status());
    }
    void this.options.installer?.cleanUp?.().catch(() => undefined);
    void rm(this.options.downloadDir, { recursive: true, force: true }).catch(() => undefined);
    const automatic = (): void => {
      if (this.settings.autoCheck) void this.check().then(onChecked, () => undefined);
    };
    const first = setTimeout(automatic, FIRST_CHECK_DELAY_MS);
    const repeat = setInterval(automatic, CHECK_INTERVAL_MS);
    first.unref?.();
    repeat.unref?.();
    this.timers.push(first, repeat);
  }

  private takeFailedVersion(): string | null {
    try {
      const version = readFileSync(this.options.failureMarker, 'utf8').trim();
      rmSync(this.options.failureMarker, { force: true });
      return parseVersion(version) ? version : null;
    } catch {
      return null;
    }
  }

  dispose(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  async setAutoCheck(enabled: boolean): Promise<UpdateStatus> {
    this.settings = { ...this.settings, autoCheck: enabled };
    await this.persist();
    return this.publish();
  }

  /** Remembers "later" for the available version. */
  async dismissAvailable(): Promise<void> {
    if (!this.release) return;
    this.settings = { ...this.settings, dismissedVersion: this.release.version };
    await this.persist();
  }

  /**
   * Asks GitHub for the newest release. Never rejects: a failure is a status. A start from the sources never asks on
   * its own; only `manual` ("Check for Updates…" in the menu, #299) looks there too. It can then name a newer version
   * but never install it.
   */
  check(options: { manual?: boolean } = {}): Promise<UpdateStatus> {
    const allowed = this.supported || (options.manual === true && parseVersion(this.options.currentVersion) !== null);
    if (!allowed || this.phase === 'ready') return Promise.resolve(this.status());
    return this.exclusive(async () => {
      this.set('checking');
      try {
        const release = await this.fetchLatest();
        const current = parseVersion(this.options.currentVersion)!;
        this.release = release;
        this.set(compareVersions(parseVersion(release.version)!, current) > 0 ? 'available' : 'current');
      } catch (error) {
        this.set('error', error instanceof UpdateError ? error.problem : 'network');
      }
    });
  }

  /** Downloads, verifies and installs the available version, then quits the app. Never rejects. */
  install(): Promise<UpdateStatus> {
    const asset = this.release?.asset;
    const installer = this.options.installer;
    // A start from the sources may know of a newer version after a manual check; it still never replaces itself.
    if (!this.supported || this.running || this.phase !== 'available' || !this.release || !asset || !installer?.canInstall()) return Promise.resolve(this.status());
    const version = this.release.version;
    return this.exclusive(async () => {
      try {
        this.set('downloading', null, 0);
        const file = await this.download(asset);
        this.set('installing');
        const plan = await installer.install(file, version);
        this.set('ready');
        this.options.quit(plan);
      } catch (error) {
        await rm(this.options.downloadDir, { recursive: true, force: true }).catch(() => undefined);
        this.set('error', error instanceof UpdateError ? error.problem : 'install');
      }
    });
  }

  /** One check or installation at a time; a second caller gets the result of the running one. */
  private exclusive(work: () => Promise<void>): Promise<UpdateStatus> {
    this.running ??= work().then(() => this.status()).finally(() => { this.running = null; });
    return this.running;
  }

  private set(phase: UpdatePhase, problem: UpdateProblem | null = null, progress: number | null = null): void {
    this.phase = phase;
    this.problem = problem;
    this.progress = progress;
    this.publish();
  }

  private publish(): UpdateStatus {
    const status = this.status();
    this.options.emit(status);
    return status;
  }

  private async persist(): Promise<void> {
    const file = this.options.settingsPath;
    const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(temporary, `${JSON.stringify(this.settings, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, file);
    } catch {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  private headers(accept: string): Record<string, string> {
    return { Accept: accept, 'User-Agent': `${APP_DISPLAY_NAME}/${this.options.currentVersion}`, 'X-GitHub-Api-Version': '2022-11-28' };
  }

  private async fetchLatest(): Promise<ReleaseInfo> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), CHECK_TIMEOUT_MS);
    try {
      const response = await this.options.fetch(LATEST_RELEASE_API_URL, { headers: this.headers('application/vnd.github+json'), signal: abort.signal });
      if (!response.ok) throw new UpdateError('network', `GitHub answered with ${response.status}.`);
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new UpdateError('release', 'The release answer is not JSON.'); }
      return parseLatestRelease(payload, this.options.platform, this.options.arch);
    } catch (error) {
      if (error instanceof UpdateError) throw error;
      throw new UpdateError('network', error instanceof Error ? error.message : 'The request failed.');
    } finally {
      clearTimeout(timer);
    }
  }

  /** Writes the installer to disk while hashing it. A file of the wrong size or hash is deleted. */
  private async download(asset: ReleaseAsset): Promise<string> {
    const directory = this.options.downloadDir;
    await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, asset.name);
    const abort = new AbortController();
    let stall: ReturnType<typeof setTimeout> | undefined;
    const watch = (): void => {
      clearTimeout(stall);
      stall = setTimeout(() => abort.abort(), STALL_TIMEOUT_MS);
    };
    try {
      watch();
      let response: Response;
      try {
        response = await this.options.fetch(asset.url, { headers: this.headers('application/octet-stream'), signal: abort.signal });
      } catch (error) {
        throw new UpdateError('network', error instanceof Error ? error.message : 'The download failed.');
      }
      if (!response.ok || !response.body) throw new UpdateError('network', `The download answered with ${response.status}.`);
      if (response.url && !response.url.startsWith('https://')) throw new UpdateError('network', 'The download left HTTPS.');

      const hash = createHash('sha256');
      const handle = await open(file, 'wx', 0o700);
      let received = 0;
      let reported = 0;
      try {
        const reader = response.body.getReader();
        for (;;) {
          let chunk: ReadableStreamReadResult<Uint8Array>;
          try { chunk = await reader.read(); } catch (error) {
            throw new UpdateError('network', error instanceof Error ? error.message : 'The download broke off.');
          }
          if (chunk.done) break;
          watch();
          received += chunk.value.byteLength;
          if (received > asset.size) throw new UpdateError('checksum', 'The download is larger than the release states.');
          hash.update(chunk.value);
          await handle.write(chunk.value);
          const progress = received / asset.size;
          if (progress - reported >= 0.01 || received === asset.size) {
            reported = progress;
            this.set('downloading', null, progress);
          }
        }
      } finally {
        await handle.close();
      }
      if (received !== asset.size || hash.digest('hex') !== asset.sha256) throw new UpdateError('checksum', 'The download does not match the release.');
      return file;
    } finally {
      clearTimeout(stall);
    }
  }
}
