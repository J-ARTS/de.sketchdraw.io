import { expect, test, type Page } from '@playwright/test';
import type { AgentControlAck, AgentControlMessage, AgentGrantSummary, AgentRendererRequest, AgentRendererResponse, AgentSessionDescriptor, SketchdrawAgentAccessBridge } from '../../src/agent-access/types';

type FixtureState = {
  sessions: number;
  unregistered: number;
  activeGrantId: string;
  request: (operation: 'sketchdraw_read_document' | 'sketchdraw_apply_commands') => Promise<AgentRendererResponse>;
};

/** Only native IPC is faked. The automatic session, authority and write guard are shipped code. */
async function installBridgeFixture(page: Page) {
  await page.addInitScript(() => {
    let descriptor: AgentSessionDescriptor | undefined;
    let grant: AgentGrantSummary | undefined;
    const controls = new Set<(message: AgentControlMessage) => Promise<AgentControlAck> | AgentControlAck>();
    const requests = new Set<(request: AgentRendererRequest) => Promise<AgentRendererResponse>>();
    const state: FixtureState = { sessions: 0, unregistered: 0, activeGrantId: '', request: async () => { throw new Error('No fixture request handler'); } };
    async function control(message: AgentControlMessage) {
      const handler = [...controls].at(-1);
      if (!handler || !(await handler(message)).ok) throw new Error('Fixture control rejected');
    }
    const bridge: SketchdrawAgentAccessBridge = {
      isAvailable: true,
      async registerSession(session) {
        descriptor = { ...session, webContentsGeneration: 1 };
        state.sessions += 1;
        await control({ type: 'sync-session', controlId: `sync-${state.sessions}`, ...descriptor });
        grant = { ...descriptor, grantId: `automatic-${state.sessions}`, grantGeneration: state.sessions, actorId: `agent:automatic-${state.sessions}`, permission: 'write', label: 'Automatic local agent access', active: true, revoked: false, createdAt: Date.now() };
        state.activeGrantId = grant.grantId;
        await control({ type: 'install-grant', controlId: `install-${state.sessions}`, ...descriptor, grant });
        return descriptor;
      },
      async unregisterSession(session) {
        if (descriptor?.documentId === session.documentId && descriptor.sessionEpoch === session.sessionEpoch) {
          state.unregistered += 1; descriptor = undefined; grant = undefined; state.activeGrantId = '';
        }
      },
      onControl(handler) { controls.add(handler); return () => controls.delete(handler); },
      onRequest(handler) { requests.add(handler); return () => requests.delete(handler); },
    };
    state.request = async operation => {
      const handler = [...requests].at(-1);
      if (!grant || !handler || !descriptor) throw new Error('Missing automatic fixture access');
      const commandId = `command-${state.sessions}`;
      const payload = operation === 'sketchdraw_read_document'
        ? { documentId: descriptor.documentId }
        : { documentId: descriptor.documentId, expectedRevision: 0, commandId, command: { type: 'rename' as const, title: 'Automatisch durch Agent geändert' } };
      return handler({ ...descriptor, requestId: `request-${state.sessions}`, operation, grantId: grant.grantId, grantGeneration: grant.grantGeneration, actorId: grant.actorId, permission: grant.permission, expectedRevision: operation === 'sketchdraw_apply_commands' ? 0 : undefined, commandId: operation === 'sketchdraw_apply_commands' ? commandId : undefined, payload });
    };
    Object.defineProperty(window, 'sketchdrawAgentAccess', { value: bridge });
    Object.defineProperty(window, '__agentFixture', { value: state });
  });
}

test('browser has no agent approval area and exposes no local host', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Agenten', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('agent-access-panel')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { sketchdrawAgentAccess?: unknown }).sketchdrawAgentAccess)).toBeUndefined();
});

test('desktop bridge activates write access automatically and rotates it with the document', async ({ page }) => {
  await installBridgeFixture(page); await page.goto('/');
  await expect(page.getByRole('button', { name: 'Agenten', exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __agentFixture: FixtureState }).__agentFixture.sessions)).toBe(1);
  const written = await page.evaluate(() => (window as unknown as { __agentFixture: FixtureState }).__agentFixture.request('sketchdraw_apply_commands'));
  expect(written.ok).toBe(true);
  await expect(page.getByTestId('document-title')).toHaveValue('Automatisch durch Agent geändert');

  await page.getByTestId('file-menu-button').click(); await page.getByTestId('file-menu-new').click();
  await page.getByRole('button', { name: 'Verwerfen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __agentFixture: FixtureState }).__agentFixture.sessions)).toBe(2);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __agentFixture: FixtureState }).__agentFixture.unregistered)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { __agentFixture: FixtureState }).__agentFixture.activeGrantId)).toBe('automatic-2');
  const read = await page.evaluate(() => (window as unknown as { __agentFixture: FixtureState }).__agentFixture.request('sketchdraw_read_document'));
  expect(read.ok).toBe(true);
});
