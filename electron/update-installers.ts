import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { accessSync, constants, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { type InstallPlan, type PlatformInstaller, UpdateError } from './update-service';

/**
 * How each platform takes a verified installer (#237). Every external program goes through a `CommandRunner`, so the
 * steps are tested without the programs and without a second copy of the logic.
 */
export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandRunner {
  run(command: string, args: readonly string[], options?: { timeoutMs?: number }): Promise<CommandResult>;
  /** Starts a process that outlives the app. */
  launch(command: string, args: readonly string[]): void;
}

export const systemRunner: CommandRunner = {
  run: (command, args, options) => new Promise((resolve) => {
    execFile(command, [...args], { timeout: options?.timeoutMs ?? 120_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : -1) : 0;
      resolve({ code, stdout: String(stdout), stderr: error && !stderr ? error.message : String(stderr) });
    });
  }),
  launch: (command, args) => {
    const child = spawn(command, [...args], { detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', () => undefined);
    child.unref();
  },
};

async function must(result: Promise<CommandResult>, what: string): Promise<CommandResult> {
  const done = await result;
  if (done.code !== 0) throw new UpdateError('install', `${what} failed (${done.code}): ${done.stderr.trim().slice(0, 300)}`);
  return done;
}

/**
 * Windows: the NSIS installer of the release. `/S` installs without pages into the existing location, `--updated`
 * lets it wait for the app to close, `--force-run` starts the new version afterwards.
 */
export function createWindowsInstaller(runner: CommandRunner): PlatformInstaller {
  return {
    canInstall: () => true,
    install: async (file) => ({ onQuit: () => runner.launch(file, ['/S', '--updated', '--force-run']) }),
  };
}

const PKEXEC = '/usr/bin/pkexec';
const DPKG = '/usr/bin/dpkg';

/**
 * Linux: the Debian package, installed through the system prompt for administrator rights while the app still runs.
 * Only an app that the package installed (under /opt) replaces itself; an unpacked copy points to the release page.
 */
export function createLinuxInstaller(options: { execPath: string; runner: CommandRunner; exists?: (file: string) => boolean }): PlatformInstaller {
  const exists = options.exists ?? existsSync;
  return {
    canInstall: () => options.execPath.startsWith('/opt/') && exists(PKEXEC) && exists(DPKG),
    install: async (file): Promise<InstallPlan> => {
      const result = await options.runner.run(PKEXEC, [DPKG, '-i', file], { timeoutMs: 10 * 60_000 });
      // pkexec: 126 = the prompt was dismissed, 127 = not authorized or no agent to ask.
      if (result.code === 126 || result.code === 127) throw new UpdateError('cancelled', 'The request for administrator rights was declined.');
      if (result.code !== 0) throw new UpdateError('install', `dpkg failed (${result.code}): ${result.stderr.trim().slice(0, 300)}`);
      return { relaunch: true };
    },
  };
}

export const MAC_STAGING_PREFIX = '.Sketchdraw-update-';

/**
 * Runs after the app has quit: moves the running bundle aside, moves the new one into its place and starts it. If the
 * new bundle cannot take the place, the old one goes back and the failed version is written to the marker file.
 * Arguments: pid, target bundle, staged bundle, staging directory, marker file, version.
 */
export const MAC_SWAP_SCRIPT = [
  'pid="$1"; target="$2"; staged="$3"; staging="$4"; marker="$5"; version="$6"',
  'tries=0',
  'while kill -0 "$pid" 2>/dev/null; do',
  '  tries=$((tries + 1))',
  '  if [ "$tries" -gt 600 ]; then exit 1; fi',
  '  sleep 0.1',
  'done',
  'previous="$staging/previous.app"',
  'if mv "$target" "$previous" 2>/dev/null; then',
  '  if mv "$staged" "$target" 2>/dev/null; then',
  '    rm -rf "$staging"',
  '  else',
  '    mv "$previous" "$target"',
  '    printf "%s" "$version" > "$marker"',
  '  fi',
  'else',
  '  printf "%s" "$version" > "$marker"',
  'fi',
  'open "$target"',
].join('\n');

/** The `.app` bundle a macOS executable runs from, or null when the path is not inside one. */
export function macBundlePath(execPath: string): string | null {
  const posix = path.posix;
  const bundle = posix.resolve(execPath, '../../..');
  return bundle.endsWith('.app') && posix.basename(posix.dirname(execPath)) === 'MacOS' ? bundle : null;
}

function isWritable(file: string): boolean {
  try {
    accessSync(file, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export interface MacInstallerOptions {
  readonly execPath: string;
  readonly pid: number;
  readonly runner: CommandRunner;
  readonly tmpDir: string;
  /** The swap script writes the version here when it could not replace the app. */
  readonly failureMarker: string;
  readonly bundleId: string;
  readonly writable?: (file: string) => boolean;
}

/**
 * macOS: the disk image of the release. The bundle inside is checked (identifier, version), copied next to the running
 * app and swapped in once the app has quit. That needs a writable location: an app started from the disk image, from a
 * translocated copy or from a folder the user may not write to points to the release page instead.
 */
export function createMacInstaller(options: MacInstallerOptions): PlatformInstaller {
  const posix = path.posix;
  const writable = options.writable ?? isWritable;
  const bundle = macBundlePath(options.execPath);
  const { runner } = options;
  return {
    canInstall: () => bundle !== null
      && !bundle.startsWith('/Volumes/')
      && !bundle.includes('/AppTranslocation/')
      && writable(bundle)
      && writable(posix.dirname(bundle)),

    async install(file, version): Promise<InstallPlan> {
      if (!bundle) throw new UpdateError('install', 'The app does not run from an app bundle.');
      const mount = await mkdtemp(path.join(options.tmpDir, 'sketchdraw-update-'));
      const staging = posix.join(posix.dirname(bundle), `${MAC_STAGING_PREFIX}${randomBytes(6).toString('hex')}`);
      const staged = posix.join(staging, posix.basename(bundle));
      let attached = false;
      try {
        await must(runner.run('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount, file], { timeoutMs: 180_000 }), 'Mounting the disk image');
        attached = true;
        const apps = (await readdir(mount)).filter((name) => name.endsWith('.app'));
        if (apps.length !== 1) throw new UpdateError('install', 'The disk image does not hold exactly one app.');
        const source = path.join(mount, apps[0]!);
        const plist = path.join(source, 'Contents', 'Info.plist');
        const read = async (key: string): Promise<string> => (await must(runner.run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist]), `Reading ${key}`)).stdout.trim();
        if (await read('CFBundleIdentifier') !== options.bundleId) throw new UpdateError('install', 'The app in the disk image is not Sketchdraw.');
        if (await read('CFBundleShortVersionString') !== version) throw new UpdateError('install', 'The app in the disk image has a different version than the release.');
        await mkdir(staging, { mode: 0o700 });
        await must(runner.run('/usr/bin/ditto', [source, staged], { timeoutMs: 300_000 }), 'Copying the app');
      } catch (error) {
        await rm(staging, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      } finally {
        if (attached) await runner.run('/usr/bin/hdiutil', ['detach', mount, '-force'], { timeoutMs: 60_000 }).catch(() => undefined);
        await rm(mount, { recursive: true, force: true }).catch(() => undefined);
      }
      return {
        onQuit: () => runner.launch('/bin/sh', ['-c', MAC_SWAP_SCRIPT, 'sketchdraw-update', String(options.pid), bundle, staged, staging, options.failureMarker, version]),
      };
    },

    async cleanUp(): Promise<void> {
      if (!bundle) return;
      const parent = posix.dirname(bundle);
      const names = await readdir(parent).catch(() => [] as string[]);
      await Promise.all(names.filter((name) => name.startsWith(MAC_STAGING_PREFIX)).map((name) => rm(posix.join(parent, name), { recursive: true, force: true }).catch(() => undefined)));
    },
  };
}

/** The installer of the running platform, or null where the app cannot replace itself. */
export function createPlatformInstaller(options: { platform: NodeJS.Platform; execPath: string; pid: number; tmpDir: string; failureMarker: string; bundleId: string; runner?: CommandRunner }): PlatformInstaller | null {
  const runner = options.runner ?? systemRunner;
  if (options.platform === 'win32') return createWindowsInstaller(runner);
  if (options.platform === 'linux') return createLinuxInstaller({ execPath: options.execPath, runner });
  if (options.platform === 'darwin') return createMacInstaller({ execPath: options.execPath, pid: options.pid, runner, tmpDir: options.tmpDir, failureMarker: options.failureMarker, bundleId: options.bundleId });
  return null;
}
