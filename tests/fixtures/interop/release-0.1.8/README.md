# Exporte des Release 0.1.8

Diese sechs Dateien hat der Exporter des Tags `v0.1.8` (`d6bec6c`) am 22.11.2026 geschrieben, jeweils mit eingebettetem
Dokument. Sie werden nie neu erzeugt: `tests/unit/interop/release-compat.spec.ts` prüft an ihnen, dass ein unverändertes
Release-Dokument weiterhin verlustfrei zurückkommt und eine nachträglich geänderte Darstellung weiterhin erkannt wird
(#272).

- `ec2-v0.1.8.*` – eine EC2-Karte (150 × 150) und das Dokumentattribut `owner`.
- `mixed-v0.1.8.*` – Rechteck, Ellipse, Text, Haftnotiz, Pfeil, Ressourcenkarte mit zwei Links, ein Dienst und ein
  isometrisches Icon mit geleertem Text sowie ein Kubernetes-Pod.

Ändert sich die sichtbare Darstellung eines Formats, bekommt sie eine neue Nummer (`CURRENT_PROJECTION` in
`src/interop/common.ts`); die bisherige bleibt für den Vergleich zeichenbar. Für ein späteres Release kommen neue
Dateien in einen eigenen Ordner dazu.

## Erzeugung

In einem Checkout des Tags als `tests/unit/zz-fixture.spec.ts` ablegen und mit
`npx vitest run --config vitest.config.ts tests/unit/zz-fixture.spec.ts` ausführen (Ausgabeordner `./out` vorher anlegen):

```ts
import { writeFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { createController, createDocument, createElement, type DesktopBridge } from '@/domain';
import { createWhiteboardStore } from '@/renderer/state/whiteboard';
import { builtInComponentSets } from '@/catalog';
import { prepareDrawioExport, prepareMermaidExport, prepareSvgExport } from '@/interop';

const bridge: DesktopBridge = {
  platform: 'electron', openDocument: vi.fn(async () => ({ status: 'cancelled' as const })), saveDocument: vi.fn(async () => ({ status: 'cancelled' as const })),
  exportFile: vi.fn(async () => ({ status: 'cancelled' as const })), openExternal: vi.fn(async () => {}), onCloseRequested: () => () => {}, respondToClose: vi.fn(async () => {}), onMenuCommand: () => () => {},
};
const set = (id: string) => builtInComponentSets.find((candidate) => candidate.id === id)!;

test('writes fixtures', async () => {
  const names = builtInComponentSets.map((entry) => `${entry.id}: ${entry.components.slice(0, 3).map((c) => c.type).join(', ')}`);
  writeFileSync('./out/sets.txt', names.join('\n'));

  // 1) The audit case: one EC2 card (150 x 150) and a document attribute.
  const ec2 = createDocument('EC2'); ec2.metadata = { owner: 'platform-team' };
  const store = createWhiteboardStore({ bridge, controller: createController(ec2) });
  store.setViewportSize(1000, 700);
  const aws = set('sketchdraw.aws');
  await store.insertComponent(aws, 'aws.compute.instance'); await store.whenIdle();
  const ec2Doc = JSON.parse(JSON.stringify(store.state.document));
  ec2Doc.elements[0].width = 150; ec2Doc.elements[0].height = 150;
  writeFileSync('./out/ec2-v0.1.8.svg', prepareSvgExport(ec2Doc).contents);
  writeFileSync('./out/ec2-v0.1.8.drawio', prepareDrawioExport(ec2Doc).contents);
  writeFileSync('./out/ec2-v0.1.8.mmd', prepareMermaidExport(ec2Doc).contents);
  store.dispose();

  // 2) A mixed page without the large cloud sets: shapes, text, a note, a curved connector, a resource card with
  //    links, a component whose text was emptied and an icon whose text was emptied.
  const mixed = createDocument('Mixed');
  const page = mixed.pages[0]!.id;
  mixed.elements = [
    createElement('rectangle', { id: 'el:rect', x: 40, y: 40, width: 160, height: 90, text: 'API', pageId: page }),
    createElement('ellipse', { id: 'el:ellipse', x: 320, y: 40, width: 140, height: 90, text: 'Queue', pageId: page }),
    createElement('text', { id: 'el:text', x: 40, y: 180, width: 200, height: 30, text: 'Erste Zeile\nZweite Zeile', pageId: page }),
    createElement('sticky-note', { id: 'el:note', x: 320, y: 180, text: 'Notiz', author: 'Jeremy', pageId: page }),
  ];
  const mixedStore = createWhiteboardStore({ bridge, controller: createController(mixed) });
  mixedStore.setViewportSize(1000, 700);
  let column = 0;
  for (const [setId, type] of [['sketchdraw.generic', 'generic.service'], ['sketchdraw.resource-cards', 'generic.resource-card'], ['sketchdraw.isometric', 'generic.isometric.instance'], ['sketchdraw.kubernetes', 'kubernetes.workload.pod']] as const) {
    await mixedStore.insertComponent(set(setId), type, { x: 140 + column++ * 220, y: 520 }); await mixedStore.whenIdle();
  }
  const mixedDoc = JSON.parse(JSON.stringify(mixedStore.state.document));
  const byType = (type: string) => mixedDoc.elements.find((element: { componentType?: string }) => element.componentType === type);
  byType('generic.service').text = '';
  byType('generic.isometric.instance').text = '';
  Object.assign(byType('generic.resource-card'), { text: 'Azure OpenAI', description: 'LLM', metadata: { ...(byType('generic.resource-card').metadata ?? {}), 'resource-card:link-order': 'docs,portal', 'resource-card:link:docs:label': 'Docs', 'resource-card:link:docs:url': 'https://example.com/docs', 'resource-card:link:portal:label': 'Portal', 'resource-card:link:portal:url': 'https://example.com/portal' } });
  mixedDoc.elements.push(JSON.parse(JSON.stringify(createElement('connector', { id: 'el:link', x: 200, y: 85, width: 120, height: 0, pageId: page, from: { elementId: 'el:rect', anchor: { x: 1, y: .5 } }, to: { elementId: 'el:ellipse', anchor: { x: 0, y: .5 } }, text: 'ruft auf' }))));
  writeFileSync('./out/mixed-v0.1.8.json', JSON.stringify(mixedDoc));
  writeFileSync('./out/mixed-v0.1.8.svg', prepareSvgExport(mixedDoc).contents);
  writeFileSync('./out/mixed-v0.1.8.drawio', prepareDrawioExport(mixedDoc).contents);
  writeFileSync('./out/mixed-v0.1.8.mmd', prepareMermaidExport(mixedDoc).contents);
  mixedStore.dispose();
  expect(true).toBe(true);
});
```
