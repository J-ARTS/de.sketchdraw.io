// Synthetic public test data only. Run from repository root.
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
const result = await build({ stdin: { contents: "export { createDocument, createElement, serializeDocument } from './src/domain'; export { prepareSvgExport, prepareDrawioExport } from './src/interop';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'browser', format: 'esm', write: false });
const api = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const doc = api.createDocument('Interop acceptance — synthetic');
doc.id = 'interop-external';
const make = (kind, patch) => api.createElement(kind, { ...patch, style: { ...api.createElement(kind).style, fontSize: 18, stroke: '#16243a', fill: '#e3edf8', ...patch.style } });
doc.elements = [
  make('container', { id: 'container', label: 'Synthetic workspace', x: 40, y: 40, width: 680, height: 320, style: { fill: '#f7f9fc' } }),
  make('rectangle', { id: 'input', parentId: 'container', label: 'Input label only', x: 80, y: 115, width: 170, height: 90 }),
  make('ellipse', { id: 'output', parentId: 'container', text: '', label: 'Output fallback', x: 460, y: 115, width: 190, height: 90, style: { fill: '#e6f4e8' } }),
  make('connector', { id: 'connection', parentId: 'container', label: 'Flow', x: 250, y: 160, width: 210, height: 0, points: [{ x: 0, y: 0 }, { x: 210, y: 0 }], from: { elementId: 'input', anchor: { x: 1, y: .5 } }, to: { elementId: 'output', anchor: { x: 0, y: .5 } }, style: { fill: 'transparent' } }),
  make('diamond', { id: 'choice', parentId: 'container', text: 'Choice', x: 300, y: 230, width: 150, height: 90, style: { fill: '#fff1cc' } }),
  make('text', { id: 'caption', text: 'Independent Chromium + diagrams.net check', x: 60, y: 390, width: 650, height: 50, style: { fill: 'transparent' } }),
];
const directory = 'tests/fixtures/interop/external';
await mkdir(directory, { recursive: true });
await writeFile(`${directory}/synthetic.sketchdraw.json`, api.serializeDocument(doc));
for (const [format, prepare] of [['svg', api.prepareSvgExport], ['drawio', api.prepareDrawioExport]]) {
  const output = prepare(doc);
  await writeFile(`${directory}/sketchdraw-export.${format}`, output.contents);
  await writeFile(`${directory}/sketchdraw-export.${format}.diagnostics.json`, JSON.stringify(output.diagnostics, null, 2));
}
console.log('Created synthetic SVG/draw.io acceptance fixtures.');
