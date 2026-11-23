import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { brandDevElectron } from '../../scripts/brand-dev-electron.mjs';
import { runDevelopmentSession } from '../../scripts/dev-electron.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ICON = path.join(ROOT, 'build', 'icon.icns');

/** A folder that looks like the Electron bundle of node_modules, and stand-ins for plutil and codesign. */
function fakeBundle(t, { failOn } = {}) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'sketchdraw-brand-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bundle = path.join(root, 'dist', 'Electron.app');
  mkdirSync(path.join(bundle, 'Contents', 'MacOS'), { recursive: true });
  mkdirSync(path.join(bundle, 'Contents', 'Resources'));
  const plist = path.join(bundle, 'Contents', 'Info.plist');
  const icon = path.join(bundle, 'Contents', 'Resources', 'electron.icns');
  writeFileSync(plist, 'CFBundleName=Electron');
  writeFileSync(icon, 'electron icon');
  const calls = [];
  const run = (command, args) => {
    calls.push([path.basename(command), ...args.filter((arg) => arg !== plist && arg !== bundle)].join(' '));
    if (failOn && command.endsWith(failOn)) throw new Error(`${failOn}: not permitted`);
    if (command.endsWith('plutil') && args[0] === '-extract') return 'electron.icns\n';
    if (command.endsWith('plutil') && args[0] === '-replace') writeFileSync(plist, `${readFileSync(plist, 'utf8')};${args[1]}=${args[3]}`);
    return '';
  };
  const warnings = [];
  const options = { electronBinary: path.join(bundle, 'Contents', 'MacOS', 'Electron'), iconPath: ICON, platform: 'darwin', run, warn: (message) => warnings.push(message) };
  return { bundle, plist, icon, marker: path.join(root, 'dist', '.sketchdraw-dev-brand'), calls, warnings, options };
}

test('gives the development bundle the Sketchdraw name and icon and signs it again', (t) => {
  const state = fakeBundle(t);
  assert.equal(brandDevElectron(state.options), 'branded');
  assert.deepEqual(state.calls, [
    'plutil -extract CFBundleIconFile raw -o -',
    'plutil -replace CFBundleName -string Sketchdraw',
    'plutil -replace CFBundleDisplayName -string Sketchdraw',
    'codesign --force --deep --sign -',
  ]);
  assert.equal(readFileSync(state.plist, 'utf8'), 'CFBundleName=Electron;CFBundleName=Sketchdraw;CFBundleDisplayName=Sketchdraw');
  assert.deepEqual(readFileSync(state.icon), readFileSync(ICON));
  assert.equal(existsSync(state.marker), true);

  // The next start finds the bundle done and touches nothing.
  state.calls.length = 0;
  assert.equal(brandDevElectron(state.options), 'current');
  assert.deepEqual(state.calls, []);
  assert.deepEqual(state.warnings, []);
});

test('brands again after Electron was reinstalled or the icon changed', (t) => {
  const state = fakeBundle(t);
  brandDevElectron(state.options);
  rmSync(state.marker);
  assert.equal(brandDevElectron(state.options), 'branded');
  writeFileSync(state.marker, 'Sketchdraw\nhash of an older icon\n');
  assert.equal(brandDevElectron(state.options), 'branded');
});

test('puts the bundle back and lets the start go on when a tool fails', (t) => {
  for (const failOn of ['codesign', 'plutil']) {
    const state = fakeBundle(t, { failOn });
    assert.equal(brandDevElectron(state.options), 'failed');
    assert.equal(readFileSync(state.plist, 'utf8'), 'CFBundleName=Electron');
    assert.equal(readFileSync(state.icon, 'utf8'), 'electron icon');
    assert.equal(existsSync(state.marker), false);
    assert.equal(state.warnings.length, 1);
    assert.match(state.warnings[0], /keeps its own name and icon: .*not permitted/);
  }
});

test('does nothing outside macOS and for an executable that is not inside an app bundle', (t) => {
  const state = fakeBundle(t);
  for (const platform of ['win32', 'linux']) assert.equal(brandDevElectron({ ...state.options, platform }), 'skipped');
  assert.equal(brandDevElectron({ ...state.options, electronBinary: 'C:/Electron path/Electron.exe' }), 'skipped');
  assert.equal(brandDevElectron({ ...state.options, electronBinary: undefined }), 'skipped');
  assert.equal(brandDevElectron({ ...state.options, iconPath: path.join(state.bundle, 'missing.icns') }), 'skipped');
  assert.deepEqual(state.calls, []);
  assert.equal(readFileSync(state.plist, 'utf8'), 'CFBundleName=Electron');
});

test('the development start brands the bundle before it launches Electron', async (t) => {
  const order = [];
  const closed = [];
  const server = { listen: async () => undefined, close: async () => { closed.push(true); }, httpServer: { address: () => ({ port: 5173 }) } };
  const code = await runDevelopmentSession({
    buildBundles: async () => undefined,
    createServer: async () => server,
    resolveElectronExecutable: async () => '/project/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
    brandElectron: async (executable) => { order.push(`brand ${executable}`); },
    spawnProcess: () => { order.push('launch'); return spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' }); },
  });
  assert.equal(code, 0);
  assert.deepEqual(order, ['brand /project/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron', 'launch']);
  assert.equal(closed.length, 1);
  t.diagnostic('branding runs once per start, before the launch');
});

// The real tools on the real Electron bundle (a copy): the branded bundle must still verify and start. A development
// start brands the installed bundle in place, so the copy may already carry the Sketchdraw name (#271). The test puts
// the copy into each starting state itself and never touches the installed bundle.
test('a copy of the installed Electron bundle is branded, keeps a valid signature and still starts', { skip: process.platform !== 'darwin', timeout: 240_000 }, async (t) => {
  const electronBinary = (await import('electron')).default;
  const original = path.resolve(electronBinary, '../../..');
  const originalPlist = readFileSync(path.join(original, 'Contents', 'Info.plist'));
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'sketchdraw-brand-native-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bundle = path.join(root, 'dist', 'Electron.app');
  mkdirSync(path.dirname(bundle));
  execFileSync('/usr/bin/ditto', [original, bundle]);
  const binary = path.join(bundle, 'Contents', 'MacOS', 'Electron');
  const plist = path.join(bundle, 'Contents', 'Info.plist');
  const marker = path.join(root, 'dist', '.sketchdraw-dev-brand');
  const read = (key) => execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist], { encoding: 'utf8' }).trim();
  const iconTarget = path.join(bundle, 'Contents', 'Resources', read('CFBundleIconFile'));
  const foreignIcon = Buffer.from('an icon that is not the Sketchdraw icon');
  /** The state a bundle is in before a start: the name it carries, an icon that is not ours, and no marker. */
  const startFrom = (name) => {
    for (const key of ['CFBundleName', 'CFBundleDisplayName']) execFileSync('/usr/bin/plutil', ['-replace', key, '-string', name, plist]);
    writeFileSync(iconTarget, foreignIcon);
    rmSync(marker, { force: true });
  };
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  // 'Electron': a fresh installation. 'Sketchdraw': a bundle an earlier development start branded, reinstalled icon.
  for (const name of ['Electron', 'Sketchdraw']) {
    startFrom(name);
    assert.equal(read('CFBundleName'), name);
    const warnings = [];
    assert.equal(brandDevElectron({ electronBinary: binary, iconPath: ICON, warn: (message) => warnings.push(message) }), 'branded', warnings.join('\n'));
    assert.equal(read('CFBundleName'), 'Sketchdraw');
    assert.equal(read('CFBundleDisplayName'), 'Sketchdraw');
    assert.deepEqual(readFileSync(iconTarget), readFileSync(ICON));
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'pipe' });
    const version = execFileSync(binary, ['--version'], { encoding: 'utf8', timeout: 120_000, env }).trim();
    assert.match(version, /^v\d+\.\d+\.\d+/);
    assert.equal(brandDevElectron({ electronBinary: binary, iconPath: ICON }), 'current');
  }
  assert.deepEqual(readFileSync(path.join(original, 'Contents', 'Info.plist')), originalPlist, 'the installed bundle is left as it was');
});
