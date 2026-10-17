import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const filename = fileURLToPath(import.meta.url);
const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const workerArgument = '--download-fixture-worker';

function deadline(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

function isolatedEnvironment(directory) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/proxy|^global_agent_|^electron_|^npm_(?:config|package_config)_electron|^node_(?:options|path|test_context)$|^(?:debug|tmpdir|tmp|temp)$/i.test(key)) {
      delete env[key];
    }
  }
  // The downloader also creates temporary checksum files and lock directories.
  return {
    ...env,
    TMPDIR: directory,
    TMP: directory,
    TEMP: directory,
    ELECTRON_GET_NO_PROGRESS: '1',
    ELECTRON_DOWNLOAD_CACHE_MODE: '0',
    ELECTRON_BUILDER_CACHE: path.join(directory, 'builder-cache'),
  };
}

async function runIsolatedProbe() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-downloader-'));
  let child;
  let completion;
  let output = '';
  let report;
  try {
    await chmod(directory, 0o700);
    child = fork(filename, [workerArgument, directory], {
      cwd: projectRoot,
      env: isolatedEnvironment(directory),
      execArgv: [],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => { output = (output + chunk).slice(-16_384); });
    }
    child.on('message', (message) => {
      if (message?.type === 'download-probe-result') report = message;
    });
    // Resolve errors as data so timeout/cleanup cannot leave a rejected promise unhandled.
    completion = new Promise((resolve) => {
      child.once('error', (error) => resolve({ error }));
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    const result = await deadline(completion, 20_000, 'Downloader fixture process timed out');
    assert.ifError(result.error);
    assert.equal(result.code, 0, `Downloader fixture failed (${result.signal ?? 'exit'}):\n${output}`);
    assert.ok(report, `Downloader fixture did not return its results:\n${output}`);
    return report;
  } finally {
    try {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        try {
          await deadline(completion, 1_000, 'Downloader fixture did not stop');
        } catch {
          child.kill('SIGKILL');
          await deadline(completion, 1_000, 'Downloader fixture could not be terminated');
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server.address().port;
}

async function closeServer(server) {
  const closing = new Promise((resolve, reject) => {
    server.close((error) => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve());
  });
  server.closeAllConnections();
  await deadline(closing, 1_000, 'Local download server did not close');
}

async function probeInstalledDownloader(directory) {
  const payload = Buffer.from('Sketchdraw builder download fixture\n');
  const checksum = createHash('sha256').update(payload).digest('hex');
  const proxiedUrl = 'http://download.sketchdraw.invalid/fixture.zip';
  const corruptUrl = 'http://download.sketchdraw.invalid/checksum-mismatch.zip';
  const proxyRequests = [];
  const directRequests = [];
  const respond = (requests) => (request, response) => {
    requests.push(request.url);
    response.writeHead(200, { 'content-length': payload.length, connection: 'close' });
    response.end(payload);
  };
  // The proxy serves fixtures itself. It never resolves or forwards the .invalid URL.
  const proxy = http.createServer(respond(proxyRequests));
  const direct = http.createServer(respond(directRequests));
  try {
    const proxyPort = await listen(proxy);
    const directPort = await listen(direct);
    process.env.ELECTRON_GET_USE_PROXY = 'true';
    process.env.GLOBAL_AGENT_HTTP_PROXY = `http://127.0.0.1:${proxyPort}`;
    process.env.GLOBAL_AGENT_NO_PROXY = '127.0.0.1';

    // Load the real installed dependency tree only after configuring this child process.
    const require = createRequire(new URL('../../package.json', import.meta.url));
    const builderRequire = createRequire(require.resolve('app-builder-lib/package.json'));
    const getRequire = createRequire(builderRequire.resolve('@electron/get'));
    const { downloadElectronArtifactZip } = require('app-builder-lib/out/util/electronGet.js');
    const version = require('electron/package.json').version;
    const artifactFilename = `electron-v${version}-linux-x64.zip`;
    let url = proxiedUrl;
    const options = {
      version,
      platformName: 'linux',
      arch: 'x64',
      artifactName: 'electron',
      cacheDir: path.join(directory, 'downloads'),
      electronDownload: {
        mirrorOptions: { resolveAssetURL: async () => url },
        checksums: { [artifactFilename]: checksum },
        downloadOptions: { timeout: { request: 3_000 }, retry: { limit: 0 } },
      },
    };

    const downloaded = await downloadElectronArtifactZip(options);
    assert.deepEqual(await readFile(downloaded), payload, 'Downloaded bytes must match the fixture');
    assert.deepEqual(proxyRequests, [proxiedUrl], 'The first download must use the configured proxy');
    assert.deepEqual(directRequests, [], 'The first download must not bypass the proxy');

    const cached = await downloadElectronArtifactZip(options);
    assert.equal(cached, downloaded, 'A cache hit must return the cached artifact');
    assert.deepEqual(await readFile(cached), payload);
    assert.equal(proxyRequests.length, 1, 'A verified cache hit must not download the artifact again');

    url = `http://127.0.0.1:${directPort}/fixture.zip`;
    assert.deepEqual(await readFile(await downloadElectronArtifactZip(options)), payload);
    assert.deepEqual(directRequests, ['/fixture.zip'], 'NO_PROXY must route loopback directly');
    assert.equal(proxyRequests.length, 1, 'NO_PROXY requests must not reach the proxy');

    url = corruptUrl;
    options.electronDownload.checksums[artifactFilename] = '0'.repeat(64);
    await assert.rejects(() => downloadElectronArtifactZip(options), /checksum/i);
    assert.deepEqual(proxyRequests, [proxiedUrl, corruptUrl]);

    return {
      type: 'download-probe-result',
      builder: builderRequire('./package.json').version,
      proxy: getRequire('global-agent/package.json').version,
      checks: ['proxy download', 'verified cache hit', 'NO_PROXY bypass', 'checksum rejection'],
    };
  } finally {
    await Promise.all([closeServer(proxy), closeServer(direct)]);
  }
}

if (process.argv[2] === workerArgument) {
  try {
    const report = await probeInstalledDownloader(process.argv[3]);
    await new Promise((resolve, reject) => process.send(report, (error) => error ? reject(error) : resolve()));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (process.connected) process.disconnect();
  }
} else {
  test('installed builder downloader preserves proxy routing, verified caching and checksum rejection', { timeout: 25_000 }, async (t) => {
    const report = await runIsolatedProbe();
    assert.equal(report.checks.length, 4);
    t.diagnostic(`app-builder-lib ${report.builder}; global-agent ${report.proxy}; ${report.checks.join(', ')}`);
  });
}
