import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createController, validateDocument, type SketchDocument } from '@/domain';
import { InteropError } from '@/interop';
import { diagramCodeAnchor, diagramCodeDiagnostics, diagramCodeView } from '@/renderer/lib/diagram-code';
import { defaultMermaidExportTarget, mermaidExportTargets, prepareMermaidCodeExport } from '@/renderer/lib/mermaid-export';
import { importMermaidCode, mermaidImportKind } from '@/renderer/lib/mermaid-import';
import { MERMAID_CODE_KEY, mermaidCanvasSize, mermaidCodeOf, mermaidDiagramName, mermaidImage, mermaidImageDocument, MermaidRenderError, type RenderedMermaid } from '@/renderer/lib/mermaid-render';
import { createWhiteboardStore } from '@/renderer/state/whiteboard';
import type { WhiteboardStore } from '@/renderer/state/contract';

// #279: Mermaid diagrams the app has no shapes for are drawn by Mermaid and kept as an image that carries its code.
// Drawing itself needs a browser and is tested in tests/ui/mermaid-image.spec.ts; here Mermaid is replaced.
const draw = vi.hoisted(() => ({ next: null as (() => Promise<unknown>) | null, calls: [] as string[] }));
vi.mock('@/renderer/lib/mermaid-render', async (original) => {
  const actual = await original<typeof import('@/renderer/lib/mermaid-render')>();
  return { ...actual, renderMermaidImage: async (code: string) => { draw.calls.push(code); return draw.next ? draw.next() : { dataUrl: PNG, width: 400, height: 200 }; } };
});
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
const PNG_2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC';
const rendered: RenderedMermaid = { dataUrl: PNG, width: 400, height: 200 };
const CLASS = 'classDiagram\n    Animal <|-- Duck\n    Animal : +int age\n';
const stores: WhiteboardStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.dispose(); draw.next = null; draw.calls.length = 0; });

/** A document with one image Mermaid drew, and a rectangle beside it. */
function drawn(code = CLASS): SketchDocument {
  const base = mermaidImageDocument(code, rendered);
  return validateDocument(base);
}

describe('an image Mermaid drew (#279)', () => {
  it('is named by the kind of diagram its code declares', () => {
    expect(mermaidDiagramName(CLASS)).toBe('classDiagram');
    expect(mermaidDiagramName('%% Kommentar\n\n  stateDiagram-v2\n  [*] --> A')).toBe('stateDiagram-v2');
    expect(mermaidDiagramName('---\ntitle: Plan\nconfig:\n  theme: dark\n---\ngantt\n  title A')).toBe('gantt');
    expect(mermaidDiagramName('%%{init: {"theme": "dark"}}%%\npie\n "A": 1')).toBe('pie');
    expect(mermaidDiagramName('')).toBe('Mermaid');
  });

  it('carries its code, has the size of the drawing and is scaled down when the drawing is very large', () => {
    const { asset, element } = mermaidImage(CLASS, rendered, { asset: 'asset:1', element: 'img', pageId: 'page:1' }, { x: 10, y: 20 });
    expect(asset).toEqual({ id: 'asset:1', name: 'classDiagram.png', mimeType: 'image/png', dataUrl: PNG });
    expect(element).toMatchObject({ kind: 'image', id: 'img', pageId: 'page:1', x: 10, y: 20, width: 400, height: 200, assetId: 'asset:1', label: 'classDiagram', metadata: { [MERMAID_CODE_KEY]: CLASS } });
    expect(mermaidCodeOf(element)).toBe(CLASS);
    expect(mermaidCodeOf({ ...element, kind: 'rectangle' })).toBeNull();
    expect(mermaidCodeOf({ ...element, metadata: { [MERMAID_CODE_KEY]: '  ' } })).toBeNull();
    expect(mermaidCanvasSize({ width: 2400, height: 600 })).toEqual({ width: 1200, height: 300 });
    expect(mermaidCanvasSize({ width: 300, height: 100 })).toEqual({ width: 300, height: 100 });
  });

  it('is a valid document of its own for the import: one image with its asset', () => {
    const document = drawn();
    expect(document.title).toBe('classDiagram');
    expect(document.elements).toHaveLength(1);
    expect(Object.values(document.assets)).toHaveLength(1);
    expect(document.elements[0]).toMatchObject({ kind: 'image', pageId: document.pages[0]!.id, assetId: Object.keys(document.assets)[0] });
  });
});

describe('the code panel for an image Mermaid drew (#279)', () => {
  it('shows the code of the image when it alone is selected', () => {
    const document = drawn();
    const id = document.elements[0]!.id;
    expect(diagramCodeAnchor(document.elements, [id])).toEqual({ kind: 'mermaid', anchorId: id });
    expect(diagramCodeView(document.elements, id)).toEqual({ kind: 'mermaid', anchorId: id, names: 'classDiagram', code: CLASS });
    expect(diagramCodeAnchor(document.elements, [id, 'anderes'])).toBeNull();
    expect(diagramCodeDiagnostics('mermaid', CLASS)).toEqual([]);
    expect(diagramCodeDiagnostics('mermaid', '  \n')).toEqual([{ line: 1, severity: 'error', message: 'Der Code ist leer.' }]);
  });

  it('draws changed code again: new image, same place and width, the height of the new drawing; undo brings the old one back', async () => {
    const document = drawn();
    const store = createWhiteboardStore({ controller: createController(document), preferences: null }); stores.push(store);
    const id = document.elements[0]!.id; const before = store.state.document.elements[0]!;
    draw.next = async () => ({ dataUrl: PNG_2, width: 400, height: 300 });
    const next = `${CLASS}    Animal <|-- Fish\n`;
    expect(await store.applyDiagramCode(next, id)).toBe(id);
    expect(draw.calls).toEqual([next]);
    const after = store.state.document.elements[0]!;
    expect(after).toMatchObject({ id, x: before.x, y: before.y, width: before.width, height: 300, metadata: { [MERMAID_CODE_KEY]: next } });
    expect(after.assetId).not.toBe(before.assetId);
    expect(store.state.document.assets[after.assetId!]!.dataUrl).toBe(PNG_2);
    expect(store.state.diagramCodeProblem).toBeNull();
    store.undo();
    await vi.waitFor(() => expect(store.state.document.elements[0]).toMatchObject({ assetId: before.assetId, height: before.height, metadata: { [MERMAID_CODE_KEY]: CLASS } }));
  });

  it('leaves the image as it is when Mermaid cannot read the code, and says what Mermaid said', async () => {
    const document = drawn();
    const store = createWhiteboardStore({ controller: createController(document), preferences: null }); stores.push(store);
    const id = document.elements[0]!.id; const before = JSON.stringify(store.state.document.elements[0]);
    draw.next = async () => { throw new MermaidRenderError('Parse error on line 2:\n...Animal <|-- \nExpecting ALPHA'); };
    expect(await store.applyDiagramCode('classDiagram\n    Animal <|-- \n', id)).toBeNull();
    expect(JSON.stringify(store.state.document.elements[0])).toBe(before);
    expect(store.state.diagramCodeProblem).toContain('Parse error on line 2');
    draw.next = async () => { throw new MermaidRenderError('too large', 'size'); };
    expect(await store.applyDiagramCode(CLASS.repeat(2), id)).toBeNull();
    expect(store.state.diagramCodeProblem).toBe('Das Diagramm ist zu groß, um es als Bild zu übernehmen.');
    // Empty code never reaches Mermaid.
    draw.calls.length = 0;
    expect(await store.applyDiagramCode('   ', id)).toBeNull();
    expect(draw.calls).toEqual([]);
  });
});

describe('Mermaid export of an image Mermaid drew (#279)', () => {
  it('offers the image as a diagram of its own and writes the code it carries', () => {
    const document = drawn();
    const pageId = document.pages[0]!.id; const id = document.elements[0]!.id;
    expect(mermaidExportTargets(document, pageId)).toEqual([{ id: `image:${id}`, kind: 'image', names: 'classDiagram' }]);
    expect(defaultMermaidExportTarget(document, pageId, [id])).toBe(`image:${id}`);
    const plain = prepareMermaidCodeExport(document, { pageId, target: `image:${id}`, embedDocument: false });
    expect(plain.contents).toBe(CLASS);
    expect(plain.requiresConfirmation).toBe(false);
  });

  it('an own export comes back as the whole document; a changed one is a diagram for Mermaid to draw', () => {
    const document = drawn();
    const pageId = document.pages[0]!.id; const id = document.elements[0]!.id;
    const exported = prepareMermaidCodeExport(document, { pageId, target: `image:${id}` }).contents;
    expect(exported.startsWith(CLASS)).toBe(true);
    expect(exported).toMatch(/\n%% sketchdraw-mermaid-v1 0 \S+\n$/);
    const back = importMermaidCode(exported);
    expect(back.fidelity).toBe('own-roundtrip');
    expect(back.document.elements[0]).toMatchObject({ id, kind: 'image', metadata: { [MERMAID_CODE_KEY]: CLASS } });
    // Changed outside: the app has no shapes for a class diagram, so the import panel hands it to Mermaid.
    let refused: unknown;
    try { importMermaidCode(exported.replace('Duck', 'Goose')); } catch (error) { refused = error; }
    expect(refused).toBeInstanceOf(InteropError);
    expect((refused as InteropError).code).toBe('MERMAID_DIAGRAM_UNSUPPORTED');
  });

  it('a page with shapes and an image offers both', () => {
    const base = drawn();
    const pageId = base.pages[0]!.id;
    const document = validateDocument({ ...base, elements: [...base.elements, { ...base.elements[0]!, id: 'box', kind: 'rectangle', assetId: undefined, metadata: undefined, text: 'Form' }].map((element) => JSON.parse(JSON.stringify(element))) });
    expect(mermaidExportTargets(document, pageId).map((target) => target.kind)).toEqual(['image', 'flowchart']);
  });
});

describe('the examples of mermaid.js.org (#279)', () => {
  const dir = 'tests/fixtures/mermaid-examples/all';
  const examples = readdirSync(dir).filter((name) => name.endsWith('.mmd')).sort().map((name) => ({ name, code: readFileSync(`${dir}/${name}`, 'utf8') }));

  it('are all here: 81 examples of 34 kinds', () => {
    expect(examples).toHaveLength(81);
    expect(new Set(examples.map((example) => example.name.replace(/-\d\d-.*$/, ''))).size).toBe(34);
  });

  it('flowcharts and sequence diagrams become shapes; every other kind goes to Mermaid', () => {
    const shapes: string[] = [], toMermaid: string[] = [], other: string[] = [];
    for (const { name, code } of examples) {
      try { const result = importMermaidCode(code); (result.document.elements.some((element) => element.kind !== 'image') ? shapes : other).push(name); }
      catch (error) { (error instanceof InteropError && error.code === 'MERMAID_DIAGRAM_UNSUPPORTED' ? toMermaid : other).push(`${name}${error instanceof InteropError ? ` (${error.code})` : ''}`); }
    }
    expect(other).toEqual([]);
    expect(shapes).toEqual(examples.filter((example) => /^(flowchart|sequence)-/.test(example.name)).map((example) => example.name));
    expect(shapes).toHaveLength(7);
    expect(toMermaid).toHaveLength(74);
    expect(examples.filter((example) => mermaidImportKind(example.code) === 'other')).toHaveLength(74);
  });
});
