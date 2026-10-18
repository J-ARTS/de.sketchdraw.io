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
  await expect(sidebar.getByText('Komponentenset', { exact: false })).toHaveCount(0);
  await expect(sidebar.locator('input[type=file]')).toHaveCount(0);
  for (const [label, count] of [['AWS', 784], ['Azure', 713], ['Google Cloud', 235], ['Kubernetes', 39]] as const) {
    await expect(sidebar.getByRole('button', { name: new RegExp(`^${label} ${count} Symbole`) })).toBeVisible();
  }

  await sidebar.getByRole('button', { name: /^AWS 784 Symbole/ }).click();
  const categories = sidebar.locator('.category-toggle');
  await expect(categories.first()).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => categories.count()).toBeGreaterThan(30); // full library replaced the starter set
  await expect(categories.nth(1)).toHaveAttribute('aria-expanded', 'false');
  const compute = sidebar.getByRole('button', { name: /^Compute \d+/ });
  await compute.click();
  await expect(compute).toHaveAttribute('aria-expanded', 'true');
  await expect(sidebar.getByRole('button', { name: /^Amazon EC2 AWS/ })).toBeVisible();
  expect((await new AxeBuilder({ page }).include('[data-testid=shape-library-sidebar]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);

  await sidebar.getByRole('searchbox', { name: 'Formen durchsuchen' }).fill('cloud9');
  await expect(sidebar.getByRole('button', { name: /^AWS Cloud9 AWS/ })).toBeVisible();
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
