#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEV_HOST = '127.0.0.1';
const DEV_PORT = 5173;

function verifyRequiredEntries() {
  const required = [
    'src/renderer/main.ts',
    'electron/main.ts',
    'electron/preload.ts',
  ];
  const missing = required.filter((entry) => !fs.existsSync(path.join(rootDir, entry)));
  if (missing.length > 0) {
    throw new Error(`Missing entry points: ${missing.join(', ')} (Issues #8 and #10)`);
  }
}

async function within(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Dependencies are injectable so lifecycle failures can be tested without a GUI.
export async function runDevelopmentSession({
  buildBundles = async () => (await import('./build-electron.mjs')).buildElectronBundles(),
  createServer = async (options) => (await import('vite')).createServer(options),
  resolveElectronExecutable = async () => (await import('electron')).default,
  spawnProcess = spawn,
  signal,
  cwd = rootDir,
  port = DEV_PORT,
  shutdownTimeoutMs = 3_000,
} = {}) {
  let server;
  let electron;
  let childFinished = false;
  let childDone;
  let childStopped;
  let failure;
  let exitCode = 0;
  let abortListener;
  const interrupted = new Promise((resolve) => {
    abortListener = () => resolve('interrupted');
    signal?.addEventListener('abort', abortListener, { once: true });
    if (signal?.aborted) abortListener();
  });

  try {
    signal?.throwIfAborted();
    await buildBundles();
    signal?.throwIfAborted();
    server = await createServer({
      root: cwd,
      server: { host: DEV_HOST, port, strictPort: true, open: false },
    });
    signal?.throwIfAborted();
    // listen rejects on an occupied port. Never attach Electron to an unrelated server.
    await server.listen();
    signal?.throwIfAborted();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') {
      throw new Error('Vite did not create a local HTTP listener');
    }
    const executable = await resolveElectronExecutable();
    signal?.throwIfAborted();
    if (typeof executable !== 'string' || executable.length === 0) {
      throw new Error('The installed Electron package did not provide an executable');
    }
    const env = {
      ...process.env,
      SKETCHDRAW_DEV_SERVER_URL: `http://${DEV_HOST}:${address.port}`,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    // Launch the native executable directly; .cmd shims require a Windows shell.
    electron = spawnProcess(executable, ['.'], { cwd, stdio: 'inherit', env });
    let markStopped;
    childStopped = new Promise((resolve) => { markStopped = resolve; });
    childDone = new Promise((resolve, reject) => {
      electron.on('error', (error) => {
        // A failed spawn has no PID. A later error does not prove the child exited.
        if (!electron.pid) {
          childFinished = true;
          markStopped();
        }
        reject(error);
      });
      electron.once('exit', (code, exitSignal) => {
        childFinished = true;
        markStopped();
        resolve(code ?? (exitSignal === 'SIGINT' ? 130 : exitSignal === 'SIGTERM' ? 143 : 1));
      });
    });
    const result = await Promise.race([childDone, interrupted]);
    if (result === 'interrupted') signal.throwIfAborted();
    exitCode = result;
  } catch (error) {
    failure = error;
  } finally {
    signal?.removeEventListener('abort', abortListener);
    const cleanup = await Promise.allSettled([
      (async () => {
        if (!electron || childFinished) return;
        electron.kill('SIGTERM');
        try {
          await within(childStopped, shutdownTimeoutMs, 'Electron shutdown timed out');
        } catch {
          if (!childFinished) electron.kill('SIGKILL');
          await within(childStopped, shutdownTimeoutMs, 'Electron did not stop after SIGKILL');
        }
      })(),
      (async () => {
        if (!server) return;
        try {
          await within(server.close(), shutdownTimeoutMs, 'Vite shutdown timed out');
        } catch (error) {
          server.httpServer?.close(() => {});
          server.httpServer?.closeAllConnections();
          throw error;
        }
      })(),
    ]);
    const cleanupErrors = cleanup.filter((result) => result.status === 'rejected').map((result) => result.reason);
    if (cleanupErrors.length > 0) {
      throw new AggregateError(failure ? [failure, ...cleanupErrors] : cleanupErrors, 'Development session cleanup failed');
    }
  }
  if (failure) throw failure;
  return exitCode;
}

async function main() {
  const controller = new AbortController();
  let signalExitCode;
  const onInterrupt = () => {
    signalExitCode ??= 130;
    controller.abort(new Error('Development session interrupted by SIGINT'));
  };
  const onTerminate = () => {
    signalExitCode ??= 143;
    controller.abort(new Error('Development session interrupted by SIGTERM'));
  };
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);
  try {
    verifyRequiredEntries();
    const code = await runDevelopmentSession({ signal: controller.signal });
    return signalExitCode ?? code;
  } catch (error) {
    if (!controller.signal.aborted || error instanceof AggregateError) {
      console.error('[dev:electron] Failed to run Electron development environment:', error);
    }
    return signalExitCode ?? 1;
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Cleanup above is bounded, including an unresponsive Electron or Vite plugin.
  process.exit(await main());
}
