import { cp, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createElement } from '../../src/domain';

// This test explicitly reveals a temporary capability to its own SDK client.
// Never put that capability into a screenshot, trace, attachment, or assertion output.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test('actual desktop grants connect the real SDK to the editable product canvas', async ({}, testInfo) => {
  test.setTimeout(60_000);
  const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'sketchdraw product agent ')));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => typeof value === 'string' && !/^(ELECTRON_RUN_AS_NODE|ELECTRON_DISABLE_SANDBOX|NODE_OPTIONS|NODE_PATH|SKETCHDRAW_.*)$/i.test(key))) as Record<string, string>;
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  const clients: Client[] = [];
  try {
    for (const dir of ['dist', 'dist-electron', 'dist-mcp']) await cp(path.join(project, dir), path.join(root, dir), { recursive: true });
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'sketchdraw-product-test', version: '0.1.0', main: 'entry.cjs' }));
    await writeFile(path.join(root, 'entry.cjs'), "const {app}=require('electron');const path=require('node:path');app.setPath('userData',path.join(__dirname,'profile'));require('./dist-electron/main.cjs');");
    app = await electron.launch({ args: [root], env, chromiumSandbox: true, timeout: 20_000 });
    const page = await app.firstWindow();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
    await page.getByRole('button', { name: 'Agenten', exact: true }).click();
    const create = page.getByRole('button', { name: 'Freigabe erstellen', exact: true });
    await expect(create).toBeEnabled();
    await page.getByLabel('Lesen und bearbeiten', { exact: false }).check();
    await page.getByLabel('Name des Agenten', { exact: false }).fill('SDK product test');
    await create.click();
    await expect(page.getByTestId('agent-configuration')).not.toBeVisible();
    await page.getByRole('button', { name: 'Konfiguration anzeigen', exact: true }).click();
    const configuration = JSON.parse(await page.getByTestId('agent-configuration').inputValue()).mcpServers.sketchdraw as { command: string; args: string[]; env: Record<string, string> };
    const documentId = configuration.env.SKETCHDRAW_MCP_DOCUMENT_ID!;
    await page.getByRole('button', { name: 'Konfiguration verbergen', exact: true }).click();
    const client = new Client({ name: 'product-acceptance', version: '1.0.0' }); clients.push(client);
    await client.connect(new StdioClientTransport({ ...configuration, cwd: root, stderr: 'pipe', maxBufferSize: 40 * 1024 * 1024 }));
    expect((await client.listTools()).tools.map(tool => tool.name)).toContain('sketchdraw_apply_commands');
    const read = await client.callTool({ name: 'sketchdraw_read_document', arguments: { documentId } });
    expect((read.structuredContent as Record<string, unknown> | undefined)?.revision).toBe(0);
    const created = await client.callTool({ name: 'sketchdraw_apply_commands', arguments: { documentId, expectedRevision: 0, commandId: 'product-add', command: { type: 'add', elements: [createElement('rectangle', { id: 'shape:sdk', x: 300, y: 240, width: 200, height: 100, label: 'Agent-created box' })] } } });
    expect(created.isError).not.toBe(true);
    expect((created.structuredContent as Record<string, unknown> | undefined)?.revision).toBe(1);
    await expect(page.locator('[data-element-id="shape:sdk"]')).toBeAttached();
    await page.getByRole('button', { name: 'Agentenzugriff schließen', exact: true }).click();
    await page.getByTestId('document-title').fill('Human edited workspace');
    await page.getByTestId('document-title').press('Tab');
    await expect.poll(async () => ((await client.callTool({ name: 'sketchdraw_read_document', arguments: { documentId } })).structuredContent as Record<string, unknown> | undefined)?.revision).toBe(2);
    await page.getByRole('button', { name: 'Code', exact: true }).click();
    await page.getByTestId('diagram-code').fill('sketchdraw broken draft');
    const renamed = await client.callTool({ name: 'sketchdraw_apply_commands', arguments: { documentId, expectedRevision: 2, commandId: 'product-title', command: { type: 'rename', title: 'Agent and human' } } });
    expect(renamed.isError).not.toBe(true);
    await expect(page.getByTestId('document-title')).toHaveValue('Agent and human');
    await expect(page.getByTestId('diagram-code')).toHaveValue('sketchdraw broken draft');
    await page.getByRole('button', { name: 'Agenten', exact: true }).click();
    await page.getByRole('button', { name: 'Widerrufen', exact: true }).click();
    await expect(page.getByText('Freigabe widerrufen.', { exact: false })).toBeVisible();
    const denied = await client.callTool({ name: 'sketchdraw_read_document', arguments: { documentId } });
    expect(denied.isError).toBe(true);
    await page.getByRole('radio', { name: 'Nur lesen', exact: false }).check(); await create.click();
    await page.getByRole('button', { name: 'Konfiguration anzeigen', exact: true }).click();
    const readConfig = JSON.parse(await page.getByTestId('agent-configuration').inputValue()).mcpServers.sketchdraw;
    await page.getByRole('button', { name: 'Konfiguration verbergen', exact: true }).click();
    const reader = new Client({ name: 'product-read-only', version: '1.0.0' }); clients.push(reader);
    await reader.connect(new StdioClientTransport({ ...readConfig, cwd: root, stderr: 'pipe' }));
    const forbidden = await reader.callTool({ name: 'sketchdraw_apply_commands', arguments: { documentId, expectedRevision: 3, commandId: 'product-forbidden', command: { type: 'rename', title: 'Forbidden' } } });
    expect(forbidden.isError).toBe(true);
    expect(((forbidden.structuredContent as Record<string, unknown> | undefined)?.error as { code: string })?.code).toBe('ACCESS_DENIED');
    await page.getByTestId('file-menu-button').click(); await page.getByTestId('file-menu-new').click();
    await page.getByRole('button', { name: 'Verwerfen', exact: true }).click();
    await expect(page.locator('[data-element-id]')).toHaveCount(0);
    await expect(page.getByTestId('agent-configuration')).not.toBeVisible();
    await expect(page.getByText('Noch keine Freigaben.', { exact: false })).toBeVisible();
    expect((await reader.callTool({ name: 'sketchdraw_read_document', arguments: { documentId } })).isError).toBe(true);
    expect(errors).toEqual([]);
    await testInfo.attach('product-agent-evidence', { body: JSON.stringify({ realProductRenderer: true, realSdk: true, visibleAgentMutation: true, subsequentHumanMutation: true, invalidDraftPreserved: true, readOnlyEnforced: true, revoked: true, documentSwitchInvalidatesGrants: true, platform: process.platform }), contentType: 'application/json' });
  } finally {
    const bounded = (promise: Promise<unknown>) => Promise.race([promise.catch(() => {}), new Promise(resolve => setTimeout(resolve, 2000))]);
    for (const client of clients) await bounded(client.close());
    if (app) { const child = app.process(); await bounded(app.evaluate(({ app }) => app.exit(0))); await bounded(app.close()); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
    await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
});
