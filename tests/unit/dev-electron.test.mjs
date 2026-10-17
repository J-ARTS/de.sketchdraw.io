import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServer } from 'vite';
import { runDevelopmentSession } from '../../scripts/dev-electron.mjs';

async function fixture(t) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-launcher-'));
  await writeFile(path.join(cwd, 'index.html'), '<!doctype html><title>Launcher test</title>');
  t.after(() => rm(cwd, { recursive: true, force: true }));
  let vite;
  let listeningPort;
  let closeCalls = 0;
  const options = {
    cwd,
    port: 0,
    shutdownTimeoutMs: 200,
    buildBundles: async () => {},
    resolveElectronExecutable: async () => 'C:/Electron path/Electron.exe',
    createServer: async (config) => {
      vite = await createServer({
        ...config,
        configFile: false,
        logLevel: 'silent',
        optimizeDeps: { noDiscovery: true },
        server: { ...config.server, hmr: false, watch: null },
      });
      const listen = vite.listen.bind(vite);
      vite.listen = async () => {
        const result = await listen();
        listeningPort = vite.httpServer.address().port;
        return result;
      };
      const close = vite.close.bind(vite);
      vite.close = async () => { closeCalls++; return close(); };
      t.after(() => close());
      return vite;
    },
  };
  return {
    options,
    get vite() { return vite; },
    get port() { return listeningPort; },
    get closeCalls() { return closeCalls; },
  };
}

async function assertPortReleased(port) {
  const server = net.createServer();
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('uses the native executable and its own ready server, then preserves the child exit code', async (t) => {
  const state = await fixture(t);
  let launches = 0;
  const result = await runDevelopmentSession({
    ...state.options,
    spawnProcess: (executable, args, options) => {
      launches++;
      assert.equal(executable, 'C:/Electron path/Electron.exe');
      assert.deepEqual(args, ['.']);
      assert.equal(options.shell, undefined);
      assert.equal(options.env.SKETCHDRAW_DEV_SERVER_URL, `http://127.0.0.1:${state.port}`);
      assert.equal(options.env.ELECTRON_RUN_AS_NODE, undefined);
      assert.equal(state.vite.httpServer.listening, true);
      return spawn(process.execPath, ['-e', 'process.exit(7)'], { stdio: 'ignore' });
    },
  });
  assert.equal(result, 7);
  assert.equal(launches, 1);
  assert.equal(state.closeCalls, 1);
  await assertPortReleased(state.port);
});

test('an occupied port rejects startup without launching Electron or stopping the existing server', async (t) => {
  const existing = http.createServer((_, response) => response.end('unrelated server'));
  existing.listen(0, '127.0.0.1');
  await once(existing, 'listening');
  t.after(() => new Promise((resolve) => existing.close(resolve)));
  const port = existing.address().port;
  const state = await fixture(t);
  let launches = 0;
  await assert.rejects(runDevelopmentSession({
    ...state.options,
    port,
    spawnProcess: () => { launches++; throw new Error('must not launch'); },
  }), /already in use|EADDRINUSE/);
  assert.equal(launches, 0);
  assert.equal(state.closeCalls, 1);
  assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'unrelated server');
});

test('a failed Electron spawn closes Vite and reports the actual launch error', async (t) => {
  const state = await fixture(t);
  await assert.rejects(runDevelopmentSession({
    ...state.options,
    resolveElectronExecutable: async () => path.join(state.options.cwd, 'missing electron executable'),
    spawnProcess: spawn,
  }), { code: 'ENOENT' });
  assert.equal(state.closeCalls, 1);
  await assertPortReleased(state.port);
});

test('a failed build does not create a server or start a child', async () => {
  const buildError = new Error('bundle failed');
  await assert.rejects(runDevelopmentSession({
    buildBundles: async () => { throw buildError; },
    createServer: async () => assert.fail('server must not be created'),
    spawnProcess: () => assert.fail('child must not start'),
  }), (error) => error === buildError);
});

test('missing Electron installation after Vite startup still releases its port', async (t) => {
  const state = await fixture(t);
  await assert.rejects(runDevelopmentSession({
    ...state.options,
    resolveElectronExecutable: async () => { throw new Error('Electron download missing'); },
    spawnProcess: () => assert.fail('child must not start'),
  }), /Electron download missing/);
  assert.equal(state.closeCalls, 1);
  await assertPortReleased(state.port);
});

test('an interruption during server creation closes the server and never launches Electron', async (t) => {
  const state = await fixture(t);
  const controller = new AbortController();
  const reason = new Error('stop requested during startup');
  await assert.rejects(runDevelopmentSession({
    ...state.options,
    signal: controller.signal,
    createServer: async (config) => {
      const server = await state.options.createServer(config);
      controller.abort(reason);
      return server;
    },
    spawnProcess: () => assert.fail('child must not start'),
  }), (error) => error === reason);
  assert.equal(state.closeCalls, 1);
  assert.equal(state.vite.httpServer.listening, false);
});

test('interruption stops the child, escalating a refused graceful shutdown, and releases Vite', async (t) => {
  const state = await fixture(t);
  const controller = new AbortController();
  const reason = new Error('stop requested');
  const signals = [];
  let child;
  const result = runDevelopmentSession({
    ...state.options,
    signal: controller.signal,
    spawnProcess: () => {
      child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); process.send('ready'); setInterval(() => {}, 1000)"], {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      const kill = child.kill.bind(child);
      child.kill = (signal) => { signals.push(signal); return kill(signal); };
      child.once('message', () => controller.abort(reason));
      t.after(() => { if (child.exitCode === null && child.signalCode === null) kill('SIGKILL'); });
      return child;
    },
  });
  await assert.rejects(result, (error) => error === reason);
  assert.equal(signals[0], 'SIGTERM');
  if (process.platform !== 'win32') assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  assert.notEqual(child.signalCode, null);
  assert.equal(state.closeCalls, 1);
  await assertPortReleased(state.port);
});

test('a hanging Vite shutdown is bounded and still closes the HTTP listener', async (t) => {
  const state = await fixture(t);
  await assert.rejects(runDevelopmentSession({
    ...state.options,
    shutdownTimeoutMs: 30,
    createServer: async (config) => {
      const server = await state.options.createServer(config);
      server.close = () => new Promise(() => {});
      return server;
    },
    spawnProcess: () => spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' }),
  }), (error) => error instanceof AggregateError && error.errors.some((item) => /Vite shutdown timed out/.test(item.message)));
  await assertPortReleased(state.port);
});

test('an error from a running child does not incorrectly count it as terminated', async (t) => {
  const state = await fixture(t);
  const childError = new Error('child process communication failed');
  let child;
  await assert.rejects(runDevelopmentSession({
    ...state.options,
    spawnProcess: () => {
      child = spawn(process.execPath, ['-e', "process.send('ready'); setInterval(() => {}, 1000)"], {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      child.once('message', () => child.emit('error', childError));
      t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
      return child;
    },
  }), (error) => error === childError);
  assert.notEqual(child.signalCode, null);
  await assertPortReleased(state.port);
});
