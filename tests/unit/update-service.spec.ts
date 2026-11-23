import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '../../src/domain/updates';
import {
  CHECK_INTERVAL_MS,
  compareVersions,
  type FetchLike,
  FIRST_CHECK_DELAY_MS,
  installerAssetName,
  type InstallPlan,
  LATEST_RELEASE_API_URL,
  parseLatestRelease,
  parseVersion,
  type PlatformInstaller,
  UpdateError,
  UpdateService,
} from '../../electron/update-service';

const INSTALLER = Buffer.from('a verified installer '.repeat(4096));
const SHA256 = createHash('sha256').update(INSTALLER).digest('hex');

/** The answer of `releases/latest`, shaped like the published v0.1.6 release. */
function release(version: string, overrides: { digest?: string | null; size?: number; url?: string; extra?: Record<string, unknown> } = {}): Record<string, unknown> {
  const asset = (suffix: string) => ({
    name: `Sketchdraw-${version}-${suffix}`,
    size: overrides.size ?? INSTALLER.byteLength,
    digest: overrides.digest === undefined ? `sha256:${SHA256}` : overrides.digest,
    content_type: 'application/octet-stream',
    browser_download_url: overrides.url ?? `https://github.com/J-ARTS/de.sketchdraw.io/releases/download/v${version}/Sketchdraw-${version}-${suffix}`,
  });
  return {
    tag_name: `v${version}`,
    name: `Sketchdraw v${version}`,
    draft: false,
    prerelease: false,
    html_url: `https://github.com/J-ARTS/de.sketchdraw.io/releases/tag/v${version}`,
    assets: [asset('linux-x64.deb'), asset('macos-arm64.dmg'), asset('windows-x64.exe')],
    ...overrides.extra,
  };
}

describe('versions and release answers', () => {
  it('reads plain versions only', () => {
    expect(parseVersion('0.1.6')).toEqual([0, 1, 6]);
    expect(parseVersion('12.0.34')).toEqual([12, 0, 34]);
    for (const text of ['v0.1.6', '0.1', '0.1.6-beta.1', '0.1.6+build', '1.2.3.4', ' 0.1.6', '', null, 16, '1.2.x']) expect(parseVersion(text)).toBeNull();
  });

  it('orders versions by number, not by text', () => {
    expect(compareVersions([0, 1, 10], [0, 1, 9])).toBe(1);
    expect(compareVersions([0, 2, 0], [0, 10, 0])).toBe(-1);
    expect(compareVersions([1, 0, 0], [0, 99, 99])).toBe(1);
    expect(compareVersions([0, 1, 6], [0, 1, 6])).toBe(0);
  });

  it('names the installer the release workflow publishes for each platform', () => {
    expect(installerAssetName('0.1.7', 'win32', 'x64')).toBe('Sketchdraw-0.1.7-windows-x64.exe');
    expect(installerAssetName('0.1.7', 'darwin', 'arm64')).toBe('Sketchdraw-0.1.7-macos-arm64.dmg');
    expect(installerAssetName('0.1.7', 'linux', 'x64')).toBe('Sketchdraw-0.1.7-linux-x64.deb');
    expect(installerAssetName('0.1.7', 'darwin', 'x64')).toBeNull();
    expect(installerAssetName('0.1.7', 'linux', 'arm64')).toBeNull();
  });

  it('takes version, size and checksum of the installer for this platform', () => {
    expect(parseLatestRelease(release('0.1.7'), 'darwin', 'arm64')).toEqual({
      version: '0.1.7',
      asset: {
        name: 'Sketchdraw-0.1.7-macos-arm64.dmg',
        url: 'https://github.com/J-ARTS/de.sketchdraw.io/releases/download/v0.1.7/Sketchdraw-0.1.7-macos-arm64.dmg',
        size: INSTALLER.byteLength,
        sha256: SHA256,
      },
    });
  });

  it('offers no installer without a checksum, with a foreign address or an implausible size', () => {
    for (const overrides of [
      { digest: null },
      { digest: 'md5:abc' },
      { digest: `sha256:${SHA256.toUpperCase()}` },
      { url: 'https://example.com/Sketchdraw-0.1.7-macos-arm64.dmg' },
      { url: 'https://github.com/someone/else/releases/download/v0.1.7/Sketchdraw-0.1.7-macos-arm64.dmg' },
      { size: 0 },
      { size: 2 * 1024 * 1024 * 1024 },
      { size: 1.5 },
    ]) expect(parseLatestRelease(release('0.1.7', overrides), 'darwin', 'arm64')).toEqual({ version: '0.1.7', asset: null });
    expect(parseLatestRelease(release('0.1.7'), 'darwin', 'x64')).toEqual({ version: '0.1.7', asset: null });
    expect(parseLatestRelease({ ...release('0.1.7'), assets: 'none' }, 'linux', 'x64')).toEqual({ version: '0.1.7', asset: null });
  });

  it('rejects drafts, pre-releases and tags that are not versions', () => {
    for (const payload of [
      release('0.1.7', { extra: { draft: true } }),
      release('0.1.7', { extra: { prerelease: true } }),
      release('0.1.7', { extra: { tag_name: '0.1.7' } }),
      release('0.1.7', { extra: { tag_name: 'v0.1.7-rc.1' } }),
      release('0.1.7', { extra: { tag_name: 'v../../etc' } }),
      null,
      [],
      'v0.1.7',
    ]) expect(() => parseLatestRelease(payload, 'linux', 'x64')).toThrow(UpdateError);
  });
});

describe('UpdateService', () => {
  let directory: string;
  let statuses: UpdateStatus[];
  let quits: InstallPlan[];
  let requests: string[];

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'sketchdraw-update-test-'));
    statuses = [];
    quits = [];
    requests = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    rmSync(directory, { recursive: true, force: true });
  });

  const json = (payload: unknown, status = 200): Response => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

  /** Answers the release question with `latest` and the download with `body`. */
  function network(latest: () => Response, body: () => Response = () => new Response(INSTALLER)): FetchLike {
    return async (url) => {
      requests.push(url);
      return url === LATEST_RELEASE_API_URL ? latest() : body();
    };
  }

  function installer(overrides: Partial<PlatformInstaller> = {}): PlatformInstaller & { files: Array<{ file: string; version: string; bytes: Buffer }> } {
    const files: Array<{ file: string; version: string; bytes: Buffer }> = [];
    return {
      files,
      canInstall: () => true,
      install: async (file, version) => { files.push({ file, version, bytes: readFileSync(file) }); return { relaunch: true }; },
      ...overrides,
    };
  }

  function service(fetch: FetchLike, options: { packaged?: boolean; version?: string; installer?: PlatformInstaller | null; platform?: NodeJS.Platform; arch?: string } = {}): UpdateService {
    return new UpdateService({
      currentVersion: options.version ?? '0.1.6',
      platform: options.platform ?? 'linux',
      arch: options.arch ?? 'x64',
      packaged: options.packaged ?? true,
      settingsPath: join(directory, 'updates.json'),
      downloadDir: join(directory, 'pending-update'),
      failureMarker: join(directory, 'update-failed'),
      fetch,
      installer: options.installer === undefined ? installer() : options.installer,
      emit: (status) => { statuses.push(status); },
      quit: (plan) => { quits.push(plan); },
    });
  }

  it('finds a newer release and says that this installation can install it', async () => {
    const updates = service(network(() => json(release('0.1.7'))));
    expect(updates.status()).toMatchObject({ supported: true, phase: 'idle', currentVersion: '0.1.6', latestVersion: null, autoCheck: true });
    const status = await updates.check();
    expect(status).toMatchObject({ phase: 'available', latestVersion: '0.1.7', canInstall: true, problem: null });
    expect(statuses.map((entry) => entry.phase)).toEqual(['checking', 'available']);
    expect(updates.shouldPrompt()).toBe(true);
  });

  it('treats the same and an older release as up to date', async () => {
    for (const latest of ['0.1.6', '0.1.5', '0.0.99']) {
      const status = await service(network(() => json(release(latest)))).check();
      expect(status).toMatchObject({ phase: 'current', latestVersion: latest, canInstall: true });
    }
    const updates = service(network(() => json(release('0.1.6'))));
    await updates.check();
    expect(await updates.install()).toMatchObject({ phase: 'current' });
    expect(requests.every((url) => url === LATEST_RELEASE_API_URL)).toBe(true);
    expect(quits).toEqual([]);
  });

  it('reports an unreachable GitHub, a refused request and an unreadable answer as problems', async () => {
    expect(await service(async () => { throw new Error('offline'); }).check()).toMatchObject({ phase: 'error', problem: 'network' });
    expect(await service(network(() => json({ message: 'API rate limit exceeded' }, 403))).check()).toMatchObject({ phase: 'error', problem: 'network' });
    expect(await service(network(() => new Response('<html>', { status: 200 }))).check()).toMatchObject({ phase: 'error', problem: 'release' });
    expect(await service(network(() => json({ tag_name: 'nightly' }))).check()).toMatchObject({ phase: 'error', problem: 'release' });
  });

  it('never asks GitHub when started from the sources', async () => {
    vi.useFakeTimers();
    const updates = service(network(() => json(release('9.9.9'))), { packaged: false });
    updates.start(() => { throw new Error('must not be called'); });
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 2);
    expect(await updates.check()).toMatchObject({ supported: false, canInstall: false, phase: 'idle' });
    expect(await updates.install()).toMatchObject({ phase: 'idle' });
    expect(requests).toEqual([]);
    updates.dispose();
  });

  it('looks at GitHub for a start from the sources only when the menu asks, and never installs there (#299)', async () => {
    const updates = service(network(() => json(release('9.9.9'))), { packaged: false });
    const status = await updates.check({ manual: true });
    expect(status).toMatchObject({ supported: false, canInstall: false, phase: 'available', latestVersion: '9.9.9' });
    expect(requests).toHaveLength(1);
    expect(await updates.install()).toMatchObject({ phase: 'available' });
    expect(quits).toEqual([]);
    expect(await service(network(() => json(release('0.1.6'))), { packaged: false }).check({ manual: true })).toMatchObject({ supported: false, phase: 'current' });
    // A copy without a readable version has nothing to compare with.
    const unversioned = service(network(() => json(release('9.9.9'))), { packaged: false, version: 'dev' });
    const before = requests.length;
    expect(await unversioned.check({ manual: true })).toMatchObject({ supported: false, phase: 'idle' });
    expect(requests).toHaveLength(before);
  });

  it('downloads the installer, verifies it and hands it to the platform before quitting', async () => {
    const platform = installer();
    const updates = service(network(() => json(release('0.1.7'))), { installer: platform });
    await updates.check();
    const status = await updates.install();

    expect(status).toMatchObject({ phase: 'ready', latestVersion: '0.1.7', problem: null });
    expect(requests).toEqual([LATEST_RELEASE_API_URL, 'https://github.com/J-ARTS/de.sketchdraw.io/releases/download/v0.1.7/Sketchdraw-0.1.7-linux-x64.deb']);
    expect(platform.files).toHaveLength(1);
    expect(platform.files[0]).toMatchObject({ file: join(directory, 'pending-update', 'Sketchdraw-0.1.7-linux-x64.deb'), version: '0.1.7' });
    expect(platform.files[0]!.bytes.equals(INSTALLER)).toBe(true);
    expect(quits).toEqual([{ relaunch: true }]);
    const phases = statuses.map((entry) => entry.phase);
    expect(phases.filter((phase, index) => phase !== phases[index - 1])).toEqual(['checking', 'available', 'downloading', 'installing', 'ready']);
    expect(statuses.filter((entry) => entry.phase === 'downloading').at(-1)?.progress).toBe(1);
    // Nothing is checked or installed a second time while the app waits to quit.
    expect(await updates.check()).toMatchObject({ phase: 'ready' });
    expect(await updates.install()).toMatchObject({ phase: 'ready' });
    expect(platform.files).toHaveLength(1);
  });

  it('discards a download whose content does not match the checksum of the release', async () => {
    const platform = installer();
    const tampered = Buffer.from(INSTALLER);
    tampered[100] = tampered[100]! ^ 0xff;
    const updates = service(network(() => json(release('0.1.7')), () => new Response(tampered)), { installer: platform });
    await updates.check();
    expect(await updates.install()).toMatchObject({ phase: 'error', problem: 'checksum' });
    expect(platform.files).toEqual([]);
    expect(quits).toEqual([]);
    expect(existsSync(join(directory, 'pending-update'))).toBe(false);
  });

  it('discards a download that is shorter or longer than the release states', async () => {
    for (const body of [INSTALLER.subarray(0, INSTALLER.byteLength - 1), Buffer.concat([INSTALLER, Buffer.from('x')])]) {
      const platform = installer();
      const updates = service(network(() => json(release('0.1.7')), () => new Response(body)), { installer: platform });
      await updates.check();
      expect(await updates.install()).toMatchObject({ phase: 'error', problem: 'checksum' });
      expect(platform.files).toEqual([]);
      expect(existsSync(join(directory, 'pending-update'))).toBe(false);
    }
  });

  it('reports a failed download and a download that leaves HTTPS as a network problem', async () => {
    const failing = service(network(() => json(release('0.1.7')), () => new Response('gone', { status: 404 })));
    await failing.check();
    expect(await failing.install()).toMatchObject({ phase: 'error', problem: 'network' });

    const insecure = new Response(INSTALLER);
    Object.defineProperty(insecure, 'url', { value: 'http://mirror.example/Sketchdraw.deb' });
    const redirected = service(network(() => json(release('0.1.7')), () => insecure));
    await redirected.check();
    expect(await redirected.install()).toMatchObject({ phase: 'error', problem: 'network' });
    expect(quits).toEqual([]);
  });

  it('passes on why the platform installer stopped and keeps the app running', async () => {
    for (const [error, problem] of [[new UpdateError('cancelled', 'declined'), 'cancelled'], [new UpdateError('install', 'dpkg failed'), 'install'], [new Error('unexpected'), 'install']] as const) {
      const updates = service(network(() => json(release('0.1.7'))), { installer: installer({ install: async () => { throw error; } }) });
      await updates.check();
      expect(await updates.install()).toMatchObject({ phase: 'error', problem });
      expect(quits).toEqual([]);
      expect(existsSync(join(directory, 'pending-update'))).toBe(false);
      // A new check offers the version again.
      expect(await updates.check()).toMatchObject({ phase: 'available', problem: null });
    }
  });

  it('only points to the release page where the installation cannot replace itself', async () => {
    for (const options of [{ installer: null }, { installer: installer({ canInstall: () => false }) }, { platform: 'darwin' as const, arch: 'x64' }]) {
      const updates = service(network(() => json(release('0.1.7'))), options);
      expect(await updates.check()).toMatchObject({ phase: 'available', canInstall: false });
      expect(await updates.install()).toMatchObject({ phase: 'available' });
    }
    const unchecked = service(network(() => json(release('0.1.7', { digest: null }))));
    expect(await unchecked.check()).toMatchObject({ phase: 'available', canInstall: false });
    expect(requests.filter((url) => url !== LATEST_RELEASE_API_URL)).toEqual([]);
  });

  it('answers a second check with the result of the running one', async () => {
    const updates = service(network(() => json(release('0.1.7'))));
    const [first, second] = await Promise.all([updates.check(), updates.check()]);
    expect(first).toEqual(second);
    expect(requests).toEqual([LATEST_RELEASE_API_URL]);
  });

  it('remembers the automatic check and "later" across restarts', async () => {
    const first = service(network(() => json(release('0.1.7'))));
    expect((await first.setAutoCheck(false)).autoCheck).toBe(false);
    await first.check();
    await first.dismissAvailable();
    expect(first.shouldPrompt()).toBe(false);

    const second = service(network(() => json(release('0.1.7'))));
    expect(second.status().autoCheck).toBe(false);
    await second.check();
    expect(second.shouldPrompt()).toBe(false);

    const third = service(network(() => json(release('0.1.8'))));
    await third.check();
    expect(third.shouldPrompt()).toBe(true);
  });

  it('falls back to the defaults when the stored settings are unreadable', () => {
    writeFileSync(join(directory, 'updates.json'), '{ not json');
    expect(service(network(() => json(release('0.1.7')))).status().autoCheck).toBe(true);
    writeFileSync(join(directory, 'updates.json'), JSON.stringify({ autoCheck: 'no', dismissedVersion: '../x' }));
    expect(service(network(() => json(release('0.1.7')))).status().autoCheck).toBe(true);
  });

  it('checks shortly after the start and then every few hours, unless switched off', async () => {
    vi.useFakeTimers();
    const heard: UpdateStatus[] = [];
    const updates = service(network(() => json(release('0.1.7'))));
    updates.start((status) => { heard.push(status); });
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS - 1);
    expect(requests).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(requests).toHaveLength(1);
    expect(heard.at(-1)).toMatchObject({ phase: 'available', latestVersion: '0.1.7' });
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(requests).toHaveLength(2);

    await updates.setAutoCheck(false);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 3);
    expect(requests).toHaveLength(2);
    updates.dispose();
    await updates.setAutoCheck(true);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 3);
    expect(requests).toHaveLength(2);
  });

  it('reports an installation that failed after the last quit and does not offer that version again at the start', async () => {
    vi.useFakeTimers();
    writeFileSync(join(directory, 'update-failed'), '0.1.7');
    const heard: UpdateStatus[] = [];
    const cleaned = vi.fn(async () => undefined);
    const updates = service(network(() => json(release('0.1.7'))), { installer: installer({ cleanUp: cleaned }) });
    updates.start((status) => { heard.push(status); });
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ phase: 'error', problem: 'install' });
    expect(existsSync(join(directory, 'update-failed'))).toBe(false);
    expect(cleaned).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    expect(heard.at(-1)).toMatchObject({ phase: 'available', latestVersion: '0.1.7' });
    expect(updates.shouldPrompt()).toBe(false);
    updates.dispose();
  });
});
