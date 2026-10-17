import { expect, test, type Page } from '@playwright/test';
import type { AgentControlAck, AgentControlMessage, AgentGrantSummary, AgentIssuedGrant, AgentRendererRequest, AgentRendererResponse, AgentSessionDescriptor, SketchdrawAgentAccessBridge } from '../../src/agent-access/types';

type FixtureState = { sessions: number; created: Array<{ permission: string; label?: string }>; revoked: string[]; grants: AgentGrantSummary[]; request: (operation: 'sketchdraw_read_document' | 'sketchdraw_apply_commands', grantId: string) => Promise<AgentRendererResponse> };
/** Only native IPC is faked. The shipped manager, grant guards, authority and document are real. */
async function installBridgeFixture(page: Page) {
  await page.addInitScript(() => {
    let descriptor: AgentSessionDescriptor | undefined; let sequence = 0;
    const controls = new Set<(message: AgentControlMessage) => Promise<AgentControlAck> | AgentControlAck>();
    const requests = new Set<(request: AgentRendererRequest) => Promise<AgentRendererResponse>>();
    const state: FixtureState = { sessions: 0, created: [], revoked: [], grants: [], request: async () => { throw new Error('No fixture request handler'); } };
    async function control(message: AgentControlMessage) { const handler = [...controls].at(-1); if (!handler || !(await handler(message)).ok) throw new Error('Fixture control rejected'); }
    const bridge: SketchdrawAgentAccessBridge = {
      isAvailable: true,
      async registerSession(session) {
        state.sessions += 1; state.grants = []; descriptor = { ...session, webContentsGeneration: 1 };
        await control({ type: 'sync-session', controlId: `sync-${state.sessions}`, ...descriptor }); return descriptor;
      },
      async listGrants() { return state.grants.map(grant => ({ ...grant })); },
      async createGrant(permission, label) {
        if (!descriptor) throw new Error('Missing session');
        state.created.push({ permission, label });
        const grant: AgentGrantSummary = { ...descriptor, grantId: `grant-${++sequence}`, grantGeneration: 0, actorId: `agent:grant-${sequence}`, permission, label, active: true, revoked: false, createdAt: Date.now() };
        state.grants.push(grant); await control({ type: 'install-grant', controlId: `install-${sequence}`, ...descriptor, grant });
        // Public, synthetic fixture text; never an actual socket endpoint or capability.
        const env = { SKETCHDRAW_MCP_ENDPOINT: 'fixture-only', SKETCHDRAW_MCP_CAPABILITY: '0'.repeat(64), SKETCHDRAW_MCP_GRANT_ID: grant.grantId, SKETCHDRAW_MCP_APP_EPOCH: '0'.repeat(32), SKETCHDRAW_MCP_DOCUMENT_ID: descriptor.documentId };
        const issued: AgentIssuedGrant = { grant, capability: env.SKETCHDRAW_MCP_CAPABILITY, appEpoch: env.SKETCHDRAW_MCP_APP_EPOCH, endpoint: env.SKETCHDRAW_MCP_ENDPOINT, env, clientConfiguration: { command: 'node', args: ['/fixture/stdio.cjs'], env } };
        return issued;
      },
      async revokeGrant(id) {
        state.revoked.push(id); const grant = state.grants.find(item => item.grantId === id);
        if (grant && descriptor) { grant.active = false; grant.revoked = true; await control({ type: 'revoke-grant', controlId: `revoke-${sequence}`, ...descriptor, grantId: id, grantGeneration: grant.grantGeneration, reason: 'revoked' }); }
      },
      onControl(handler) { controls.add(handler); return () => controls.delete(handler); },
      onRequest(handler) { requests.add(handler); return () => requests.delete(handler); },
    };
    state.request = async (operation, grantId) => {
      const grant = state.grants.find(item => item.grantId === grantId); const handler = [...requests].at(-1);
      if (!grant || !handler || !descriptor) throw new Error('Missing fixture grant');
      const payload = operation === 'sketchdraw_read_document' ? { documentId: descriptor.documentId } : { documentId: descriptor.documentId, expectedRevision: 0, commandId: `command-${sequence}`, command: { type: 'rename' as const, title: 'Durch Agent geändert' } };
      return handler({ ...descriptor, requestId: `request-${sequence}`, operation, grantId, grantGeneration: grant.grantGeneration, actorId: grant.actorId, permission: grant.permission, expectedRevision: operation === 'sketchdraw_apply_commands' ? 0 : undefined, commandId: operation === 'sketchdraw_apply_commands' ? `command-${sequence}` : undefined, payload });
    };
    Object.defineProperty(window, 'sketchdrawAgentAccess', { value: bridge });
    Object.defineProperty(window, '__agentFixture', { value: state });
  });
}

test('browser makes Desktop requirement explicit and creates no grant controls', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Agenten', exact: true }).click();
  await expect(page.getByTestId('agent-access-panel')).toContainText('in der Desktop-Anwendung verfügbar');
  await expect(page.getByRole('button', { name: 'Freigabe erstellen', exact: true })).toHaveCount(0);
});

test('explicit read/write grants, hidden configuration, write enforcement and revoke', async ({ page }) => {
  await installBridgeFixture(page); await page.goto('/'); await page.getByRole('button', { name: 'Agenten', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Freigabe erstellen', exact: true })).toBeEnabled();
  await expect(page.getByRole('radio', { name: /Nur lesen/ })).toBeChecked();
  await page.getByLabel('Name des Agenten').fill('Leser'); await page.getByRole('button', { name: 'Freigabe erstellen', exact: true }).click();
  await expect(page.locator('[data-grant-id=grant-1]')).toContainText('Leser');
  await expect(page.getByTestId('agent-configuration')).toHaveCount(0);
  const readResult = await page.evaluate(() => (window as unknown as { __agentFixture: FixtureState }).__agentFixture.request('sketchdraw_read_document', 'grant-1'));
  expect(readResult.ok).toBe(true);
  const denied = await page.evaluate(() => (window as unknown as { __agentFixture: FixtureState }).__agentFixture.request('sketchdraw_apply_commands', 'grant-1'));
  expect(denied.ok).toBe(false); if (!denied.ok) expect(denied.error.code).toBe('ACCESS_DENIED');
  await page.getByRole('button', { name: 'Konfiguration anzeigen', exact: true }).click();
  await expect(page.getByTestId('agent-configuration')).toHaveValue(/mcpServers/);
  await page.getByRole('button', { name: 'Konfiguration kopieren', exact: true }).click();
  await page.locator('[data-grant-id=grant-1]').getByRole('button', { name: 'Widerrufen', exact: true }).click();
  await expect(page.getByTestId('agent-configuration')).toHaveCount(0); await expect(page.locator('[data-grant-id=grant-1]')).toContainText('Widerrufen');
  await page.getByRole('radio', { name: /Lesen und bearbeiten/ }).check(); await page.getByLabel('Name des Agenten').fill('Bearbeiter');
  await page.getByRole('button', { name: 'Freigabe erstellen', exact: true }).click(); await expect(page.locator('[data-grant-id=grant-2]')).toContainText('Bearbeiter');
  const written = await page.evaluate(() => (window as unknown as { __agentFixture: FixtureState }).__agentFixture.request('sketchdraw_apply_commands', 'grant-2'));
  expect(written.ok).toBe(true); await expect(page.getByTestId('document-title')).toHaveValue('Durch Agent geändert');
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'unsaved-new');
});

test('document replacement erases displayed configuration and binds a fresh session', async ({ page }) => {
  await installBridgeFixture(page); await page.goto('/'); await page.getByRole('button', { name: 'Agenten', exact: true }).click();
  await page.getByRole('button', { name: 'Freigabe erstellen', exact: true }).click();
  await page.getByRole('button', { name: 'Konfiguration anzeigen', exact: true }).click(); await expect(page.getByTestId('agent-configuration')).toBeVisible();
  await page.getByTestId('file-menu-button').click(); await page.getByTestId('file-menu-new').click();
  await expect(page.getByTestId('agent-configuration')).toHaveCount(0);
  await expect(page.locator('[data-grant-id]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __agentFixture: FixtureState }).__agentFixture.sessions)).toBe(2);
  await expect(page.getByRole('radio', { name: /Nur lesen/ })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Freigabe erstellen', exact: true })).toBeEnabled();
});
