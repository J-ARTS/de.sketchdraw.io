import assert from 'node:assert/strict';
import { installCiSandboxProfile } from './linux-sandbox.mjs';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeSha256, inspectBinaryFile, RELEASE_TARGETS } from './release.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REQUIRED_BUNDLES = ['dist/index.html', 'dist-electron/main.cjs', 'dist-electron/preload.cjs', 'dist-mcp/server.cjs'];
export const EXPECTED_MCP_TOOLS = ['sketchdraw_read_document', 'sketchdraw_find_elements', 'sketchdraw_analyze_document', 'sketchdraw_apply_commands', 'sketchdraw_read_code', 'sketchdraw_apply_code'];

export function cleanSmokeEnvironment(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key, value]) => typeof value === 'string' &&
    !/^(ELECTRON_RUN_AS_NODE|ELECTRON_NO_ASAR|ELECTRON_DISABLE_SANDBOX|NODE_OPTIONS|NODE_PATH|SKETCHDRAW_.*|GH_TOKEN|GITHUB_TOKEN|CSC_.*|WIN_CSC_.*|APPLE_.*)$/i.test(key)));
}

export function runSmokeCommand(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000, maxBuffer: 1024 * 1024, ...options });
}

function contained(rootPath, candidate) {
  const path = realpathSync(candidate);
  const canonicalRoot = realpathSync(rootPath);
  const rel = relative(canonicalRoot, path);
  if (rel.startsWith(`..${sep}`) || rel === '..' || resolve(canonicalRoot, rel) !== path) throw new Error('Extracted path escapes smoke directory.');
  return path;
}

function findFiles(directory, wanted, found = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) findFiles(path, wanted, found);
    else if (entry.isFile() && wanted.has(entry.name)) found.push(path);
  }
  return found;
}

// Only this invocation's temporary paths are touched. No registry installation or security overrides.
export function extractInstaller({ platformKey, installerPath, directory, run = runSmokeCommand }) {
  const destination = join(directory, 'Installed Sketchdraw');
  mkdirSync(destination);
  if (platformKey === 'mac') {
    const mount = join(directory, 'mounted');
    mkdirSync(mount);
    run('hdiutil', ['verify', installerPath]);
    let mounted = false;
    try {
      run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, installerPath]);
      mounted = true;
      const apps = readdirSync(mount, { withFileTypes: true }).filter(e => e.isDirectory() && e.name.endsWith('.app'));
      assert.equal(apps.length, 1, 'DMG must contain exactly one application bundle');
      run('ditto', [join(mount, apps[0].name), join(destination, 'Sketchdraw.app')]);
    } finally {
      if (mounted) run('hdiutil', ['detach', mount]);
    }
    return { executablePath: contained(directory, join(destination, 'Sketchdraw.app/Contents/MacOS/Sketchdraw')),
      resourcesPath: contained(directory, join(destination, 'Sketchdraw.app/Contents/Resources')) };
  }
  if (platformKey === 'win') {
    const sevenZip = join(process.env.ProgramFiles ?? 'C:\\Program Files', '7-Zip', '7z.exe');
    const outer = join(directory, 'nsis');
    mkdirSync(outer);
    run(sevenZip, ['t', installerPath]);
    run(sevenZip, ['x', installerPath, `-o${outer}`, '-y']);
    const payloads = findFiles(outer, new Set(['app-64.7z', 'app-64.zip']));
    assert.equal(payloads.length, 1, 'NSIS must contain exactly one x64 app payload');
    run(sevenZip, ['t', payloads[0]]);
    run(sevenZip, ['x', payloads[0], `-o${destination}`, '-y']);
    return { executablePath: contained(directory, join(destination, 'Sketchdraw.exe')),
      resourcesPath: contained(directory, join(destination, 'resources')) };
  }
  if (platformKey === 'linux') {
    assert.equal(run('dpkg-deb', ['--field', installerPath, 'Architecture']).trim(), 'amd64');
    run('dpkg-deb', ['--info', installerPath]);
    run('dpkg-deb', ['--extract', installerPath, destination]);
    const candidates = findFiles(destination, new Set(['de.sketchdraw.io', 'sketchdraw', 'Sketchdraw']))
      .filter(path => existsSync(join(dirname(path), 'resources/app.asar')));
    assert.equal(candidates.length, 1, 'DEB must contain exactly one executable with app resources');
    return { executablePath: contained(directory, candidates[0]),
      resourcesPath: contained(directory, join(dirname(candidates[0]), 'resources')) };
  }
  throw new Error(`Unsupported installer platform: ${platformKey}`);
}

export async function withDeadline(promise, milliseconds, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds);
  })]); } finally { clearTimeout(timer); }
}

export async function smokeMcpCli({ executablePath, adapterPath, cwd }) {
  // The SDK, not a hand-written JSON-RPC handshake, drives the actual shipped adapter.
  const { Client } = await import('@modelcontextprotocol/client');
  const { StdioClientTransport } = await import('@modelcontextprotocol/client/stdio');
  const client = new Client({ name: 'sketchdraw-installer-smoke', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: executablePath, args: [adapterPath], cwd,
    env: { ...cleanSmokeEnvironment(), ELECTRON_RUN_AS_NODE: '1' }, stderr: 'pipe', maxBufferSize: 40 * 1024 * 1024 });
  let stderrBytes = 0;
  transport.stderr?.on('data', chunk => { stderrBytes += chunk.length; }); // Never report capabilities or documents.
  try {
    await withDeadline(client.connect(transport), 20_000, 'Packaged MCP initialize');
    const result = await withDeadline(client.listTools(), 10_000, 'Packaged MCP tools/list');
    assert.deepEqual(result.tools.map(tool => tool.name).sort(), [...EXPECTED_MCP_TOOLS].sort());
    const denied = await withDeadline(client.callTool({ name: 'sketchdraw_read_document',
      arguments: { documentId: 'smoke' } }), 10_000, 'Packaged MCP access without grant');
    assert.equal(denied.isError, true);
    assert.deepEqual(Object.keys(denied.structuredContent ?? {}), ['error']);
    assert.equal(denied.structuredContent.error.code, 'ACCESS_DENIED');
    return { initialized: true, deniedWithoutGrant: true, tools: result.tools.map(tool => tool.name).sort(), stderrBytes };
  } finally {
    await withDeadline(client.close(), 5_000, 'Packaged MCP close');
  }
}

async function stopElectron(app) {
  const child = app.process();
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  // Test-driver shutdown of its own app only; no product close/save behavior is replaced during checks.
  await withDeadline(app.evaluate(({ app }) => app.exit(0)), 2_000, 'Smoke app exit').catch(() => {});
  await withDeadline(app.close(), 2_000, 'Smoke driver close').catch(() => {});
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    if (exited()) return;
    const stopped = new Promise(resolve => child.once('exit', resolve));
    child.kill(signal);
    await withDeadline(stopped, 2_000, 'Smoke child shutdown').catch(() => {});
  }
  if (!exited()) throw new Error('Packaged smoke process did not exit.');
}

export async function smokeInstalledApp({ executablePath, resourcesPath, directory, version, arch, env,
  run = runSmokeCommand }) {
  const archive = join(resourcesPath, 'app.asar');
  const adapterPath = join(archive, 'dist-mcp/server.cjs');
  const probe = `const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const archive=process.argv[1],files=JSON.parse(process.argv[2]);
const result={version:JSON.parse(fs.readFileSync(path.join(archive,'package.json'),'utf8')).version,arch:process.arch,files:{}};
for(const file of files)result.files[file]=crypto.createHash('sha256').update(fs.readFileSync(path.join(archive,file))).digest('hex');
process.stdout.write(JSON.stringify(result));`;
  const contents = JSON.parse(run(executablePath, ['-e', probe, archive, JSON.stringify(REQUIRED_BUNDLES)],
    { cwd: directory, env: { ...env, ELECTRON_RUN_AS_NODE: '1' } }));
  assert.equal(contents.version, version);
  assert.equal(contents.arch, arch);
  for (const bundle of REQUIRED_BUNDLES) assert.equal(contents.files[bundle], computeSha256(join(root, bundle)), `Installed bundle differs: ${bundle}`);
  const { _electron: electron } = await import('@playwright/test');
  let app;
  let gui;
  const cleanupSandboxProfile = installCiSandboxProfile(executablePath);
  try {
    app = await electron.launch({ executablePath, args: [`--user-data-dir=${join(directory, 'profile')}`],
      cwd: directory, env, chromiumSandbox: true, timeout: 30_000 });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForURL('app://sketchdraw/index.html', { timeout: 20_000 });
    await page.locator('#app').waitFor({ state: 'visible', timeout: 20_000 });
    await page.waitForFunction(() => document.querySelector('#app')?.children.length > 0);
    gui = await app.evaluate(({ app, BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const preferences = win.webContents.getLastWebPreferences();
      return { packaged: app.isPackaged, version: app.getVersion(), arch: process.arch,
        executablePath: process.execPath, appPath: app.getAppPath(),
        sandbox: preferences.sandbox, contextIsolation: preferences.contextIsolation,
        nodeIntegration: preferences.nodeIntegration,
        disabledSandbox: app.commandLine.hasSwitch('no-sandbox') };
    });
    assert.equal(gui.packaged, true);
    assert.equal(gui.version, version);
    assert.equal(gui.arch, arch);
    assert.equal(realpathSync(gui.executablePath), realpathSync(executablePath));
    assert.equal(gui.appPath, archive);
    assert.equal(gui.sandbox, true);
    assert.equal(gui.contextIsolation, true);
    assert.equal(gui.nodeIntegration, false);
    assert.equal(gui.disabledSandbox, false);
    assert.equal(await page.evaluate(() => window.sketchdraw?.platform), 'electron');
    assert.deepEqual(errors, []);
  } finally { try { if (app) await stopElectron(app); } finally { cleanupSandboxProfile(); } }
  const mcp = await smokeMcpCli({ executablePath, adapterPath, cwd: directory });
  return { source: 'packaged-app', appIsPackaged: true, appVersion: version, appArch: arch,
    sandbox: true, bundleHashes: contents.files, mcp };
}

export async function runInstallerSmoke({ platformKey, installerPath, version, commitSha, outputPath,
  run = runSmokeCommand }) {
  const target = RELEASE_TARGETS[platformKey];
  assert.ok(target, 'Supported platform required');
  assert.equal(process.platform, target.nodePlatform);
  assert.equal(process.arch, target.arch);
  const directory = mkdtempSync(join(tmpdir(), 'Sketchdraw Installer Smoke '));
  const installerSha256 = computeSha256(installerPath);
  const report = { schemaVersion: 1, platformKey, version, commitSha, installerSha256, passed: false };
  try {
    const installed = extractInstaller({ platformKey, installerPath, directory, run });
    assert.equal(inspectBinaryFile(installed.executablePath).arch, target.arch);
    const smoke = await smokeInstalledApp({ ...installed, directory, version, arch: target.arch,
      env: cleanSmokeEnvironment(), run });
    assert.equal(computeSha256(installerPath), installerSha256, 'Installer changed during smoke');
    Object.assign(report, smoke, { source: 'installer-extracted', passed: true });
    return report;
  } catch (error) {
    report.error = `${error.name}: Installer extraction/start/adapter check failed`;
    throw error;
  } finally {
    try { rmSync(directory, { recursive: true, force: true, maxRetries: 3 }); }
    catch (error) {
      report.passed = false;
      report.error = `${error.name}: Installer smoke cleanup failed`;
      throw error;
    }
    finally { if (outputPath) writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`); }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(Array.from({ length: (process.argv.length - 2) / 2 }, (_, i) =>
    [process.argv[2 + i * 2].replace(/^--/, ''), process.argv[3 + i * 2]]));
  try {
    await runInstallerSmoke({ platformKey: args.platform, installerPath: resolve(args.installer),
      version: args.version, commitSha: args.commit, outputPath: resolve(args.output) });
  } catch (error) {
    console.error(`[release-smoke] ${error.name}: installer smoke failed (see report).`);
    process.exitCode = 1;
  }
}
