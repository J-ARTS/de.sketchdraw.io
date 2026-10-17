import { cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createElement } from '../../src/domain';
import { stopElectron } from './helpers/stop-electron';

// The private runtime capability must never enter a trace, screenshot, attachment or assertion output.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test('desktop exposes all MCP tools automatically across document switches and restart', async ({}, testInfo) => {
  test.setTimeout(90_000);
  const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'sketchdraw automatic agent ')));
  const runtimeFile = path.join(root, 'agent-runtime', 'active-v1.json');
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => typeof value === 'string' && !/^(ELECTRON_RUN_AS_NODE|ELECTRON_DISABLE_SANDBOX|NODE_OPTIONS|NODE_PATH|SKETCHDRAW_.*)$/i.test(key))) as Record<string, string>;
  const appEnv = { ...cleanEnv, SKETCHDRAW_MCP_RUNTIME_FILE: runtimeFile };
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  const clients: Client[] = [];
  let failure: unknown; let stage = 'launch';
  const readRuntime = async () => JSON.parse(await readFile(runtimeFile, 'utf8')) as {
    grant: { SKETCHDRAW_MCP_APP_EPOCH: string; SKETCHDRAW_MCP_DOCUMENT_ID: string };
    clientConfiguration: { command: string; args: string[]; env: Record<string, string> };
  };
  try {
    for (const dir of ['dist', 'dist-electron', 'dist-mcp']) await cp(path.join(project, dir), path.join(root, dir), { recursive: true });
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'sketchdraw-product-test', version: '0.1.0', main: 'entry.cjs' }));
    await writeFile(path.join(root, 'entry.cjs'), "const {app}=require('electron');const path=require('node:path');app.setPath('userData',path.join(__dirname,'profile'));require('./dist-electron/main.cjs');");
    app = await electron.launch({ args: [root], env: appEnv, chromiumSandbox: true, timeout: 20_000 });
    let page = await app.firstWindow();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Agenten', exact: true })).toHaveCount(0);

    stage = 'automatic runtime';
    await expect.poll(async () => {
      try { return (await readRuntime()).grant.SKETCHDRAW_MCP_DOCUMENT_ID; }
      catch { return ''; }
    }).toMatch(/^document:/);
    const firstRuntime = await readRuntime();
    expect(firstRuntime.clientConfiguration.env).toMatchObject({ ELECTRON_RUN_AS_NODE: '1', SKETCHDRAW_MCP_RUNTIME_FILE: runtimeFile });
    const client = new Client({ name: 'product-acceptance', version: '1.0.0' }); clients.push(client);
    await client.connect(new StdioClientTransport({ ...firstRuntime.clientConfiguration, cwd: root, stderr: 'pipe', maxBufferSize: 40 * 1024 * 1024 }));
    expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(expect.arrayContaining([
      'sketchdraw_read_document', 'sketchdraw_find_elements', 'sketchdraw_analyze_document',
      'sketchdraw_apply_commands', 'sketchdraw_read_code', 'sketchdraw_apply_code',
    ]));

    stage = 'automatic read/write';
    const read = await client.callTool({ name: 'sketchdraw_read_document', arguments: {} });
    expect((read.structuredContent as Record<string, unknown> | undefined)?.revision).toBe(0);
    const firstDocumentId = (read.structuredContent as Record<string, unknown>).documentId as string;
    const created = await client.callTool({ name: 'sketchdraw_apply_commands', arguments: { expectedRevision: 0, commandId: 'product-add', command: { type: 'add', elements: [createElement('rectangle', { id: 'shape:sdk', x: 300, y: 240, width: 200, height: 100, label: 'Agent-created box' })] } } });
    expect(created.isError).not.toBe(true);
    await expect(page.locator('[data-element-id="shape:sdk"]')).toBeAttached();
    await page.getByTestId('document-title').fill('Human edited workspace'); await page.getByTestId('document-title').press('Tab');
    await expect.poll(async () => ((await client.callTool({ name: 'sketchdraw_read_document', arguments: {} })).structuredContent as Record<string, unknown> | undefined)?.revision).toBe(2);
    await page.getByTestId('workspace-menu-button').click();
    await page.getByRole('menuitemcheckbox', { name: 'Code', exact: true }).click();
    await page.getByTestId('diagram-code').fill('sketchdraw broken draft');
    const renamed = await client.callTool({ name: 'sketchdraw_apply_commands', arguments: { expectedRevision: 2, commandId: 'product-title', command: { type: 'rename', title: 'Agent and human' } } });
    expect(renamed.isError).not.toBe(true);
    await expect(page.getByTestId('document-title')).toHaveValue('Agent and human');
    await expect(page.getByTestId('diagram-code')).toHaveValue('sketchdraw broken draft');

    stage = 'document switch reconnect';
    await page.getByTestId('file-menu-button').click(); await page.getByTestId('file-menu-new').click();
    await page.getByRole('button', { name: 'Verwerfen', exact: true }).click();
    await expect.poll(async () => {
      try { const id = (await readRuntime()).grant.SKETCHDRAW_MCP_DOCUMENT_ID; return id === firstDocumentId ? '' : id; }
      catch { return ''; }
    }).toMatch(/^document:/);
    const switched = await client.callTool({ name: 'sketchdraw_read_document', arguments: {} });
    expect(switched.isError).not.toBe(true);
    expect(switched.structuredContent).toMatchObject({ revision: 0 });

    stage = 'desktop restart';
    await client.close();
    const oldEpoch = (await readRuntime()).grant.SKETCHDRAW_MCP_APP_EPOCH;
    await stopElectron(app); app = undefined;
    app = await electron.launch({ args: [root], env: appEnv, chromiumSandbox: true, timeout: 20_000 });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
    await expect.poll(async () => {
      try { const epoch = (await readRuntime()).grant.SKETCHDRAW_MCP_APP_EPOCH; return epoch === oldEpoch ? '' : epoch; }
      catch { return ''; }
    }).toMatch(/^[a-f0-9]{32}$/);
    const restarted = await readRuntime();
    const restartClient = new Client({ name: 'product-restart', version: '1.0.0' }); clients.push(restartClient);
    await restartClient.connect(new StdioClientTransport({ ...restarted.clientConfiguration, cwd: root, stderr: 'pipe' }));
    const afterRestart = await restartClient.callTool({ name: 'sketchdraw_read_document', arguments: {} });
    expect(afterRestart.isError).not.toBe(true);
    expect(errors).toEqual([]);
    await testInfo.attach('product-agent-evidence', { body: JSON.stringify({ realProductRenderer: true, realSdk: true, noApprovalUi: true, automaticWrite: true, documentSwitchReconnect: true, restartReconnect: true, invalidDraftPreserved: true, platform: process.platform }), contentType: 'application/json' });
  } catch (error) {
    failure = error;
    await testInfo.attach('failed-stage', { body: stage, contentType: 'text/plain' }).catch(() => {});
    throw error;
  } finally {
    try {
      const bounded = async (promise: Promise<unknown>) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Owned SDK client close timed out.')), 3000); })]); }
        finally { clearTimeout(timer); }
      };
      let clientCloseFailed = false;
      for (const client of clients) await bounded(client.close()).catch(() => { clientCloseFailed = true; });
      if (app) {
        const result = await stopElectron(app);
        await testInfo.attach('owned-process-cleanup', { body: JSON.stringify(result), contentType: 'application/json' });
      }
      await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
      if (clientCloseFailed) throw new Error('Owned SDK client did not close cleanly.');
    } catch (cleanupError) { if (!failure) throw cleanupError; console.warn('Owned test cleanup also failed; preserving the original test error.'); }
  }
});
