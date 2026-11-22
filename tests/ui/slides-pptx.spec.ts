import { copyFile, readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
});

async function open(page: Page, theme: 'light' | 'dark' = 'light'): Promise<void> {
  await page.addInitScript((value) => { localStorage.setItem('sketchdraw.preferences.v1', JSON.stringify({ theme: value, language: 'de', canvasBackground: null })); }, theme);
  await page.goto('/');
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
}

async function drawFrame(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.getByRole('button', { name: 'Frame', exact: true }).click();
  await page.mouse.move(...from); await page.mouse.down(); await page.mouse.move(...to); await page.mouse.up();
}

/** Width and height of a PNG, from its header. */
function pngSize(bytes: Uint8Array): { width: number; height: number } {
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

test('the "…" menu of the slides exports every frame as a picture in a PowerPoint file, with the notes (#266)', async ({ page }, testInfo) => {
  await open(page);
  // Two slides: a 16:9 frame with a shape and its text, and a second frame of another proportion.
  await drawFrame(page, [260, 230], [740, 500]);
  const sidebar = page.getByTestId('frame-sidebar');
  await expect(sidebar.getByText('Folie 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
  await page.mouse.move(330, 290); await page.mouse.down(); await page.mouse.move(560, 400); await page.mouse.up();
  await page.mouse.dblclick(445, 345);
  await page.keyboard.type('Umsatz');
  await page.keyboard.press('Escape');
  await drawFrame(page, [300, 540], [540, 720]);
  await expect(sidebar.getByText('Folie 2', { exact: true })).toBeVisible();
  await sidebar.getByText('Notizen', { exact: true }).first().click();
  const notes = sidebar.getByRole('textbox', { name: 'Notizen zur Folie' }).first();
  await notes.fill('Begrüßung\nAgenda & Ziele');
  await notes.blur();

  // The menu opens from the keyboard, takes the focus, and gives it back on Escape.
  const button = sidebar.getByTestId('frame-sidebar-menu-button');
  await expect(button).toHaveAttribute('aria-haspopup', 'menu');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.focus();
  await page.keyboard.press('Enter');
  const menu = sidebar.getByRole('menu', { name: 'Weitere Aktionen für Folien' });
  const item = menu.getByRole('menuitem', { name: 'Nach PowerPoint exportieren' });
  await expect(item).toBeFocused();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  expect((await new AxeBuilder({ page }).include('[data-testid="frame-sidebar"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  // The menu lies inside the panel and its button is as large as the close button beside it.
  const [panelBox, menuBox, buttonBox, closeBox] = await Promise.all([sidebar.boundingBox(), menu.boundingBox(), button.boundingBox(), sidebar.getByRole('button', { name: 'Folienleiste schließen' }).boundingBox()]);
  expect(menuBox!.x).toBeGreaterThanOrEqual(panelBox!.x);
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width);
  expect(buttonBox!.height).toBe(closeBox!.height);
  expect(buttonBox!.y).toBe(closeBox!.y);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(button).toBeFocused();
  // A click outside closes it as well.
  await button.click();
  await expect(menu).toBeVisible();
  await page.mouse.click(120, 400);
  await expect(menu).toHaveCount(0);

  await button.click();
  const [download] = await Promise.all([page.waitForEvent('download'), item.press('Enter')]);
  expect(download.suggestedFilename()).toMatch(/\.pptx$/);
  await expect(sidebar.getByTestId('frame-export-note')).toHaveText(`Als Download übergeben: ${download.suggestedFilename()}`);
  await expect(sidebar.getByTestId('frame-export-note')).toHaveAttribute('role', 'status');
  const file = (await download.path())!;
  if (process.env['SKETCHDRAW_KEEP_PPTX']) await copyFile(file, process.env['SKETCHDRAW_KEEP_PPTX']);
  const parts = unzipSync(new Uint8Array(await readFile(file)));

  // One slide per frame, in the order of the slide bar; the deck takes the proportion of the first frame.
  expect(Object.keys(parts).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort()).toEqual(['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml']);
  const presentation = strFromU8(parts['ppt/presentation.xml']!);
  const [, cx, cy] = /<p:sldSz cx="(\d+)" cy="(\d+)"\/>/.exec(presentation)!;
  const first = pngSize(parts['ppt/media/image1.png']!);
  const second = pngSize(parts['ppt/media/image2.png']!);
  expect(Number(cx) / Number(cy)).toBeCloseTo(first.width / first.height, 2);
  expect(first.width / first.height).toBeCloseTo(480 / 270, 1);
  expect(first.width).toBeGreaterThanOrEqual(900);
  expect(second.width / second.height).toBeCloseTo(240 / 180, 1);
  expect(strFromU8(parts['ppt/slides/slide1.xml']!)).toContain(`<a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/>`);
  // The notes of the first slide, one paragraph per line; the second slide has none.
  const notesXml = strFromU8(parts['ppt/notesSlides/notesSlide1.xml']!);
  expect(notesXml).toContain('<a:t>Begrüßung</a:t>');
  expect(notesXml).toContain('<a:t>Agenda &amp; Ziele</a:t>');
  expect(parts['ppt/notesSlides/notesSlide2.xml']).toBeUndefined();

  // The pictures show the slide: the shape is drawn on a white sheet, and the frame itself and its label are not.
  const drawn = await page.evaluate(async (bytes) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    let dark = 0;
    for (let index = 0; index < data.length; index += 4) if (data[index]! + data[index + 1]! + data[index + 2]! < 380) dark += 1;
    const corner = [data[0], data[1], data[2], data[3]];
    // The top edge: a frame outline would darken it.
    let edge = 0;
    for (let x = 0; x < bitmap.width; x += 1) { const at = (2 * bitmap.width + x) * 4; if (data[at]! + data[at + 1]! + data[at + 2]! < 600) edge += 1; }
    return { dark, corner, edge };
  }, [...parts['ppt/media/image1.png']!]);
  expect(drawn.corner).toEqual([255, 255, 255, 255]);
  expect(drawn.dark).toBeGreaterThan(500);
  expect(drawn.edge).toBe(0);
  testInfo.annotations.push({ type: 'pptx', description: `${first.width}×${first.height}, ${second.width}×${second.height}` });
});

for (const theme of ['light', 'dark'] as const) {
  test(`a page without frames offers the export as unavailable; the menu follows the ${theme} theme (#266)`, async ({ page }) => {
    await open(page, theme);
    await page.getByTestId('workspace-menu-button').click();
    await page.getByTestId('workspace-menu-slides').click();
    const sidebar = page.getByTestId('frame-sidebar');
    await sidebar.getByTestId('frame-sidebar-menu-button').click();
    const item = sidebar.getByRole('menuitem', { name: 'Nach PowerPoint exportieren' });
    await expect(item).toHaveAttribute('aria-disabled', 'true');
    const surface = await sidebar.getByTestId('frame-sidebar-menu').evaluate((element) => getComputedStyle(element).backgroundColor);
    const [red, green, blue] = surface.match(/\d+/g)!.map(Number);
    if (theme === 'light') expect(red! + green! + blue!).toBeGreaterThan(700); else expect(red! + green! + blue!).toBeLessThan(250);
    expect((await new AxeBuilder({ page }).include('[data-testid="frame-sidebar"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    let downloads = 0;
    page.on('download', () => { downloads += 1; });
    // Playwright does not click what is marked as unavailable; a person can, and nothing must happen.
    await item.click({ force: true });
    await expect(sidebar.getByTestId('frame-export-note')).toHaveCount(0);
    expect(downloads).toBe(0);
  });
}
