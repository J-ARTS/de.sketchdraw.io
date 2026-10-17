import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Ubuntu 24.04 restricts user namespaces for binaries without an AppArmor profile.
// The installed DEB includes electron-builder's equivalent profile for /opt/Sketchdraw.
// CI tests binaries in checkout/private extraction paths, so bind only that exact path.
export function sandboxProfile(executablePath) {
  if (!isAbsolute(executablePath) || /[\x00-\x1f\x7f*?{}\[\]"\\]/u.test(executablePath)) {
    throw new Error('Sandbox executable must be an absolute literal path without AppArmor metacharacters.');
  }
  const name = `sketchdraw-ci-${createHash('sha256').update(executablePath).digest('hex').slice(0, 24)}-${randomBytes(8).toString('hex')}`;
  return `abi <abi/4.0>,\ninclude <tunables/global>\nprofile "${name}" "${executablePath}" flags=(unconfined) {\n  userns,\n}\n`;
}

export function installCiSandboxProfile(executablePath) {
  // Never mutate a developer's security policy implicitly. This adapter is CI-only.
  if (process.platform !== 'linux' || process.env.GITHUB_ACTIONS !== 'true') return () => {};
  if (!existsSync('/sys/module/apparmor/parameters/enabled')) return () => {};
  const executable = realpathSync(executablePath);
  const profile = sandboxProfile(executable);
  const directory = mkdtempSync(join(tmpdir(), 'sketchdraw-ci-apparmor-'));
  const file = join(directory, 'profile');
  writeFileSync(file, profile, { mode: 0o600 });
  const run = args => execFileSync('sudo', ['--non-interactive', 'apparmor_parser', ...args, file], { stdio: 'inherit', timeout: 30_000 });
  try { run(['--add']); }
  catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
  let installed = true;
  return () => {
    if (!installed) return;
    run(['--remove']); installed = false;
    rmSync(directory, { recursive: true, force: true });
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.shift() !== '--' || !args.length) throw new Error('Usage: node scripts/linux-sandbox.mjs -- <command> [args...]');
  const require = createRequire(import.meta.url);
  const cleanup = installCiSandboxProfile(require('electron'));
  let child, timer;
  const signals = ['SIGINT', 'SIGTERM'];
  const stop = signal => {
    if (!child?.pid) return;
    try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  const interrupt = signal => {
    process.exitCode = signal === 'SIGINT' ? 130 : 143;
    stop(signal);
    timer ??= setTimeout(() => stop('SIGKILL'), 5000);
  };
  const handlers = signals.map(signal => () => interrupt(signal));
  signals.forEach((signal, index) => process.on(signal, handlers[index]));
  try {
    await new Promise((resolve, reject) => {
      child = spawn(args[0], args.slice(1), { stdio: 'inherit', env: process.env, detached: process.platform !== 'win32' });
      child.once('error', reject);
      child.once('close', code => { process.exitCode ??= code ?? 1; resolve(); });
    });
  } finally {
    clearTimeout(timer);
    signals.forEach((signal, index) => process.off(signal, handlers[index]));
    cleanup();
  }
}
