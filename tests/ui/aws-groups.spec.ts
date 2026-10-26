import { expect, test, type Locator, type Page } from '@playwright/test';

// #143: AWS group frames look and behave like draw.io's "AWS / Groups".
const GROUP_NAMES = [
  'AWS Cloud', 'AWS Cloud (Logo)', 'Region', 'Availability Zone', 'Security group', 'Auto Scaling group', 'VPC', 'Private subnet', 'Public subnet',
  'Server contents', 'Corporate data center', 'Elastic Beanstalk container', 'EC2 instance contents', 'Spot Fleet', 'AWS Step Functions workflow',
  'AWS Account', 'AWS IoT Greengrass Deployment', 'AWS IoT Greengrass', 'Generic group', 'Generic group (filled)',
];

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
  await page.goto('/');
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
});

async function openGroups(page: Page) {
  await page.getByTestId('more-shapes').click();
  const sidebar = page.getByTestId('shape-library-sidebar');
  await sidebar.getByRole('button', { name: /^AWS \d+ Symbole/ }).click();
  await sidebar.getByRole('searchbox', { name: 'Formen durchsuchen' }).fill('rahmen');
  return sidebar;
}
async function closeLibrary(page: Page) {
  await page.getByTestId('shape-library-sidebar').getByRole('button', { name: 'Formen schließen' }).click();
}
const group = (page: Page, id: string) => page.locator(`[data-kind=container]:has([data-group="${id}"])`);
async function box(locator: Locator) {
  const value = await locator.boundingBox();
  if (!value) throw new Error('Element has no box');
  return value;
}
async function selectionHandles(page: Page) { return page.locator('[data-handle]').count(); }

test('the AWS library lists the twenty draw.io groups with a framed preview', async ({ page }) => {
  const sidebar = await openGroups(page);
  const tiles = sidebar.locator('.component-tile');
  await expect(tiles).toHaveCount(20);
  for (const [index, name] of GROUP_NAMES.entries()) await expect(tiles.nth(index)).toContainText(name);
  await expect(sidebar.getByRole('heading', { level: 3 })).toContainText('Gruppen');
  // The preview shows the frame and header tile; dashed groups are drawn with separate dash segments.
  await expect(tiles.nth(2).locator('svg path[stroke="#00A4A6"]')).toHaveCount(1);
  await expect(tiles.nth(6).locator('svg rect[stroke="#8C4FFF"]')).toHaveCount(1);
  await expect(tiles.nth(7).locator('svg rect[fill="#E6F6F7"]')).toHaveCount(1);
});

test('every group is placed as a container with draw.io colors, header tile and label', async ({ page }) => {
  const sidebar = await openGroups(page);
  const tiles = sidebar.locator('.component-tile');
  for (let index = 0; index < 20; index += 1) await tiles.nth(index).click();
  await closeLibrary(page);
  await expect(page.locator('[data-kind=container]')).toHaveCount(20);
  await expect(page.locator('[data-testid=aws-group-surface]')).toHaveCount(20);
  // Sixteen groups have a header tile; Availability Zone, Security group and both generic groups are plain frames.
  await expect(page.locator('[data-testid=aws-group-icon]')).toHaveCount(16);

  const vpc = group(page, 'aws.group.vpc');
  await expect(vpc.locator('rect[data-group]')).toHaveCSS('stroke', 'rgb(140, 79, 255)');
  await expect(vpc.locator('rect[data-group]')).toHaveCSS('fill', 'rgba(0, 0, 0, 0)');
  await expect(vpc.locator('text')).toHaveText('VPC');
  await expect(vpc.locator('text')).toHaveAttribute('fill', '#AAB7B8');
  const subnet = group(page, 'aws.group.private-subnet');
  await expect(subnet.locator('rect[data-group]')).toHaveCSS('fill', 'rgb(230, 246, 247)');
  await expect(subnet.locator('rect[data-group]')).toHaveCSS('stroke-width', '0px');
  await expect(group(page, 'aws.group.region').locator('rect[data-group]')).toHaveCSS('stroke-dasharray', '3px, 3px');
  await expect(group(page, 'aws.group.security-group').locator('rect[data-group]')).toHaveCSS('stroke', 'rgb(221, 53, 34)');
  await expect(group(page, 'aws.group.generic-filled').locator('rect[data-group]')).toHaveCSS('fill', 'rgb(239, 240, 243)');
});

test('the header follows draw.io proportions: a 25 unit tile and a label indented by 30 units at 12 px text', async ({ page }) => {
  const sidebar = await openGroups(page);
  await sidebar.getByRole('button', { name: /^VPC AWS$/ }).click();
  await closeLibrary(page);
  const vpc = group(page, 'aws.group.vpc');
  const surface = await box(vpc.locator('rect[data-group]'));
  const tile = await box(vpc.getByTestId('aws-group-icon'));
  const label = await box(vpc.locator('text'));
  const k = 16 / 12;
  expect(Math.abs(tile.width - 25 * k)).toBeLessThan(0.6);
  expect(Math.abs(tile.x - surface.x)).toBeLessThan(1);
  expect(Math.abs(tile.y - surface.y)).toBeLessThan(1);
  expect(label.x - surface.x).toBeGreaterThan(30 * k);
  expect(label.x - surface.x).toBeLessThan(36 * k);
  // The label sits next to the tile, vertically inside the tile's height.
  expect(label.y).toBeGreaterThanOrEqual(tile.y - 2);
  expect(label.y + label.height).toBeLessThanOrEqual(tile.y + tile.height + 4);
});

test('Auto Scaling group centers tile and label; plain groups carry the label centered on top', async ({ page }) => {
  const sidebar = await openGroups(page);
  await sidebar.getByRole('button', { name: /^Auto Scaling group AWS$/ }).click();
  await closeLibrary(page);
  const asg = group(page, 'aws.group.auto-scaling-group');
  const surface = await box(asg.locator('rect[data-group]'));
  const tile = await box(asg.getByTestId('aws-group-icon'));
  const label = await box(asg.locator('text'));
  expect(Math.abs(tile.x + tile.width / 2 - (surface.x + surface.width / 2))).toBeLessThan(1);
  expect(Math.abs(label.x + label.width / 2 - (surface.x + surface.width / 2))).toBeLessThan(3);
  expect(label.y).toBeGreaterThan(tile.y + tile.height - 2);
});

test('only the frame, tile and label of a transparent group are clickable', async ({ page }) => {
  const sidebar = await openGroups(page);
  await sidebar.getByRole('button', { name: /^VPC AWS$/ }).click();
  await closeLibrary(page);
  const surface = await box(group(page, 'aws.group.vpc').locator('rect[data-group]'));
  await page.mouse.click(surface.x + surface.width / 2, surface.y + surface.height / 2);
  expect(await selectionHandles(page)).toBe(0);
  await page.mouse.click(surface.x + 14, surface.y + 12); // header tile
  expect(await selectionHandles(page)).toBeGreaterThan(0);
  await page.mouse.click(surface.x + surface.width / 2, surface.y + surface.height / 2);
  expect(await selectionHandles(page)).toBe(0);
  await page.mouse.click(surface.x + surface.width / 2, surface.y + surface.height - 1); // bottom frame
  expect(await selectionHandles(page)).toBeGreaterThan(0);
});

test('a filled group is selected by clicking its fill', async ({ page }) => {
  const sidebar = await openGroups(page);
  await sidebar.getByRole('button', { name: /^Private subnet AWS$/ }).click();
  await closeLibrary(page);
  const surface = await box(group(page, 'aws.group.private-subnet').locator('rect[data-group]'));
  await page.mouse.click(surface.x + surface.width / 2, surface.y + surface.height / 2);
  expect(await selectionHandles(page)).toBeGreaterThan(0);
});

test('shapes dropped from the library become children and move with the group', async ({ page }) => {
  const sidebar = await openGroups(page);
  await sidebar.getByRole('button', { name: /^VPC AWS$/ }).click();
  await sidebar.getByRole('searchbox', { name: 'Formen durchsuchen' }).fill('Amazon Athena');
  const canvas = page.getByTestId('whiteboard-canvas');
  const surface = await box(group(page, 'aws.group.vpc').locator('rect[data-group]'));
  await sidebar.getByRole('button', { name: /^Amazon Athena AWS$/ }).dragTo(canvas, { targetPosition: { x: surface.x + surface.width / 2 - 20, y: surface.y + surface.height / 2 + 20 } });
  await closeLibrary(page);
  const card = page.locator('[data-cloud-provider="aws"]');
  await expect(card).toHaveCount(1);
  const before = await box(card);
  const frame = await box(group(page, 'aws.group.vpc').locator('rect[data-group]'));

  // Drag the group by its bottom frame: the child follows.
  await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height - 1);
  await page.mouse.down(); await page.mouse.move(frame.x + frame.width / 2 + 60, frame.y + frame.height + 39, { steps: 8 }); await page.mouse.up();
  const after = await box(card);
  expect(Math.round(after.x - before.x)).toBe(60);
  expect(Math.round(after.y - before.y)).toBe(40);
  const moved = await box(group(page, 'aws.group.vpc').locator('rect[data-group]'));
  expect(Math.round(moved.x - frame.x)).toBe(60);
});

test('dragging an element into a group adopts it, dragging it out lets go and the drop target is shown', async ({ page }) => {
  const sidebar = await openGroups(page);
  await sidebar.getByRole('button', { name: /^Region AWS$/ }).click();
  await closeLibrary(page);
  const region = group(page, 'aws.group.region');
  const frame = await box(region.locator('rect[data-group]'));

  // A rectangle drawn beside the group.
  const outside = { x: frame.x + frame.width + 80, y: frame.y + 40 };
  await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
  await page.mouse.move(outside.x, outside.y); await page.mouse.down(); await page.mouse.move(outside.x + 90, outside.y + 50, { steps: 6 }); await page.mouse.up();
  const rectangle = page.locator('[data-kind=rectangle]');
  await expect(rectangle).toHaveCount(1);
  const start = await box(rectangle);

  // Drag it into the group: the group is highlighted while the pointer is over it.
  const grab = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
  const inside = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
  await page.mouse.move(grab.x, grab.y); await page.mouse.down();
  await page.mouse.move(inside.x, inside.y, { steps: 10 });
  await expect(page.getByTestId('drop-target-highlight')).toHaveCount(1);
  await page.mouse.up();
  await expect(page.getByTestId('drop-target-highlight')).toHaveCount(0);

  // It now follows the group.
  const adopted = await box(rectangle);
  await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height - 1);
  await page.mouse.down(); await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height - 1 + 50, { steps: 6 }); await page.mouse.up();
  const followed = await box(rectangle);
  expect(Math.round(followed.y - adopted.y)).toBe(50);

  // Drag it out again: the group no longer moves it.
  const current = await box(rectangle);
  await page.mouse.move(current.x + current.width / 2, current.y + current.height / 2); await page.mouse.down();
  await page.mouse.move(outside.x + 40, outside.y + 20, { steps: 10 }); await page.mouse.up();
  const detached = await box(rectangle);
  const groupNow = await box(region.locator('rect[data-group]'));
  await page.mouse.move(groupNow.x + groupNow.width / 2, groupNow.y + groupNow.height - 1);
  await page.mouse.down(); await page.mouse.move(groupNow.x + groupNow.width / 2, groupNow.y + groupNow.height - 1 + 40, { steps: 6 }); await page.mouse.up();
  const stayed = await box(rectangle);
  expect(Math.abs(stayed.y - detached.y)).toBeLessThan(1);
});

test('the label of a group is edited in its header', async ({ page }) => {
  const sidebar = await openGroups(page);
  await sidebar.getByRole('button', { name: /^Public subnet AWS$/ }).click();
  await closeLibrary(page);
  const surface = await box(group(page, 'aws.group.public-subnet').locator('rect[data-group]'));
  await page.mouse.dblclick(surface.x + 70, surface.y + 14);
  const editor = page.getByTestId('canvas-text-editor');
  await expect(editor).toBeVisible();
  const editorBox = await box(editor);
  expect(editorBox.x - surface.x).toBeGreaterThan(30 * 16 / 12 - 1);
  await editor.fill('Public subnet A');
  await page.keyboard.press('Control+Enter');
  await expect(group(page, 'aws.group.public-subnet').locator('text')).toHaveText('Public subnet A');
});

test('a group is stored in the diagram code with its group id', async ({ page }) => {
  const sidebar = await openGroups(page);
  await sidebar.getByRole('button', { name: /^Private subnet AWS$/ }).click();
  await closeLibrary(page);
  await page.getByTestId('workspace-menu-button').click(); await page.getByRole('menuitemcheckbox', { name: 'Code', exact: true }).click();
  const code = await page.getByTestId('diagram-code').inputValue();
  expect(code).toContain('sketchdraw.group');
  expect(code).toContain('aws.group.private-subnet');
});
