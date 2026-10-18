import { expect, test } from '@playwright/test';

// Needs internet access to the public MQTT brokers and a STUN server; run with SKETCHDRAW_NETWORK_E2E=1.
test.skip(!process.env.SKETCHDRAW_NETWORK_E2E, 'network end-to-end test (set SKETCHDRAW_NETWORK_E2E=1)');
// Headless Chromium hides local addresses behind mDNS names that two pages of one machine cannot resolve.
test.use({ launchOptions: { args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] } });

test('a guest opens the shared link and receives the host drawing live', async ({ browser }) => {
  test.setTimeout(120_000);
  const host = await (await browser.newContext()).newPage();
  await host.goto('/');
  await host.getByRole('button', { name: 'Rechteck', exact: true }).click();
  await host.mouse.move(300, 300); await host.mouse.down(); await host.mouse.move(500, 420, { steps: 6 }); await host.mouse.up();
  await host.getByTestId('workspace-menu-button').click();
  await host.getByRole('menuitemcheckbox', { name: 'Zusammenarbeiten', exact: true }).click();
  await host.getByRole('combobox', { name: /Zugriff/ }).selectOption('editor');
  await host.getByTestId('session-start').click();
  const link = await host.getByTestId('session-link').inputValue();

  const guest = await (await browser.newContext()).newPage();
  await guest.goto(link);
  await expect(guest.locator('.whiteboard-canvas [data-kind=rectangle]')).toHaveCount(1, { timeout: 60_000 });
  await expect(guest.getByTestId('collaboration-panel')).toContainText('Du bist in der Session');
  await expect(host.getByTestId('collaboration-panel')).toContainText('Verbunden');

  // Live edits travel both ways.
  await host.getByRole('button', { name: 'Rechteck', exact: true }).click();
  await host.mouse.move(600, 300); await host.mouse.down(); await host.mouse.move(700, 380, { steps: 6 }); await host.mouse.up();
  await expect(guest.locator('.whiteboard-canvas [data-kind=rectangle]')).toHaveCount(2, { timeout: 30_000 });

  await guest.getByRole('button', { name: 'Ellipse', exact: true }).click();
  await guest.mouse.move(300, 500); await guest.mouse.down(); await guest.mouse.move(400, 580, { steps: 6 }); await guest.mouse.up();
  await expect(host.locator('.whiteboard-canvas [data-kind=ellipse]')).toHaveCount(1, { timeout: 30_000 });
});
