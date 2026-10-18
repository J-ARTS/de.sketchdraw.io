import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// UI review 18.10.2026: overlap, overflow, modal focus and theme regressions (#76–#87).

type Box = { x: number; y: number; width: number; height: number };

/** True when a pointer at the element's center actually hits the element (nothing covers it). */
async function reachable(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return Boolean(hit && (hit === element || element.contains(hit)));
  });
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;
}

async function box(locator: Locator): Promise<Box> {
  const value = await locator.boundingBox();
  expect(value).not.toBeNull();
  return value!;
}

async function drawRectangle(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
  await page.mouse.move(...from); await page.mouse.down(); await page.mouse.move(...to, { steps: 8 }); await page.mouse.up();
  await expect(page.locator('.whiteboard-canvas [data-kind=rectangle]')).toHaveCount(1);
}

async function createComment(page: Page): Promise<void> {
  await drawRectangle(page, [300, 260], [520, 400]);
  await page.getByRole('button', { name: 'Kommentar', exact: true }).click();
  await page.mouse.click(410, 330);
  await page.getByRole('textbox', { name: 'Kommentar' }).fill('Schnittstelle prüfen');
  await page.getByRole('button', { name: 'Senden' }).click();
  await expect(page.getByTestId('comment-thread')).toBeVisible();
}

async function openWorkspaceItem(page: Page, name: string): Promise<void> {
  await page.getByTestId('workspace-menu-button').click();
  await page.getByRole('menu', { name: 'Arbeitsbereich' }).getByRole('menuitemcheckbox', { name }).click();
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
  await page.goto('/');
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
});

for (const [width, height] of [[320, 568], [480, 720], [1024, 768], [1280, 800], [1600, 900]] as const) {
  test(`top chrome stays reachable without overlap at ${width}×${height} (#76, #84)`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    if (width === 1600) {
      // A long title once pushed the card under the fixed 330 px toolbar inset.
      const title = page.getByTestId('document-title');
      await title.fill('Zielarchitektur Zahlungsplattform Region Europa Mitte'); await title.press('Enter');
    }
    const card = page.locator('header.doc-card');
    const tools = page.locator('.toolbar-frame');
    const workspace = page.getByRole('group', { name: 'Ansicht und Hilfe' });
    const boxes = [await box(card), await box(tools), await box(workspace)];
    for (const [index, current] of boxes.entries()) {
      expect(current.height).toBe(56);
      expect(current.x).toBeGreaterThanOrEqual(0);
      expect(current.x + current.width).toBeLessThanOrEqual(width);
      for (const other of boxes.slice(index + 1)) expect(overlaps(current, other)).toBe(false);
    }
    for (const control of [page.getByTestId('document-title'), page.getByTestId('file-menu-button'), page.getByTestId('page-switcher'), page.getByTestId('workspace-menu-button'), page.getByRole('button', { name: 'Auswahl', exact: true })]) {
      expect(await reachable(control)).toBe(true);
    }
    const zoomBar = await box(page.getByRole('group', { name: 'Ansicht und Verlauf' }));
    expect(zoomBar.x + zoomBar.width).toBeLessThanOrEqual(width);
  });
}

test('compact header moves objects, help and theme into the workspace menu (#76)', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(page.getByTestId('help-button')).toHaveCount(0);
  await page.getByTestId('workspace-menu-button').click();
  const menu = page.getByRole('menu', { name: 'Arbeitsbereich' });
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Objekte' })).toBeFocused();
  await expect(menu.getByRole('menuitem', { name: 'Tastaturhilfe' })).toBeVisible();
  await menu.getByRole('menuitemcheckbox', { name: 'Dunkles Design' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('side panels open below the top chrome with reachable headers (#84)', async ({ page }) => {
  for (const viewport of [{ width: 1024, height: 768 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    await page.getByTestId('objects-toggle').click();
    expect(await reachable(page.getByRole('button', { name: 'Objekte schließen' }))).toBe(true);
    await page.getByRole('button', { name: 'Objekte schließen' }).click();

    await openWorkspaceItem(page, 'Code');
    expect(await reachable(page.getByRole('button', { name: 'Codeansicht schließen' }))).toBe(true);
    await page.getByRole('button', { name: 'Codeansicht schließen' }).click();

    await page.getByTestId('more-shapes').click();
    expect(await reachable(page.getByRole('button', { name: 'Formen schließen' }))).toBe(true);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Folienleiste öffnen' }).click();
    expect(await reachable(page.getByRole('button', { name: 'Folienleiste schließen' }))).toBe(true);
    await page.getByRole('button', { name: 'Folienleiste schließen' }).click();
  }
  await createComment(page);
  expect(await reachable(page.getByRole('button', { name: 'Kommentarleiste schließen' }))).toBe(true);
  expect(await reachable(page.getByRole('heading', { name: 'Kommentare', exact: true }))).toBe(true);
});

test('the shape library header stays compact on desktop and compact screens (#89)', async ({ page }) => {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 480, height: 720 }]) {
    await page.setViewportSize(viewport);
    await page.getByTestId('more-shapes').click();
    const library = page.getByTestId('shape-library-sidebar');
    const title = await box(library.getByRole('heading', { name: 'Formen' }));
    const close = await box(library.getByRole('button', { name: 'Formen schließen' }));
    const panel = await box(library);
    expect(close.y - panel.y).toBeLessThanOrEqual(10);
    expect(Math.abs(title.y + title.height / 2 - (close.y + close.height / 2))).toBeLessThanOrEqual(1);
    await page.keyboard.press('Escape');
  }
});

test('the slides button stays right-aligned below the user menu (#85)', async ({ page }) => {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 480, height: 720 }]) {
    await page.setViewportSize(viewport);
    const slidesButton = page.getByRole('button', { name: 'Folienleiste öffnen' });
    const slides = await box(slidesButton);
    const workspace = await box(page.getByRole('group', { name: 'Ansicht und Hilfe' }));
    const toolbar = await box(page.getByRole('toolbar', { name: 'Werkzeuge' }));
    expect(Math.abs(slides.x + slides.width - (workspace.x + workspace.width))).toBeLessThanOrEqual(1);
    expect(slides.y).toBeGreaterThanOrEqual(workspace.y + workspace.height);
    expect(overlaps(slides, workspace)).toBe(false);
    expect(overlaps(slides, toolbar)).toBe(false);
    expect(await reachable(slidesButton)).toBe(true);
    if (viewport.width > 760) expect(overlaps(slides, await box(page.getByTestId('minimap')))).toBe(false);
  }
});

test('the shape library stays above the properties bar on compact screens (#77)', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 720 });
  await drawRectangle(page, [140, 320], [320, 440]);
  await expect(page.getByRole('toolbar', { name: 'Eigenschaften' })).toBeVisible();
  await page.getByTestId('more-shapes').click();
  const library = page.getByTestId('shape-library-sidebar');
  expect(await reachable(library.getByRole('button', { name: 'Formen schließen' }))).toBe(true);
  expect(await reachable(library.getByRole('heading', { name: 'Formen' }))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(library).toHaveCount(0);
  await expect(page.getByTestId('more-shapes')).toBeFocused();
});

test('overflowing bars show edge buttons and keep every action reachable (#78)', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  const scroller = page.getByTestId('main-toolbar');
  const start = page.getByTestId('toolbar-scroll-start'); const end = page.getByTestId('toolbar-scroll-end');
  await expect(start).toBeHidden(); await expect(end).toBeVisible();
  expect(await reachable(page.getByRole('button', { name: 'Auswahl', exact: true }))).toBe(true);
  await end.click();
  await expect(start).toBeVisible();
  await start.click();
  await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBe(0);

  // Mouse wheel scrolls horizontally; keyboard End reveals the last tool inside the visible area.
  await scroller.hover(); await page.mouse.wheel(0, 240);
  await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Auswahl', exact: true }).focus();
  await page.keyboard.press('End');
  const laser = page.getByRole('button', { name: 'Laserpointer', exact: true });
  await expect(laser).toBeFocused();
  // Measure both rects in one frame: the edge buttons toggle (and resize the scroller) right after the scroll.
  await expect.poll(() => laser.evaluate((element) => {
    const item = element.getBoundingClientRect(); const area = element.closest('[role=toolbar]')!.getBoundingClientRect();
    return item.left >= area.left - 1 && item.right <= area.right + 1;
  })).toBe(true);
  expect(await reachable(laser)).toBe(true);

  await page.setViewportSize({ width: 320, height: 568 });
  await drawRectangle(page, [60, 300], [220, 420]);
  const bar = page.getByRole('toolbar', { name: 'Eigenschaften' });
  await expect(bar).toBeVisible();
  const barEnd = page.getByTestId('properties-scroll-end');
  await expect(barEnd).toBeVisible();
  await barEnd.click();
  await expect(page.getByTestId('properties-scroll-start')).toBeVisible();
  const actions = bar.getByRole('button', { name: 'Elementaktionen' });
  await actions.focus();
  expect(await reachable(actions)).toBe(true);
});

test('a popover stays on screen when the selection reaches above the viewport (#86)', async ({ page }) => {
  await drawRectangle(page, [300, 260], [900, 700]);
  // Zoom around a point beside the shape: the properties bar moves under a centered pointer and would take the wheel.
  await page.mouse.move(1000, 560);
  await page.keyboard.down('Control');
  for (let i = 0; i < 6; i += 1) await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  const shape = page.locator('.whiteboard-canvas [data-kind=rectangle]');
  await expect.poll(async () => (await box(shape)).y).toBeLessThan(0);
  await page.getByRole('toolbar', { name: 'Eigenschaften' }).getByRole('button', { name: 'Farbe' }).click();
  const popover = page.getByRole('group', { name: 'Farbe', exact: true });
  await expect(popover).toBeVisible();
  const popoverBox = await box(popover);
  expect(popoverBox.y).toBeGreaterThanOrEqual(0);
  expect(popoverBox.y + popoverBox.height).toBeLessThanOrEqual(800);
  await expect(popover.getByRole('button').first()).toBeFocused();
});

test('the plugin dialog keeps focus inside and returns it on Escape (#79)', async ({ page }) => {
  await openWorkspaceItem(page, 'Plugin-Einstellungen');
  const dialog = page.getByRole('dialog', { name: 'Plugins' });
  const close = dialog.getByRole('button', { name: 'Plugin-Einstellungen schließen' });
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((element) => element.contains(document.activeElement) && element !== document.activeElement)).toBe(true);
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  // The workspace behind the modal is inert: a background control cannot take focus.
  expect(await page.locator('.bottom-tools button').first().evaluate((element: HTMLElement) => { element.focus(); return document.activeElement === element; })).toBe(false);
  expect((await new AxeBuilder({ page }).include('.plugin-panel').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('workspace-menu-button')).toBeFocused();
});

test('comment actions, task dialog and search fields follow keyboard and theme rules (#80, #81, #82, #87)', async ({ page }) => {
  await createComment(page);

  // #87: the comment search shows a visible focus indicator.
  const commentSearch = page.getByRole('searchbox', { name: 'Kommentare suchen' });
  await commentSearch.focus();
  expect(await commentSearch.evaluate((element) => getComputedStyle(element.parentElement!).outlineStyle)).toBe('solid');

  // #82: ARIA menu button with roving focus, Escape and a light surface in light mode.
  const trigger = page.getByRole('button', { name: 'Weitere Kommentaraktionen' });
  await trigger.focus(); await page.keyboard.press('ArrowDown');
  const menu = page.getByRole('menu', { name: 'Kommentaraktionen' });
  await expect(menu.getByRole('menuitem', { name: 'Als ungelesen markieren' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: 'Thread löschen' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(menu.getByRole('menuitem', { name: 'Als ungelesen markieren' })).toBeFocused();
  expect(await menu.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(255, 255, 255)');
  expect((await new AxeBuilder({ page }).include('.thread-menu').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await menu.getByRole('menuitem', { name: 'Aufgabe erstellen' }).click();
  await expect(trigger).toBeFocused();

  await page.getByTestId('page-switcher').click(); await page.getByTestId('task-board-entry').click();
  const board = page.getByTestId('task-board');
  await expect(board).toBeVisible();

  // #87: the task search shows a visible focus indicator.
  const taskSearch = board.getByRole('searchbox', { name: 'Aufgaben suchen' });
  await taskSearch.focus();
  expect(await taskSearch.evaluate((element) => getComputedStyle(element.parentElement!).outlineStyle)).toBe('solid');

  // #80: initial focus, wrapped Tab order, Escape and focus return to the card.
  await page.setViewportSize({ width: 480, height: 320 });
  const card = board.locator('.card-open').first();
  await card.click();
  const dialog = page.getByRole('dialog', { name: 'Aufgabe bearbeiten' });
  await expect(dialog.getByRole('textbox', { name: 'Titel' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Schließen' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Speichern' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Schließen' })).toBeFocused();

  // #81: every action stays inside the 480 × 320 viewport, above the global header.
  for (const name of ['Löschen', 'Kommentar öffnen', 'Speichern']) {
    const action = dialog.getByRole('button', { name });
    const actionBox = await box(action);
    expect(actionBox.y + actionBox.height).toBeLessThanOrEqual(320);
    expect(await reachable(action)).toBe(true);
  }
  expect(await dialog.evaluate((element) => element.matches(':modal'))).toBe(true);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(card).toBeFocused();
});
