import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APP_BUNDLE_ID } from '../../electron/branding';
import {
  type CommandResult,
  type CommandRunner,
  createLinuxInstaller,
  createMacInstaller,
  createPlatformInstaller,
  createWindowsInstaller,
  MAC_ATTACH_ATTEMPTS,
  MAC_STAGING_PREFIX,
  MAC_SWAP_SCRIPT,
  macBundlePath,
  systemRunner,
} from '../../electron/update-installers';
import { UpdateError } from '../../electron/update-service';

type Call = { command: string; args: string[] };

function recorder(answer: (call: Call) => Partial<CommandResult> | void = () => undefined): CommandRunner & { runs: Call[]; launches: Call[] } {
  const runs: Call[] = [];
  const launches: Call[] = [];
  return {
    runs,
    launches,
    run: async (command, args) => {
      const call = { command, args: [...args] };
      runs.push(call);
      return { code: 0, stdout: '', stderr: '', ...answer(call) };
    },
    launch: (command, args) => { launches.push({ command, args: [...args] }); },
  };
}

describe('Windows installer', () => {
  it('starts the NSIS installer silently once the app quits and lets it start the new version', async () => {
    const runner = recorder();
    const installer = createWindowsInstaller(runner);
    expect(installer.canInstall()).toBe(true);
    const plan = await installer.install('C:\\Users\\mira\\AppData\\Roaming\\de.sketchdraw.io\\pending-update\\Sketchdraw-0.1.7-windows-x64.exe', '0.1.7');
    expect(plan.relaunch).toBeUndefined();
    expect(runner.launches).toEqual([]);
    plan.onQuit?.();
    expect(runner.launches).toEqual([{ command: 'C:\\Users\\mira\\AppData\\Roaming\\de.sketchdraw.io\\pending-update\\Sketchdraw-0.1.7-windows-x64.exe', args: ['/S', '--updated', '--force-run'] }]);
  });
});

describe('Linux installer', () => {
  const deb = '/home/mira/.config/de.sketchdraw.io/pending-update/Sketchdraw-0.1.7-linux-x64.deb';

  it('only replaces an app the Debian package installed, and only with pkexec and dpkg at hand', () => {
    const all = () => true;
    expect(createLinuxInstaller({ execPath: '/opt/Sketchdraw/de.sketchdraw.io', runner: recorder(), exists: all }).canInstall()).toBe(true);
    expect(createLinuxInstaller({ execPath: '/home/mira/linux-unpacked/de.sketchdraw.io', runner: recorder(), exists: all }).canInstall()).toBe(false);
    expect(createLinuxInstaller({ execPath: '/opt/Sketchdraw/de.sketchdraw.io', runner: recorder(), exists: (file) => !file.endsWith('pkexec') }).canInstall()).toBe(false);
    expect(createLinuxInstaller({ execPath: '/opt/Sketchdraw/de.sketchdraw.io', runner: recorder(), exists: (file) => !file.endsWith('dpkg') }).canInstall()).toBe(false);
  });

  it('installs the package through the system prompt and asks for a restart', async () => {
    const runner = recorder();
    const plan = await createLinuxInstaller({ execPath: '/opt/Sketchdraw/de.sketchdraw.io', runner, exists: () => true }).install(deb, '0.1.7');
    expect(runner.runs).toEqual([{ command: '/usr/bin/pkexec', args: ['/usr/bin/dpkg', '-i', deb] }]);
    expect(plan).toEqual({ relaunch: true });
    expect(runner.launches).toEqual([]);
  });

  it('tells a declined prompt apart from a failed installation', async () => {
    for (const [code, problem] of [[126, 'cancelled'], [127, 'cancelled'], [1, 'install'], [-1, 'install']] as const) {
      const installer = createLinuxInstaller({ execPath: '/opt/Sketchdraw/de.sketchdraw.io', runner: recorder(() => ({ code, stderr: 'dpkg: error' })), exists: () => true });
      await expect(installer.install(deb, '0.1.7')).rejects.toMatchObject({ name: 'UpdateError', problem });
    }
  });
});

describe('macOS bundle path', () => {
  it('is the .app folder around the executable', () => {
    expect(macBundlePath('/Applications/Sketchdraw.app/Contents/MacOS/Sketchdraw')).toBe('/Applications/Sketchdraw.app');
    expect(macBundlePath('/Users/mira/Apps/My Sketchdraw.app/Contents/MacOS/Sketchdraw')).toBe('/Users/mira/Apps/My Sketchdraw.app');
    expect(macBundlePath('/usr/local/bin/sketchdraw')).toBeNull();
    expect(macBundlePath('/Applications/Sketchdraw.app/Contents/Frameworks/Helper')).toBeNull();
  });

  it('allows self-replacement only from a writable place outside disk images and translocation', () => {
    const at = (execPath: string, writable: (file: string) => boolean = () => true) => createMacInstaller({ execPath, pid: 1, runner: recorder(), tmpDir: tmpdir(), failureMarker: '/tmp/failed', bundleId: APP_BUNDLE_ID, writable }).canInstall();
    expect(at('/Applications/Sketchdraw.app/Contents/MacOS/Sketchdraw')).toBe(true);
    expect(at('/Volumes/Sketchdraw 0.1.6-arm64/Sketchdraw.app/Contents/MacOS/Sketchdraw')).toBe(false);
    expect(at('/private/var/folders/ab/T/AppTranslocation/1234/d/Sketchdraw.app/Contents/MacOS/Sketchdraw')).toBe(false);
    expect(at('/Applications/Sketchdraw.app/Contents/MacOS/Sketchdraw', (file) => file !== '/Applications')).toBe(false);
    expect(at('/Applications/Sketchdraw.app/Contents/MacOS/Sketchdraw', (file) => file !== '/Applications/Sketchdraw.app')).toBe(false);
    expect(at('/usr/local/bin/sketchdraw')).toBe(false);
  });
});

describe.skipIf(process.platform === 'win32')('macOS installer steps', () => {
  let root: string;
  let bundle: string;
  let runner: ReturnType<typeof recorder>;
  let image: { identifier: string; version: string; apps: string[] };
  /** What each attach found in the file it was given. */
  let attachedCopies: string[];

  /** Stands in for hdiutil, plutil and ditto: the "disk image" is a folder that attach fills. */
  function macTools(): ReturnType<typeof recorder> {
    return recorder(({ command, args }) => {
      if (command.endsWith('hdiutil') && args[0] === 'attach') {
        const mount = args[args.indexOf('-mountpoint') + 1]!;
        attachedCopies.push(readFileSync(args.at(-1)!, 'utf8'));
        for (const app of image.apps) {
          mkdirSync(join(mount, app, 'Contents', 'MacOS'), { recursive: true });
          writeFileSync(join(mount, app, 'Contents', 'Info.plist'), 'plist');
          writeFileSync(join(mount, app, 'Contents', 'MacOS', 'Sketchdraw'), `new ${image.version}`);
        }
        return;
      }
      if (command.endsWith('plutil')) return { stdout: `${args[1] === 'CFBundleIdentifier' ? image.identifier : image.version}\n` };
      if (command.endsWith('ditto')) cpSync(args[0]!, args[1]!, { recursive: true });
      return;
    });
  }

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'sketchdraw-mac-update-')));
    bundle = join(root, 'Applications', 'Sketchdraw.app');
    mkdirSync(join(bundle, 'Contents', 'MacOS'), { recursive: true });
    writeFileSync(join(bundle, 'Contents', 'MacOS', 'Sketchdraw'), 'old 0.1.6');
    mkdirSync(join(root, 'tmp'));
    // The downloaded files: the installer attaches a private copy of each, so they must exist.
    for (const name of ['x.dmg', 'Sketchdraw-0.1.7-macos-arm64.dmg']) writeFileSync(join(root, name), `disk image ${name}`);
    image = { identifier: APP_BUNDLE_ID, version: '0.1.7', apps: ['Sketchdraw.app'] };
    attachedCopies = [];
    runner = macTools();
  });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  const installer = () => createMacInstaller({ execPath: join(bundle, 'Contents', 'MacOS', 'Sketchdraw'), pid: 4242, runner, tmpDir: join(root, 'tmp'), failureMarker: join(root, 'update-failed'), bundleId: APP_BUNDLE_ID });
  const stagingFolders = () => readdirSync(join(root, 'Applications')).filter((name) => name.startsWith(MAC_STAGING_PREFIX));

  it('mounts the image, checks the bundle, copies it next to the app and swaps it in after the quit', async () => {
    const plan = await installer().install(join(root, 'Sketchdraw-0.1.7-macos-arm64.dmg'), '0.1.7');

    const [attach, identifier, version, ditto, detach] = runner.runs;
    const mount = attach!.args.at(-2)!;
    // The image is attached from a private copy named after the mount folder, never from the downloaded file itself.
    expect(attach).toEqual({ command: '/usr/bin/hdiutil', args: ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount, `${mount}.dmg`] });
    expect(attachedCopies).toEqual(['disk image Sketchdraw-0.1.7-macos-arm64.dmg']);
    expect(mount.startsWith(join(root, 'tmp', 'sketchdraw-update-'))).toBe(true);
    expect(identifier).toEqual({ command: '/usr/bin/plutil', args: ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', join(mount, 'Sketchdraw.app', 'Contents', 'Info.plist')] });
    expect(version!.args[1]).toBe('CFBundleShortVersionString');
    const [staging] = stagingFolders();
    const staged = join(root, 'Applications', staging!, 'Sketchdraw.app');
    expect(ditto).toEqual({ command: '/usr/bin/ditto', args: [join(mount, 'Sketchdraw.app'), staged] });
    expect(detach).toEqual({ command: '/usr/bin/hdiutil', args: ['detach', mount] });
    expect(runner.runs).toHaveLength(5);
    expect(existsSync(mount)).toBe(false);
    // Neither the mount folder nor the private copy is left, and the download is untouched.
    expect(readdirSync(join(root, 'tmp'))).toEqual([]);
    expect(readFileSync(join(root, 'Sketchdraw-0.1.7-macos-arm64.dmg'), 'utf8')).toBe('disk image Sketchdraw-0.1.7-macos-arm64.dmg');
    expect(readFileSync(join(staged, 'Contents', 'MacOS', 'Sketchdraw'), 'utf8')).toBe('new 0.1.7');
    // The running app is untouched until it quits.
    expect(readFileSync(join(bundle, 'Contents', 'MacOS', 'Sketchdraw'), 'utf8')).toBe('old 0.1.6');
    expect(runner.launches).toEqual([]);

    plan.onQuit?.();
    expect(runner.launches).toEqual([{ command: '/bin/sh', args: ['-c', MAC_SWAP_SCRIPT, 'sketchdraw-update', '4242', bundle, staged, join(root, 'Applications', staging!), join(root, 'update-failed'), '0.1.7'] }]);
  });

  it('refuses an image with a foreign app, another version or more than one app, and leaves nothing behind', async () => {
    for (const change of [{ identifier: 'com.example.other' }, { version: '0.1.8' }, { apps: [] }, { apps: ['Sketchdraw.app', 'Other.app'] }]) {
      Object.assign(image, { identifier: APP_BUNDLE_ID, version: '0.1.7', apps: ['Sketchdraw.app'] }, change);
      runner = macTools();
      await expect(installer().install(join(root, 'x.dmg'), '0.1.7')).rejects.toBeInstanceOf(UpdateError);
      expect(stagingFolders()).toEqual([]);
      expect(runner.runs.at(-1)!.args[0]).toBe('detach');
      expect(runner.runs.some((call) => call.command.endsWith('ditto'))).toBe(false);
      expect(readdirSync(join(root, 'tmp'))).toEqual([]);
    }
  });

  it('attaches again while macOS reports the disk image service busy, and gives up after a few attempts (#297)', async () => {
    const busy = { code: 1, stderr: 'hdiutil: attach failed - Resource temporarily unavailable' };
    const patient = (failures: number) => {
      const tools = macTools();
      let attaches = 0;
      const run: CommandRunner['run'] = async (command, args) => {
        if (command.endsWith('hdiutil') && args[0] === 'attach' && (attaches += 1) <= failures) { tools.runs.push({ command, args: [...args] }); return { stdout: '', ...busy }; }
        return tools.run(command, args);
      };
      return { tools, installer: createMacInstaller({ execPath: join(bundle, 'Contents', 'MacOS', 'Sketchdraw'), pid: 4242, runner: { ...tools, run }, tmpDir: join(root, 'tmp'), failureMarker: join(root, 'update-failed'), bundleId: APP_BUNDLE_ID, attachRetryMs: 1 }) };
    };
    const attachCalls = (tools: ReturnType<typeof recorder>) => tools.runs.filter((call) => call.args[0] === 'attach').length;

    const passing = patient(2);
    await passing.installer.install(join(root, 'x.dmg'), '0.1.7');
    expect(attachCalls(passing.tools)).toBe(3);
    expect(stagingFolders()).toHaveLength(1);

    const stuck = patient(MAC_ATTACH_ATTEMPTS);
    await expect(stuck.installer.install(join(root, 'x.dmg'), '0.1.7')).rejects.toMatchObject({ problem: 'install', message: expect.stringContaining('Resource temporarily unavailable') });
    expect(attachCalls(stuck.tools)).toBe(MAC_ATTACH_ATTEMPTS);
    // Nothing was attached, so nothing is detached, and the mount folder is gone.
    expect(stuck.tools.runs.some((call) => call.args[0] === 'detach')).toBe(false);
    expect(readdirSync(join(root, 'tmp'))).toEqual([]);
  });

  it('asks macOS to let go of the image and forces it only when that is refused; a download that is gone fails before anything is attached', async () => {
    const tools = macTools();
    runner = { ...tools, run: async (command, args) => (command.endsWith('hdiutil') && args[0] === 'detach' && !args.includes('-force') ? (tools.runs.push({ command, args: [...args] }), { code: 16, stdout: '', stderr: 'hdiutil: couldn\'t unmount "disk4" - Resource busy' }) : tools.run(command, args)) };
    await installer().install(join(root, 'x.dmg'), '0.1.7');
    const mount = tools.runs[0]!.args.at(-2)!;
    expect(tools.runs.slice(-2).map((call) => call.args)).toEqual([['detach', mount], ['detach', mount, '-force']]);
    expect(readdirSync(join(root, 'tmp'))).toEqual([]);

    const missing = macTools();
    runner = missing;
    await expect(installer().install(join(root, 'not-downloaded.dmg'), '0.1.7')).rejects.toMatchObject({ problem: 'install', message: expect.stringContaining('Preparing the disk image failed') });
    expect(missing.runs).toEqual([]);
    expect(readdirSync(join(root, 'tmp'))).toEqual([]);
  });

  it('reports a failing tool as a failed installation and detaches only what it attached', async () => {
    runner = recorder(({ command, args }) => (command.endsWith('hdiutil') && args[0] === 'attach' ? { code: 1, stderr: 'hdiutil: attach failed - image not recognized' } : undefined));
    await expect(installer().install(join(root, 'x.dmg'), '0.1.7')).rejects.toMatchObject({ problem: 'install' });
    expect(runner.runs).toHaveLength(1);

    const tools = macTools();
    runner = { ...tools, run: async (command, args) => (command.endsWith('ditto') ? { code: 1, stdout: '', stderr: 'ditto: no space left' } : tools.run(command, args)) };
    await expect(installer().install(join(root, 'x.dmg'), '0.1.7')).rejects.toMatchObject({ problem: 'install' });
    expect(stagingFolders()).toEqual([]);
    expect(tools.runs.at(-1)!.args[0]).toBe('detach');
  });

  it('removes what an earlier update left next to the app', async () => {
    mkdirSync(join(root, 'Applications', `${MAC_STAGING_PREFIX}abc123`, 'Sketchdraw.app'), { recursive: true });
    mkdirSync(join(root, 'Applications', 'Other.app'));
    await installer().cleanUp?.();
    expect(readdirSync(join(root, 'Applications')).sort()).toEqual(['Other.app', 'Sketchdraw.app']);
  });

  describe('swap script', () => {
    let staging: string;
    let staged: string;
    let bin: string;

    /** A process id that is certainly gone: the app "has quit". */
    const finishedPid = (): string => String(spawnSync('/bin/sh', ['-c', 'exit 0']).pid);
    const swap = (pid: string): Promise<number> => new Promise((resolve) => {
      execFile('/bin/sh', ['-c', MAC_SWAP_SCRIPT, 'sketchdraw-update', pid, bundle, staged, staging, join(root, 'update-failed'), '0.1.7'], { env: { ...process.env, PATH: `${bin}:${process.env['PATH'] ?? ''}` } }, (error) => {
        resolve(error && typeof error.code === 'number' ? error.code : 0);
      });
    });

    beforeEach(() => {
      staging = join(root, 'Applications', `${MAC_STAGING_PREFIX}feed01`);
      staged = join(staging, 'Sketchdraw.app');
      mkdirSync(join(staged, 'Contents', 'MacOS'), { recursive: true });
      writeFileSync(join(staged, 'Contents', 'MacOS', 'Sketchdraw'), 'new 0.1.7');
      // `open` is the macOS launcher; here it only records what it was asked to start.
      bin = join(root, 'bin');
      mkdirSync(bin);
      writeFileSync(join(bin, 'open'), `#!/bin/sh\nprintf '%s' "$1" > "${join(root, 'opened')}"\n`);
      chmodSync(join(bin, 'open'), 0o755);
    });

    it('replaces the app, removes the old one and starts the new one', async () => {
      expect(await swap(finishedPid())).toBe(0);
      expect(readFileSync(join(bundle, 'Contents', 'MacOS', 'Sketchdraw'), 'utf8')).toBe('new 0.1.7');
      expect(existsSync(staging)).toBe(false);
      expect(existsSync(join(root, 'update-failed'))).toBe(false);
      expect(readFileSync(join(root, 'opened'), 'utf8')).toBe(bundle);
    });

    it('waits until the app has quit', async () => {
      const child = execFile('/bin/sh', ['-c', 'sleep 1']);
      const started = Date.now();
      expect(await swap(String(child.pid))).toBe(0);
      expect(Date.now() - started).toBeGreaterThanOrEqual(700);
      expect(readFileSync(join(bundle, 'Contents', 'MacOS', 'Sketchdraw'), 'utf8')).toBe('new 0.1.7');
    });

    it('puts the old app back, notes the failed version and starts the old app when the new one cannot move in', async () => {
      rmSync(staged, { recursive: true });
      expect(await swap(finishedPid())).toBe(0);
      expect(readFileSync(join(bundle, 'Contents', 'MacOS', 'Sketchdraw'), 'utf8')).toBe('old 0.1.6');
      expect(readFileSync(join(root, 'update-failed'), 'utf8')).toBe('0.1.7');
      expect(readFileSync(join(root, 'opened'), 'utf8')).toBe(bundle);
    });

    it('notes the failed version when the running app cannot be moved aside', async () => {
      rmSync(staging, { recursive: true });
      expect(await swap(finishedPid())).toBe(0);
      expect(readFileSync(join(bundle, 'Contents', 'MacOS', 'Sketchdraw'), 'utf8')).toBe('old 0.1.6');
      expect(readFileSync(join(root, 'update-failed'), 'utf8')).toBe('0.1.7');
    });
  });
});

// The real tools of macOS: a disk image built here goes through the same steps as a release image.
describe.runIf(process.platform === 'darwin')('macOS installer with hdiutil, plutil and ditto', () => {
  let root: string;
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  function buildImage(version: string, identifier = APP_BUNDLE_ID): string {
    const source = join(root, 'image-source');
    const app = join(source, 'Sketchdraw.app', 'Contents');
    rmSync(source, { recursive: true, force: true });
    mkdirSync(join(app, 'MacOS'), { recursive: true });
    writeFileSync(join(app, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${identifier}</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleExecutable</key><string>Sketchdraw</string>
</dict></plist>
`);
    writeFileSync(join(app, 'MacOS', 'Sketchdraw'), `#!/bin/sh\necho ${version}\n`);
    chmodSync(join(app, 'MacOS', 'Sketchdraw'), 0o755);
    const image = join(root, `Sketchdraw-${version}-macos-arm64.dmg`);
    execFileSync('/usr/bin/hdiutil', ['create', '-volname', 'Sketchdraw', '-srcfolder', source, '-ov', '-format', 'UDZO', image], { stdio: 'pipe' });
    return image;
  }

  it('stages the app from a real disk image and swaps it in', async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'sketchdraw-native-update-')));
    const bundle = join(root, 'Applications', 'Sketchdraw.app');
    mkdirSync(join(bundle, 'Contents', 'MacOS'), { recursive: true });
    writeFileSync(join(bundle, 'Contents', 'MacOS', 'Sketchdraw'), 'old');
    mkdirSync(join(root, 'tmp'));
    const launches: Call[] = [];
    const runner: CommandRunner = { run: systemRunner.run, launch: (command, args) => { launches.push({ command, args: [...args] }); } };
    const installer = createMacInstaller({ execPath: join(bundle, 'Contents', 'MacOS', 'Sketchdraw'), pid: 1, runner, tmpDir: join(root, 'tmp'), failureMarker: join(root, 'update-failed'), bundleId: APP_BUNDLE_ID });
    expect(installer.canInstall()).toBe(true);

    await expect(installer.install(buildImage('0.1.7', 'com.example.other'), '0.1.7')).rejects.toMatchObject({ problem: 'install' });
    await expect(installer.install(buildImage('0.1.8'), '0.1.7')).rejects.toMatchObject({ problem: 'install' });
    expect(readdirSync(join(root, 'Applications'))).toEqual(['Sketchdraw.app']);
    expect(readdirSync(join(root, 'tmp'))).toEqual([]);

    const plan = await installer.install(buildImage('0.1.7'), '0.1.7');
    expect(readdirSync(join(root, 'tmp'))).toEqual([]);
    plan.onQuit?.();
    expect(launches).toHaveLength(1);
    const [, script, name, , target, staged, staging, marker, version] = launches[0]!.args;
    expect(execFileSync(join(staged!, 'Contents', 'MacOS', 'Sketchdraw'), { encoding: 'utf8' }).trim()).toBe('0.1.7');

    const bin = join(root, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'open'), `#!/bin/sh\nprintf '%s' "$1" > "${join(root, 'opened')}"\n`);
    chmodSync(join(bin, 'open'), 0o755);
    const gone = String(spawnSync('/bin/sh', ['-c', 'exit 0']).pid);
    execFileSync('/bin/sh', ['-c', script!, name!, gone, target!, staged!, staging!, marker!, version!], { env: { ...process.env, PATH: `${bin}:${process.env['PATH'] ?? ''}` } });
    expect(execFileSync(join(bundle, 'Contents', 'MacOS', 'Sketchdraw'), { encoding: 'utf8' }).trim()).toBe('0.1.7');
    expect(readdirSync(join(root, 'Applications'))).toEqual(['Sketchdraw.app']);
    expect(existsSync(join(root, 'update-failed'))).toBe(false);
    expect(readFileSync(join(root, 'opened'), 'utf8')).toBe(bundle);
  }, 120_000);
});

describe('platform choice', () => {
  it('has an installer for the three desktop platforms and none elsewhere', () => {
    const base = { execPath: '/opt/Sketchdraw/de.sketchdraw.io', pid: 1, tmpDir: tmpdir(), failureMarker: '/tmp/failed', bundleId: APP_BUNDLE_ID, runner: recorder() };
    for (const platform of ['win32', 'linux', 'darwin'] as const) expect(createPlatformInstaller({ ...base, platform })).not.toBeNull();
    expect(createPlatformInstaller({ ...base, platform: 'freebsd' })).toBeNull();
  });
});
