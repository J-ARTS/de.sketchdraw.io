import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';

// These are simulated Windows command boundaries, not a native Windows proof.
// The Electron spec additionally runs an owned real process/descendant on Windows CI.
let importId = 0;
async function windowsBoundary(t, runTaskkill) {
  const originalExecFile = childProcess.execFile;
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  t.after(() => {
    childProcess.execFile = originalExecFile;
    syncBuiltinESMExports();
    Object.defineProperty(process, 'platform', platform);
  });
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
  childProcess.execFile = runTaskkill;
  syncBuiltinESMExports();
  return (await import(`../../scripts/stop-electron.mjs?test=${++importId}`)).stopElectron;
}

function application(pid = 40_001) {
  const child = Object.assign(new EventEmitter(), { pid, exitCode: null, signalCode: null });
  let closeCalls = 0;
  const app = {
    process: () => child,
    evaluate: () => { throw new Error('Windows cleanup must not quit the parent before taskkill.'); },
    close: async () => {
      assert.ok(child.exitCode !== null || child.signalCode !== null, 'OS exit precedes context close');
      closeCalls++;
    },
  };
  const exit = () => { child.exitCode = 0; child.emit('exit', 0, null); };
  return { app, child, exit, closeCalls: () => closeCalls };
}

test('simulated Windows: bounded taskkill addresses only the owned tree and waits for OS exit', async t => {
  const fixture = application();
  const stop = await windowsBoundary(t, (file, args, options, callback) => {
    assert.equal(file, 'taskkill.exe');
    assert.deepEqual(args, ['/PID', String(fixture.child.pid), '/T', '/F']);
    assert.equal(options.shell, undefined);
    assert.equal(options.timeout, 5_000);
    assert.equal(options.windowsHide, true);
    callback(null, '', '');
    setTimeout(fixture.exit, 20);
  });
  const result = await stop(fixture.app);
  assert.deepEqual(result.steps, ['taskkill-owned-tree', 'automation-closed']);
  assert.equal(result.exitCode, 0);
  assert.equal(fixture.closeCalls(), 1);
  assert.equal(fixture.child.listenerCount('exit'), 0);
});

test('simulated Windows: process-not-found race succeeds only after confirmed natural exit', async t => {
  const fixture = application();
  const stop = await windowsBoundary(t, (_file, _args, _options, callback) => {
    callback(Object.assign(new Error('Process no longer found'), { code: 128 }), '', '');
    setTimeout(fixture.exit, 20);
  });
  assert.deepEqual((await stop(fixture.app)).steps, ['taskkill-missing-process-confirmed', 'automation-closed']);
  assert.equal(fixture.closeCalls(), 1);
});

test('simulated Windows: a disappearing tree child succeeds only after confirmed root exit', async t => {
  const fixture = application();
  const stop = await windowsBoundary(t, (_file, _args, _options, callback) => {
    callback(Object.assign(new Error('taskkill partially completed'), {
      code: 1,
      stderr: 'ERROR: The process with PID 1234 could not be terminated.\r\nReason: There is no running instance of the task.\r\n',
    }), '', '');
    setTimeout(fixture.exit, 20);
  });
  assert.deepEqual((await stop(fixture.app)).steps, ['taskkill-missing-process-confirmed', 'automation-closed']);
  assert.equal(fixture.closeCalls(), 1);
});

test('simulated Windows: a disappearing tree child with a live root stays a failure', async t => {
  const fixture = application();
  const failure = Object.assign(new Error('taskkill partially completed'), {
    code: 1,
    stderr: 'ERROR: The process with PID 1234 could not be terminated.\r\nReason: There is no running instance of the task.\r\n',
  });
  const stop = await windowsBoundary(t, (_file, _args, _options, callback) => callback(failure, '', ''));
  await assert.rejects(stop(fixture.app), error => error === failure);
  assert.equal(fixture.closeCalls(), 0);
});

test('simulated Windows: process-not-found with a live parent stays a failure', async t => {
  const fixture = application();
  const failure = Object.assign(new Error('Process lookup failed'), { code: 128 });
  const stop = await windowsBoundary(t, (_file, _args, _options, callback) => callback(failure, '', ''));
  await assert.rejects(stop(fixture.app), error => error === failure);
  assert.equal(fixture.closeCalls(), 0);
  assert.equal(fixture.child.listenerCount('exit'), 0);
});

test('simulated Windows: other command failures remain visible even when the parent exits', async t => {
  let fixture;
  let failure;
  const stop = await windowsBoundary(t, (_file, _args, _options, callback) => {
    fixture.exit();
    callback(failure, '', '');
  });
  for (const code of [1, 5, 'ENOENT', 'EACCES', 'ETIMEDOUT']) {
    fixture = application();
    failure = Object.assign(new Error(`Failure ${code}`), { code });
    await assert.rejects(stop(fixture.app), error => error === failure);
    assert.equal(fixture.closeCalls(), 0);
  }
});

test('simulated Windows: command success is insufficient while the owned process is alive', async t => {
  const fixture = application();
  const stop = await windowsBoundary(t, (_file, _args, _options, callback) => callback(null, '', ''));
  await assert.rejects(stop(fixture.app), /did not exit after taskkill/);
  assert.equal(fixture.closeCalls(), 0);
  assert.equal(fixture.child.listenerCount('exit'), 0);
});

test('simulated Windows: exited processes are not signalled again', async t => {
  const fixture = application();
  fixture.exit();
  const stop = await windowsBoundary(t, () => assert.fail('Must not target an exited/reused PID'));
  assert.deepEqual((await stop(fixture.app)).steps, ['already-exited', 'automation-closed']);
  assert.deepEqual((await stop(fixture.app)).steps, ['already-exited', 'automation-closed']);
});

test('simulated Windows: invalid or own runner PID never reaches taskkill', async t => {
  const stop = await windowsBoundary(t, () => assert.fail('Invalid process ownership'));
  for (const pid of [0, 1, -1, 1.5, NaN, process.pid]) {
    await assert.rejects(stop(application(pid).app), /valid, separately owned process PID/);
  }
});

test('simulated Windows: a stuck automation close fails within its deadline', async t => {
  const fixture = application();
  fixture.exit();
  fixture.app.close = () => new Promise(() => {});
  const stop = await windowsBoundary(t, () => assert.fail('Already exited'));
  await assert.rejects(stop(fixture.app), /automation context close timed out after 2000ms/);
});
