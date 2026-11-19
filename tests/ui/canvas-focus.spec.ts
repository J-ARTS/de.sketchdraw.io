import { expect, test } from '@playwright/test';

test('the focused canvas draws no frame around the window, and stays the target of the keyboard (#238)', async ({ page }) => {
  page.on('pageerror', (error) => { throw error; });
  await page.goto('/');
  const canvas = page.getByTestId('whiteboard-canvas');
  await expect(canvas).toBeVisible();
  // The app focuses the canvas on start; without a pointer action the browser treats that as visible focus.
  await expect(canvas).toBeFocused();
  await page.keyboard.press('Shift');
  const style = await canvas.evaluate((element) => {
    const computed = getComputedStyle(element);
    return { focusVisible: element.matches(':focus-visible'), boxShadow: computed.boxShadow, outlineStyle: computed.outlineStyle };
  });
  expect(style).toEqual({ focusVisible: true, boxShadow: 'none', outlineStyle: 'none' });

  // Controls keep their focus ring.
  await page.keyboard.press('Tab');
  const next = await page.evaluate(() => {
    const element = document.activeElement as HTMLElement;
    return { isCanvas: element.dataset['testid'] === 'whiteboard-canvas', outlineStyle: getComputedStyle(element).outlineStyle };
  });
  expect(next).toEqual({ isCanvas: false, outlineStyle: 'solid' });
});
