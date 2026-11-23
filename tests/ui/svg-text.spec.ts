import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// #277: a shape shows the same lines at the same place on the canvas and in the SVG export.
test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
  await page.goto('/'); await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
});

const SHAPES = [
  { tool: 'Rechteck', kind: 'rectangle', at: [220, 200], across: 'Linksbündig', down: 'Oben' },
  { tool: 'Ellipse', kind: 'ellipse', at: [470, 200], across: 'Zentriert', down: 'Mittig' },
  { tool: 'Raute', kind: 'diamond', at: [720, 200], across: 'Rechtsbündig', down: 'Unten' },
] as const;
const TEXT = 'Ein langer Text, der in der Form umbrochen wird\nund eine zweite Zeile hat';

async function draw(page: Page, shape: (typeof SHAPES)[number]) {
  await page.getByRole('button', { name: shape.tool, exact: true }).click();
  const [x, y] = shape.at;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 200, y + 150, { steps: 6 }); await page.mouse.up();
  await expect(page.locator(`.whiteboard-canvas [data-kind=${shape.kind}]`)).toHaveCount(1);
  await page.keyboard.press('Enter');
  await page.getByTestId('canvas-text-editor').fill(TEXT);
  await page.keyboard.press('Escape');
  const bar = page.getByRole('toolbar', { name: 'Eigenschaften' });
  await bar.getByRole('button', { name: 'Waagerechte Ausrichtung' }).click();
  await page.getByRole('group', { name: 'Waagerechte Ausrichtung' }).getByRole('button', { name: shape.across }).click();
  await bar.getByRole('button', { name: 'Senkrechte Ausrichtung' }).click();
  await page.getByRole('group', { name: 'Senkrechte Ausrichtung' }).getByRole('button', { name: shape.down }).click();
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
}
/** Lines of the text of one shape on the canvas: position inside the shape (top of the line) and characters. */
async function canvasLines(page: Page, kind: string) {
  return page.locator(`.whiteboard-canvas [data-kind=${kind}] text`).evaluate((text) => ({
    anchor: text.getAttribute('text-anchor'), size: Number(text.getAttribute('font-size')),
    lines: [...text.querySelectorAll(':scope > tspan')].map((line) => ({ x: Number(line.getAttribute('x')), y: Number(line.getAttribute('y')), text: line.textContent ?? '' })),
  }));
}

test('rectangle, ellipse and diamond show the lines of the canvas in the SVG export, for all three alignments', async ({ page }) => {
  for (const shape of SHAPES) await draw(page, shape);
  const canvas = Object.fromEntries(await Promise.all(SHAPES.map(async (shape) => [shape.kind, await canvasLines(page, shape.kind)] as const)));
  // Each shape breaks the text into several lines; otherwise the comparison would prove little.
  for (const shape of SHAPES) expect(canvas[shape.kind]!.lines.length, shape.kind).toBeGreaterThan(2);

  await page.getByTestId('file-menu-button').click(); await page.getByTestId('file-menu-interopExport').click();
  await page.getByRole('combobox', { name: 'Format', exact: true }).click();
  await page.getByRole('listbox', { name: 'Format', exact: true }).getByRole('option', { name: 'SVG', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Vollständiges Sketchdraw-Modell einbetten' }).setChecked(false);
  await page.getByRole('button', { name: 'Exportvorschau erstellen', exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Datei exportieren', exact: true }).click();
  const svg = await readFile((await (await downloadEvent).path())!, 'utf8');

  const groups = [...svg.matchAll(/<g id="sd-\d+"[^>]*>(.*?)<\/g>/gs)].map((match) => match[1]!);
  expect(groups).toHaveLength(SHAPES.length);
  SHAPES.forEach((shape, index) => {
    const group = groups[index]!;
    const exported = [...group.matchAll(/<tspan x="([^"]+)" y="([^"]+)">([^<]*)<\/tspan>/g)].map((match) => ({ x: Number(match[1]), y: Number(match[2]), text: match[3]! }));
    const drawn = canvas[shape.kind]!;
    expect(/text-anchor="([a-z]+)"/.exec(group)![1], shape.kind).toBe(drawn.anchor);
    expect(exported.map((line) => line.text), shape.kind).toEqual(drawn.lines.map((line) => line.text));
    exported.forEach((line, at) => {
      expect(line.x, `${shape.kind} x ${at}`).toBeCloseTo(drawn.lines[at]!.x, 1);
      // The canvas names the top of a line, the file its baseline.
      expect(line.y - drawn.size * .93, `${shape.kind} y ${at}`).toBeCloseTo(drawn.lines[at]!.y, 1);
    });
  });
});
