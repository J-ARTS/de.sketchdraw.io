import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { cleanSmokeEnvironment, extractInstaller, withDeadline } from '../../scripts/release-installer-smoke.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'release smoke unit '));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function write(path, text = 'fixture') { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }

test('DMG detach occurs even when copying the actual mounted app fails', t => {
  const directory = fixture(t);
  const calls = [];
  assert.throws(() => extractInstaller({ platformKey: 'mac', installerPath: '/fixture.dmg', directory,
    run(command, args) {
      calls.push([command, ...args]);
      if (command === 'hdiutil' && args[0] === 'attach') mkdirSync(join(directory, 'mounted/Sketchdraw.app'));
      if (command === 'ditto') throw new Error('Copy failed');
      return '';
    } }), /Copy failed/);
  assert.deepEqual(calls.at(-1), ['hdiutil', 'detach', join(directory, 'mounted')]);
});

test('NSIS extraction only selects the actual nested x64 payload and preserves paths with spaces', t => {
  const directory = fixture(t);
  const calls = [];
  const result = extractInstaller({ platformKey: 'win', installerPath: 'C:\\artifacts with spaces\\setup.exe', directory,
    run(command, args) {
      calls.push([command, ...args]);
      if (args[0] === 'x' && args[1].endsWith('setup.exe')) write(join(directory, 'nsis/$PLUGINSDIR/app-64.7z'));
      else if (args[0] === 'x') {
        write(join(directory, 'Installed Sketchdraw/Sketchdraw.exe'));
        mkdirSync(join(directory, 'Installed Sketchdraw/resources'));
      }
      return '';
    } });
  assert.ok(result.executablePath.endsWith(join('Installed Sketchdraw', 'Sketchdraw.exe')));
  assert.ok(calls.some(call => call.includes(`-o${join(directory, 'Installed Sketchdraw')}`)));
  assert.equal(calls.filter(call => call[1] === 't').length, 2, 'Validate both outer installer and nested archive');
});

test('NSIS with no x64 payload and wrong-architecture DEB fail before start', t => {
  const directory = fixture(t);
  assert.throws(() => extractInstaller({ platformKey: 'win', installerPath: 'wrong.exe', directory,
    run() { return ''; } }), /exactly one x64/);
  const other = join(directory, 'other'); mkdirSync(other);
  assert.throws(() => extractInstaller({ platformKey: 'linux', installerPath: 'wrong.deb', directory: other,
    run() { return 'arm64\n'; } }), /amd64/);
});

test('native extraction rejects the previous header-only fake installer at the real production size', t => {
  const directory = fixture(t);
  const bytes = Buffer.alloc(1024 * 1024);
  const platformKey = { darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform];
  assert.ok(platformKey, `Unsupported test platform ${process.platform}`);
  if (platformKey === 'mac') bytes.write('koly', bytes.length - 512);
  else if (platformKey === 'linux') { bytes.write('!<arch>\n'); bytes.write('debian-binary   ', 8); }
  else { bytes.write('MZ'); bytes.writeUInt32LE(128, 60); bytes.write('PE\0\0', 128); bytes.writeUInt16LE(0x14c, 132); }
  const installerPath = join(directory, 'fake-installer'); writeFileSync(installerPath, bytes);
  assert.throws(() => extractInstaller({ platformKey, installerPath, directory }));
});

test('smoke environment excludes inherited runtime overrides and signing credentials', () => {
  const actual = cleanSmokeEnvironment({ PATH: '/path', DISPLAY: ':99', HOME: '/home',
    NODE_OPTIONS: '--require malicious.js', NODE_PATH: '/other', ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_DISABLE_SANDBOX: '1', ELECTRON_NO_ASAR: '1', SKETCHDRAW_DEV_SERVER_URL: 'http://external',
    GH_TOKEN: 'secret', GITHUB_TOKEN: 'secret', CSC_LINK: 'secret', APPLE_ID: 'secret' });
  assert.deepEqual(actual, { PATH: '/path', DISPLAY: ':99', HOME: '/home' });
});

test('bounded smoke operations reject startup failures and timeouts', async () => {
  await assert.rejects(withDeadline(Promise.reject(new Error('Launch failed')), 100, 'launch'), /Launch failed/);
  await assert.rejects(withDeadline(new Promise(() => {}), 5, 'launch'), /launch timed out/);
});
