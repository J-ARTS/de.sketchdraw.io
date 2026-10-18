import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// #92 full official icon libraries, #93 no custom set import in the library.
test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
  await page.goto('/');
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
  await page.getByTestId('more-shapes').click();
});

test('provider pages load the full official libraries in collapsible categories', async ({ page }) => {
  const sidebar = page.getByTestId('shape-library-sidebar');
  for (const [label, count] of [['AWS', 784], ['Azure', 713], ['Google Cloud', 235], ['Kubernetes', 39]] as const) {
    await expect(sidebar.getByRole('button', { name: new RegExp(`^${label} ${count} Symbole`) })).toBeVisible();
  }

  await sidebar.getByRole('button', { name: /^AWS 784 Symbole/ }).click();
  await expect(sidebar.getByText('Offizielle Architektur-Symbole.', { exact: false })).toHaveCount(0);
  const categories = sidebar.locator('.category-toggle');
  await expect(categories.first()).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => categories.count()).toBeGreaterThan(30); // full library replaced the starter set
  await expect(categories.nth(1)).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => sidebar.locator('.component-group .component-grid').first().evaluate((element) => getComputedStyle(element).paddingBottom)).toBe('16px');
  const compute = sidebar.getByRole('button', { name: /^Compute \d+/ });
  await compute.click();
  await expect(compute).toHaveAttribute('aria-expanded', 'true');
  await expect(sidebar.getByRole('button', { name: /^Amazon EC2 AWS/ })).toBeVisible();
  expect((await new AxeBuilder({ page }).include('[data-testid=shape-library-sidebar]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);

  await sidebar.getByRole('searchbox', { name: 'Formen durchsuchen' }).fill('cloud9');
  await expect(sidebar.getByRole('button', { name: /^AWS Cloud9 AWS/ })).toBeVisible();
});

test('cloud icons drag to square provider cards at the pointer for every official library', async ({ page }) => {
  const sidebar = page.getByTestId('shape-library-sidebar');
  const search = sidebar.getByRole('searchbox', { name: 'Formen durchsuchen' });
  const canvas = page.getByTestId('whiteboard-canvas');
  const cases = [
    { query: 'Amazon Athena', name: /^Amazon Athena AWS$/, provider: 'aws', x: 220, y: 310 },
    { query: 'Virtual Machine', name: /^Virtual Machine AZURE$/, provider: 'azure', x: 410, y: 310 },
    { query: 'BigQuery', name: /^BigQuery GCP$/, provider: 'gcp', x: 220, y: 510 },
    { query: 'Pod', name: /^Pod KUBERNETES$/, provider: 'kubernetes', x: 410, y: 510 },
  ] as const;

  for (const item of cases) {
    await search.fill(item.query);
    const tile = sidebar.getByRole('button', { name: item.name });
    await expect(tile).toBeVisible();
    await tile.dragTo(canvas, { targetPosition: { x: item.x, y: item.y } });
    const card = page.locator(`[data-cloud-provider="${item.provider}"]`);
    await expect(card).toHaveCount(1);
    const box = await card.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(168);
    expect(box?.width).toBeLessThanOrEqual(171);
    expect(Math.abs((box?.width ?? 0) - (box?.height ?? 0))).toBeLessThan(0.5);
    expect(Math.abs((box?.x ?? 0) + (box?.width ?? 0) / 2 - item.x)).toBeLessThan(3);
    expect(Math.abs((box?.y ?? 0) + (box?.height ?? 0) / 2 - item.y)).toBeLessThan(3);
    await expect(card.getByTestId('cloud-component-surface')).toBeVisible();
    await expect(card.getByTestId('cloud-component-content')).toContainText(item.provider === 'gcp' ? 'GCP' : item.provider.toUpperCase());
    const title = card.getByTestId('cloud-component-title');
    const provider = card.getByTestId('cloud-component-provider');
    const titleY = Number(await title.getAttribute('y'));
    const titleLines = await title.locator('tspan').count();
    const providerY = Number(await provider.getAttribute('y'));
    expect(providerY - (titleY + (titleLines - 1) * 18)).toBe(24);
    expect(providerY).toBeLessThan((box?.height ?? 0) - 10);
  }

  expect((await new AxeBuilder({ page }).include('.whiteboard-canvas').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
});

test('multi-line cloud card titles keep a compact gap before the provider label', async ({ page }) => {
  const sidebar = page.getByTestId('shape-library-sidebar');
  await sidebar.getByRole('searchbox', { name: 'Formen durchsuchen' }).fill('Azure Machine Learning');
  await sidebar.getByRole('button', { name: /^Azure Machine Learning AZURE$/ }).click();
  await sidebar.getByRole('button', { name: 'Formen schließen' }).click();

  const card = page.locator('[data-cloud-provider="azure"]');
  const title = card.getByTestId('cloud-component-title');
  await expect(title.locator('tspan')).toHaveText(['Azure Machine', 'Learning']);
  const titleY = Number(await title.getAttribute('y'));
  const providerY = Number(await card.getByTestId('cloud-component-provider').getAttribute('y'));
  expect(providerY - (titleY + 18)).toBe(24);
});

test('global search finds official icons and inserting embeds only their category set', async ({ page }) => {
  const sidebar = page.getByTestId('shape-library-sidebar');
  await sidebar.getByRole('searchbox', { name: 'Formen durchsuchen' }).fill('lambda');
  // Resource icons only exist in the full library, so their presence means it replaced the starter set.
  await expect(sidebar.getByRole('button', { name: /^Lambda Function · AWS Lambda AWS/ })).toBeVisible();
  const lambda = sidebar.getByRole('button', { name: /^AWS Lambda AWS/ });
  await expect(lambda).toHaveCount(1);
  await lambda.click();
  await expect(page.locator('.whiteboard-canvas [data-kind=component]')).toHaveCount(1);
  await sidebar.getByRole('button', { name: 'Formen schließen' }).click();

  await page.getByTestId('workspace-menu-button').click(); await page.getByRole('menuitemcheckbox', { name: 'Code', exact: true }).click();
  const code = await page.getByTestId('diagram-code').inputValue();
  expect(code).toContain('sketchdraw.aws.compute');
  expect(code).not.toContain('sketchdraw.aws.storage');
  expect(code).not.toContain('sketchdraw.azure.');
});
