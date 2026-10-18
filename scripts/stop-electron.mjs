import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);


function hasExited(child) {
  // child.killed only confirms that a signal was sent, not that the process exited.
  return child.exitCode !== null || child.signalCode !== null;
}

async function deadline(operation, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms.`)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForExit(child, milliseconds) {
  if (hasExited(child)) return true;
  let onExit;
  const exited = new Promise((resolve) => {
    onExit = resolve;
    child.once('exit', onExit);
  });
  try {
    await deadline(exited, milliseconds, `Owned Electron process ${child.pid} exit`);
    return true;
  } catch {
    return hasExited(child);
  } finally {
    child.removeListener('exit', onExit);
  }
}

function isTaskkillMissingProcessRace(error) {
  if (!error || typeof error !== 'object') return false;
  if (error.code === 128) return true;
  const details = `${error.message ?? ''}\n${error.stderr ?? ''}`;
  return /there is no running instance of the task/i.test(details);
}

/** Test cleanup only. Call before deleting the owned profile or fixture directory. */
export async function stopElectron(app) {
  const child = app.process();
  const pid = child.pid;
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) {
    throw new Error('Cannot clean up Electron without a valid, separately owned process PID.');
  }
  const steps = [];
  if (!hasExited(child)) {
    if (process.platform === 'win32') {
      // Do not quit/kill the parent first: taskkill must still see the owned tree
      // to terminate Chromium children that otherwise keep the profile locked.
      // No shell, process-name match, or unrelated Electron instance is involved.
      try {
        await execFileAsync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
          windowsHide: true,
          timeout: 5_000,
          killSignal: 'SIGKILL',
          maxBuffer: 64 * 1024,
        });
        steps.push('taskkill-owned-tree');
      } catch (error) {
        // A natural exit can win the race with taskkill's process lookup (128).
        // Windows can also return exit code 1 when a Chromium descendant exits
        // while /T is walking the exclusively owned tree. Accept that narrow
        // diagnostic only after the root process has actually exited.
        // Never suppress missing executables, access denied, command timeouts,
        // or other failures merely because the parent happened to exit as well.
        if (!isTaskkillMissingProcessRace(error) || !await waitForExit(child, 3_000)) throw error;
        steps.push('taskkill-missing-process-confirmed');
      }
      if (!await waitForExit(child, 3_000)) {
        throw new Error(`Owned Electron process ${pid} did not exit after taskkill /T /F.`);
      }
    } else {
      // The close handshake is tested separately. Its deliberately unanswered
      // request must not block fixture cleanup. Return from evaluate before exit.
      await deadline(app.evaluate(({ app }) => {
        setImmediate(() => app.exit(0));
      }), 1_000, 'Electron exit request').catch(() => {});
      steps.push('app-exit-request');
      if (!await waitForExit(child, 2_000)) {
        for (const signal of ['SIGTERM', 'SIGKILL']) {
          if (hasExited(child)) break;
          child.kill(signal);
          steps.push(signal);
          if (await waitForExit(child, 2_000)) break;
        }
      }
    }
  } else {
    steps.push('already-exited');
  }
  if (!hasExited(child)) throw new Error(`Owned Electron process ${pid} did not exit.`);

  // Release Playwright resources only after the OS process has actually exited.
  // app.close() alone can wait indefinitely on the application's close handshake.
  await deadline(app.close(), 2_000, 'Electron automation context close');
  steps.push('automation-closed');
  return { pid, platform: process.platform, steps, exitCode: child.exitCode, signalCode: child.signalCode };
}
