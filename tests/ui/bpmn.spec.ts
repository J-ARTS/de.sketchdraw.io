import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => { throw error; });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
});

async function library(page: Page): Promise<Locator> {
  const panel = page.getByTestId('shape-library-sidebar');
  if (!(await panel.count())) { await page.getByTestId('more-shapes').click(); await page.getByTestId('open-diagram-library-bpmn').click(); }
  return panel;
}
const box = async (locator: Locator) => (await locator.boundingBox())!;

test('the BPMN library draws events with their borders and symbols and activities with type symbols and markers (#196)', async ({ page }) => {
  const panel = await library(page);
  await expect(panel.getByRole('button', { name: 'Start: Nachricht' })).toBeVisible();
  for (const name of ['Zwischenereignis', 'Nachricht senden', 'Ende: Fehler', 'Benutzeraufgabe', 'Serviceaufgabe', 'Teilprozess', 'Aufrufaktivität', 'Mehrfachinstanz (parallel)', 'Ereignisbasiertes Gateway', 'Pool mit drei Bahnen']) {
    await expect(panel.getByRole('button', { name, exact: true })).toHaveCount(1);
  }
  const canvas = page.locator('.whiteboard-canvas');
  await panel.getByRole('button', { name: 'Nachricht senden', exact: true }).click();
  const event = canvas.locator('[data-kind="ellipse"]');
  // An intermediate event has a second ring, and a throwing event a filled symbol.
  await expect(event.getByTestId('bpmn-inner-ring')).toHaveCount(1);
  expect(await event.getByTestId('bpmn-icon').locator('path').first().getAttribute('fill')).not.toBe('none');
  await panel.getByRole('button', { name: 'Teilprozess', exact: true }).click();
  await expect(canvas.locator('[data-kind="rectangle"]').getByTestId('bpmn-marker')).toHaveCount(1);
  await panel.getByRole('button', { name: 'Benutzeraufgabe', exact: true }).click();
  await expect(canvas.locator('[data-kind="rectangle"]').getByTestId('bpmn-icon')).toHaveCount(1);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
});

test('a pool has a vertical title strip, its lanes fill it, follow its size and take elements in like groups (#196)', async ({ page }) => {
  const panel = await library(page);
  await panel.getByRole('button', { name: 'Pool mit drei Bahnen', exact: true }).dragTo(page.getByTestId('whiteboard-canvas'), { targetPosition: { x: 520, y: 480 } });
  await panel.getByRole('button', { name: 'Aufgabe', exact: true }).dragTo(page.getByTestId('whiteboard-canvas'), { targetPosition: { x: 480, y: 480 } });
  await panel.getByRole('button', { name: 'Formen schließen' }).click();
  const canvas = page.locator('.whiteboard-canvas');
  const containers = canvas.locator('[data-kind="container"]');
  await expect(containers).toHaveCount(4);
  const pool = containers.nth(0);
  const lanes = [containers.nth(1), containers.nth(2), containers.nth(3)];
  // Titles run bottom to top in a strip at the left edge.
  await expect(pool.getByTestId('swimlane-title')).toHaveText('Pool');
  const title = await box(pool.getByTestId('swimlane-title'));
  expect(title.height).toBeGreaterThan(title.width);
  const frame = await box(pool.locator('rect').first());
  for (const lane of lanes) {
    const laneBox = await box(lane.locator('rect').first());
    expect(Math.abs(laneBox.x - (frame.x + 32))).toBeLessThanOrEqual(2);
    expect(Math.abs(laneBox.x + laneBox.width - (frame.x + frame.width))).toBeLessThanOrEqual(2);
  }

  // The task was dropped into the middle lane: it belongs to it, so moving the pool by a lane takes it along.
  const task = canvas.locator('[data-kind="rectangle"]');
  const taskBefore = await box(task);
  await page.mouse.click(720, 160);
  const middle = await box(lanes[1]!.locator('rect').first());
  await page.mouse.move(middle.x + 16, middle.y + middle.height / 2);
  await page.mouse.down();
  await page.mouse.move(middle.x + 16 + 60, middle.y + middle.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  const taskAfter = await box(task);
  expect(Math.round(taskAfter.x - taskBefore.x)).toBe(60);
  expect(Math.round(taskAfter.y - taskBefore.y)).toBe(40);
  const moved = await box(pool.locator('rect').first());
  expect(Math.round(moved.x - frame.x)).toBe(60);

  // Select the pool by its title strip and drag its lower right corner: all lanes follow the width.
  await page.mouse.click(720, 160);
  await page.mouse.click(moved.x + 10, moved.y + 20);
  const handle = await box(page.locator('[data-handle=se]'));
  await page.mouse.move(handle.x + 5, handle.y + 5);
  await page.mouse.down();
  await page.mouse.move(handle.x + 5 + 180, handle.y + 5 + 90, { steps: 8 });
  await page.mouse.up();
  const wide = await box(pool.locator('rect').first());
  expect(Math.abs(wide.width - moved.width - 180)).toBeLessThanOrEqual(3);
  let bottom = 0;
  for (const lane of lanes) {
    const laneBox = await box(lane.locator('rect').first());
    expect(Math.abs(laneBox.x + laneBox.width - (wide.x + wide.width))).toBeLessThanOrEqual(2);
    bottom = Math.max(bottom, laneBox.y + laneBox.height);
  }
  expect(Math.abs(bottom - (wide.y + wide.height))).toBeLessThanOrEqual(2);

  // "Add lane" appends a fourth lane and makes the pool taller.
  await page.getByRole('toolbar', { name: 'Eigenschaften' }).getByRole('button', { name: 'Bahn hinzufügen' }).click();
  await expect(containers).toHaveCount(5);
  await expect(containers.nth(4).getByTestId('swimlane-title')).toHaveText('Bahn 4');
  const taller = await box(pool.locator('rect').first());
  expect(taller.height).toBeGreaterThan(wide.height + 50);

  // One undo step each.
  await page.getByTestId('whiteboard-canvas').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(containers).toHaveCount(4);
  await page.keyboard.press('ControlOrMeta+z');
  expect(Math.abs((await box(pool.locator('rect').first())).width - moved.width)).toBeLessThanOrEqual(1);
});

test('the Mermaid code of a process is under the element actions and runs along with the canvas (#206)', async ({ page }) => {
  const panel = await library(page);
  await panel.getByRole('button', { name: 'Beispiel: einfacher Prozess', exact: true }).click();
  await panel.getByRole('button', { name: 'Formen schließen' }).click();
  const canvas = page.locator('.whiteboard-canvas');
  const toolbar = page.getByRole('toolbar', { name: 'Eigenschaften' });
  await toolbar.getByRole('button', { name: 'Elementaktionen' }).click();
  await page.getByRole('button', { name: 'Mermaid-Code anzeigen' }).click();
  const code = page.getByRole('complementary', { name: 'Mermaid-Code' });
  await expect(code.getByRole('heading', { name: 'Ablauf als Mermaid-Code' })).toBeVisible();
  const editor = code.getByRole('textbox', { name: 'Mermaid-Code des Diagramms' });
  const status = code.getByTestId('diagram-code-status');
  const example = 'flowchart LR\n    e1(( )):::start-message\n    t1(Antrag prüfen)\n    g1{X}\n    e2(( )):::end\n    e1 --> t1\n    t1 --> g1\n    g1 --> e2\n';
  await expect(editor).toHaveValue(example);
  expect((await new AxeBuilder({ page }).include('[data-testid="diagram-code-panel"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);

  // Code → canvas: a new text, a new kind, a new step with its arrows; nothing that was there moves.
  const task = canvas.locator('[data-kind="rectangle"]').filter({ hasText: 'Antrag prüfen' });
  const place = await box(task);
  await editor.fill(example.replace('t1(Antrag prüfen)', 't1(Antrag bewerten):::user-task').replace('g1 --> e2\n', 'g1 -->|ok| e2\n    g1 -->|nein| t2(Nachfragen):::send-task\n    t2 --> t1\n'));
  const changed = canvas.locator('[data-kind="rectangle"]').filter({ hasText: 'Antrag bewerten' });
  await expect(changed).toBeVisible();
  await expect(changed.getByTestId('bpmn-icon')).toBeVisible();
  expect(await box(changed)).toEqual(place);
  const added = canvas.locator('[data-kind="rectangle"]').filter({ hasText: 'Nachfragen' });
  await expect(added).toBeVisible();
  await expect(canvas.locator('[data-kind="connector"]')).toHaveCount(5);
  await expect(canvas.getByTestId('connector-label').filter({ hasText: 'nein' })).toBeVisible();
  await expect(status).toHaveText('Code und Zeichenfläche sind auf demselben Stand.');
  // The new step covers none of the others.
  const fresh = await box(added);
  for (const other of await canvas.locator('[data-kind="ellipse"], [data-kind="diamond"]').all()) {
    const at = await box(other);
    expect(at.x + at.width <= fresh.x || fresh.x + fresh.width <= at.x || at.y + at.height <= fresh.y || fresh.y + fresh.height <= at.y).toBe(true);
  }

  // While the code cannot be read, the canvas stays as it is and the line is named.
  await editor.fill(example.replace('g1{X}', 'g1{X'));
  await expect(status).toHaveText('Nicht übernommen, solange der Code Fehler hat.');
  await expect(code.getByRole('button', { name: /Zeile 4.*Fehler/ })).toBeVisible();
  await page.waitForTimeout(700);
  await expect(added).toBeVisible();

  // Canvas → code: a text changed on the canvas shows in the code at once.
  await page.keyboard.press('Escape');
  await page.mouse.click(200, 800);
  const now = await box(added);
  await page.mouse.dblclick(now.x + now.width / 2, now.y + now.height / 2 + 12);
  await expect(page.getByTestId('canvas-text-editor')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Unterlagen anfordern');
  await page.keyboard.press('ControlOrMeta+Enter');
  // The unreadable code in the editor is not thrown away: the panel says that the canvas moved on and offers to load it.
  await expect(status).toHaveText('Das Diagramm hat sich auf der Zeichenfläche geändert. Dein Code ist noch nicht übernommen.');
  await expect(editor).toHaveValue(/g1\{X\n/);
  await code.getByRole('button', { name: 'Vom Diagramm laden' }).click();
  await expect(editor).toHaveValue(/ {4}t2\(Unterlagen anfordern\):::send-task\n/);
  await expect(editor).toHaveValue(/ {4}g1 -->\|nein\| t2\n/);
  await expect(status).toHaveText('Code und Zeichenfläche sind auf demselben Stand.');
  // From now on the canvas shows in the code at once.
  await page.mouse.click(200, 800);
  const again = await box(changed);
  await page.mouse.dblclick(again.x + again.width / 2, again.y + again.height / 2 + 12);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Antrag sichten');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(editor).toHaveValue(/ {4}t1\(Antrag sichten\):::user-task\n/);
});

test('pools and lanes are subgraphs in the code, and steps written into a lane appear in it (#206)', async ({ page }) => {
  const panel = await library(page);
  await panel.getByRole('button', { name: 'Pool mit zwei Bahnen', exact: true }).click();
  await panel.getByRole('button', { name: 'Formen schließen' }).click();
  const canvas = page.locator('.whiteboard-canvas');
  await page.getByRole('toolbar', { name: 'Eigenschaften' }).getByRole('button', { name: 'Elementaktionen' }).click();
  await page.getByRole('button', { name: 'Mermaid-Code anzeigen' }).click();
  const editor = page.getByRole('complementary', { name: 'Mermaid-Code' }).getByRole('textbox', { name: 'Mermaid-Code des Diagramms' });
  await expect(editor).toHaveValue('flowchart LR\n    subgraph p1 [Pool]\n        subgraph l1 [Bahn 1]\n        end\n        subgraph l2 [Bahn 2]\n        end\n    end\n');
  await editor.fill('flowchart LR\n    subgraph p1 [Bestellung]\n        subgraph l1 [Vertrieb]\n            e1((Start)):::start\n            t1(Prüfen)\n        end\n        subgraph l2 [Lager]\n            t2(Liefern):::service-task\n        end\n    end\n    e1 --> t1\n    t1 --> t2\n');
  const lanes = canvas.locator('[data-kind="container"]').filter({ has: page.getByTestId('swimlane-title') });
  await expect(canvas.getByTestId('swimlane-title').filter({ hasText: 'Vertrieb' })).toBeVisible();
  await expect(canvas.getByTestId('swimlane-title').filter({ hasText: 'Bestellung' })).toBeVisible();
  const check = canvas.locator('[data-kind="rectangle"]').filter({ hasText: 'Prüfen' });
  const deliver = canvas.locator('[data-kind="rectangle"]').filter({ hasText: 'Liefern' });
  await expect(check).toBeVisible();
  await expect(deliver).toBeVisible();
  await expect(canvas.locator('[data-kind="connector"]')).toHaveCount(2);
  // Each step lies inside its lane.
  const sales = await box(lanes.filter({ hasText: 'Vertrieb' }).locator('g[stroke] > rect').first());
  const store = await box(lanes.filter({ hasText: 'Lager' }).locator('g[stroke] > rect').first());
  const [a, b] = [await box(check), await box(deliver)];
  expect(a.y >= sales.y && a.y + a.height <= sales.y + sales.height).toBe(true);
  expect(b.y >= store.y && b.y + b.height <= store.y + store.height).toBe(true);
  // They are clickable in their lanes: a click selects the step, not the lane.
  await page.keyboard.press('Escape');
  await page.mouse.click(a.x + a.width / 2, a.y + a.height / 2);
  await expect(page.getByRole('toolbar', { name: 'Eigenschaften' }).getByRole('button', { name: 'Form ändern' })).toBeVisible();
});
