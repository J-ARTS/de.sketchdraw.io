import { describe, expect, it } from 'vitest';
import { formatDiagram, parseDiagram } from '../../src/codec/index';
import {
  builtInComponentSets,
  instantiateComponent,
  parseComponentSet,
  prepareComponentSetImport,
  validateComponentSet,
} from '../../src/catalog/index';
import {
  createController,
  DomainConflictError,
  DomainValidationError,
  serializeDocument,
  validateDocument,
} from '../../src/domain/index';
import type {
  ComponentSet,
  ElementKind,
  ParseResult,
  SketchAsset,
  SketchDocument,
  SketchElement,
} from '../../src/domain/types';

// Independent S2 acceptance: docs/contracts-s2.md, issues #11 / #15.
// Fixtures describe the public format and domain, not private codec internals.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
const SAFE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M2 2H22V22H2Z M4 12C4 8 8 8 12 12Q16 16 20 12"/></svg>';

function shape(id: string, kind: ElementKind = 'rectangle', extra: Partial<SketchElement> = {}): SketchElement {
  return {
    id, kind, x: 10, y: 20, width: 80, height: 40, rotation: 0,
    style: {
      stroke: '#123456', fill: '#abcdef', strokeWidth: 2, opacity: 0.75,
      fontSize: 17, textAlign: 'center', strokeDash: 'dashed',
    },
    ...extra,
  };
}

function asset(id = 'asset:used'): SketchAsset {
  return { id, mimeType: 'image/png', dataUrl: `data:image/png;base64,${PNG}`, name: 'Bild 🧭.png' };
}

function componentSet(id = 'acme.core'): ComponentSet {
  return {
    id, name: 'Acme Queue', version: '1.0.0',
    components: [{
      type: 'custom.acme.queue', name: 'Warteschlange', provider: 'custom', category: 'Messaging',
      aliases: ['Queue', 'Jobs'], defaultWidth: 160, defaultHeight: 80,
      style: { fill: '#e0f2fe', fontFamily: 'mono' }, metadata: { owner: 'Platform' },
      documentationUrl: 'https://example.com/docs/queue', iconSvg: SAFE_ICON,
      widgets: [
        { key: 'capacity', label: 'Kapazität', kind: 'number' },
        { key: 'region', label: 'Region', kind: 'select', options: ['eu', 'us'] },
        { key: 'note', label: 'Notiz', kind: 'text' },
      ],
    }],
  };
}

function document(elements: SketchElement[] = []): SketchDocument {
  return {
    schemaVersion: 1, id: 'doc:acceptance', title: 'Architektur 🧭',
    elements, assets: {}, componentSets: [], metadata: { owner: 'Team' },
  };
}

function fullDocument(): SketchDocument {
  const doc = document([
    shape('container', 'container', { x: -50, y: -40, width: 700, height: 500, label: 'System', description: 'Alle Komponenten' }),
    shape('rectangle', 'rectangle', { x: 1.2345678901234567, y: -0, rotation: 17.25, parentId: 'container', label: 'Client 🧭' }),
    shape('ellipse', 'ellipse', { x: 200, parentId: 'container' }),
    shape('diamond', 'diamond', { x: 300, description: 'Entscheidung' }),
    shape('text', 'text', { x: 10, y: 100, text: 'Zeile 1\n"Zitat" \\ 中文 🧭 e\u0301 \ud800', metadata: { note: 'Text\t\n' } }),
    shape('path', 'path', { points: [{ x: 0, y: 0 }, { x: 20.333333333333332, y: 40 }, { x: 80, y: 10 }], style: { ...shape('base').style, fontFamily: 'mono' } }),
    shape('image', 'image', { x: 100, y: 200, assetId: 'asset:used', label: 'Logo' }),
    shape('connector', 'connector', {
      x: 90, y: 40, width: 110, height: 0,
      points: [{ x: 0, y: 0 }, { x: 110, y: 0 }],
      from: { elementId: 'rectangle', anchor: { x: 1, y: 0.5 } },
      to: { elementId: 'ellipse', anchor: { x: 0, y: 0.5 } }, text: 'HTTPS',
    }),
    shape('component', 'component', {
      x: 300, y: 200, componentType: 'custom.acme.queue', text: 'Jobs',
      metadata: { 'widget:custom.acme.queue:capacity': '100', arbitrary: '🧭' },
      documentationUrl: 'https://example.com/component',
    }),
    shape('sticky-note', 'sticky-note', {
      x: 430, y: 200, width: 240, height: 240, text: 'Plan\nReview', author: 'Jeremy Teichmann',
      style: { ...shape('base').style, fill: '#aeeebd', fontWeight: 'bold', textDecoration: 'line-through', listStyle: 'bullet' },
      documentationUrl: 'https://example.com/note',
    }),
  ]);
  doc.assets = { 'asset:unused': asset('asset:unused'), 'asset:used': asset() };
  doc.componentSets = [componentSet(), { id: 'empty.set', name: 'Unused', version: 'old', components: [] }];
  doc.metadata = { z: 'last', a: 'first', unicode: '\udfff 😀', multiline: 'one\ntwo' };
  return validateDocument(doc);
}

function parsedDocument(result: ParseResult): SketchDocument {
  if (!result.ok) throw new Error(`Expected valid Script: ${JSON.stringify(result.diagnostics)}`);
  return result.document;
}

function expectParseError(source: string, code?: string, context?: SketchDocument): Extract<ParseResult, { ok: false }> {
  const result = parseDiagram(source, context);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Unexpected parse success');
  expect(result).not.toHaveProperty('document');
  expect(result.diagnostics.some((entry) => entry.severity === 'error')).toBe(true);
  if (code) expect(result.diagnostics.map((entry) => entry.code)).toContain(code);
  return result;
}

function expectValidationError(action: () => unknown, code?: string): void {
  let caught: unknown;
  try { action(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(DomainValidationError);
  if (code && caught instanceof DomainValidationError) {
    expect(caught.issues.map((issue) => issue.code)).toContain(code);
  }
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function assertDeepFrozen(value: unknown): void {
  if (value !== null && typeof value === 'object') {
    expect(Object.isFrozen(value)).toBe(true);
    for (const child of Object.values(value)) assertDeepFrozen(child);
  }
}

function referenceScript(context: SketchDocument): string {
  return formatDiagram(context).split('\n').map((line) => {
    if (line.startsWith('asset ')) {
      const id = line.slice(6, line.indexOf(' {'));
      return `asset-ref ${id}`;
    }
    if (line.startsWith('set ')) {
      const id = JSON.parse(line.slice(4, line.indexOf(' {'))) as string;
      const set = context.componentSets.find((candidate) => candidate.id === id)!;
      return `set-ref ${JSON.stringify(id)} ${JSON.stringify({ version: set.version })}`;
    }
    return line;
  }).join('\n');
}

describe('Sketchdraw Script acceptance', () => {
  it('round-trips all ten kinds and full persistent resources without normalizing away valid data', () => {
    const original = freezeDeep(fullDocument());
    const expected = serializeDocument(original);
    const source = formatDiagram(original);
    const decoded = parsedDocument(parseDiagram(source));

    expect(new Set(decoded.elements.map((element) => element.kind)).size).toBe(10);
    expect(serializeDocument(decoded)).toBe(expected);
    expect(formatDiagram(decoded)).toBe(source);
    expect(source.startsWith('sketchdraw 1\ndocument ')).toBe(true);
    expect(source.endsWith('\n')).toBe(true);
    expect(source.endsWith('\n\n')).toBe(false);
    expect(source).not.toContain('\r');
    expect(source.indexOf('asset "asset:unused"')).toBeLessThan(source.indexOf('asset "asset:used"'));
    expect(source.indexOf('"a":"first"')).toBeLessThan(source.indexOf('"z":"last"'));
    expect(decoded.elements[1]!.style).not.toHaveProperty('fontFamily');
    decoded.assets['asset:used']!.name = 'Changed result';
    decoded.componentSets[0]!.components[0]!.widgets![0]!.label = 'Changed result';
    expect(serializeDocument(original)).toBe(expected);
  });

  it('preserves valid legacy definitions and icons while applying no new catalog policy in the codec', () => {
    const legacy = document([shape('legacy', 'component', {
      componentType: 'legacyQueue', metadata: { 'widget:unrelated:capacity': 'not a number' },
    })]);
    const set = componentSet();
    set.components[0]!.type = 'legacyQueue';
    set.components[0]!.iconSvg = '<svg viewBox="0 0 24 24"><text x="0" y="12">Legacy</text></svg>';
    legacy.componentSets = [set];
    const valid = validateDocument(legacy);
    expect(serializeDocument(parsedDocument(parseDiagram(formatDiagram(valid))))).toBe(serializeDocument(valid));
    expectValidationError(() => validateComponentSet(set));
  });

  it('reads BOM, CRLF, comments, fixed defaults and resources declared after their use', () => {
    const image = asset();
    const { id: assetId, ...assetBody } = image;
    const source = [
      '\ufeff# Kommentar', 'sketchdraw 1', '',
      'document {"id":"doc:manual","title":"Manuell 🧭"}',
      'image "picture" {"x":10,"y":20,"width":80,"height":40,"assetId":"asset:used"}',
      `asset ${JSON.stringify(assetId)} ${JSON.stringify(assetBody)}`,
    ].join('\r\n');
    const decoded = parsedDocument(parseDiagram(source));
    expect(decoded.elements[0]!.rotation).toBe(0);
    expect(decoded.elements[0]!.style).toEqual({
      stroke: '#1f2937', fill: 'transparent', strokeWidth: 2, opacity: 1,
      fontSize: 16, textAlign: 'left', strokeDash: 'solid',
    });
    expect(decoded.assets['asset:used']).toEqual(image);
    expect(formatDiagram(decoded)).not.toContain('\r');
    expect(formatDiagram(decoded)).not.toContain('\ufeff');
  });

  it('copies explicit context references without mutating or aliasing the source snapshot', () => {
    const context = freezeDeep(fullDocument());
    const before = serializeDocument(context);
    const source = referenceScript(context);
    const decoded = parsedDocument(parseDiagram(source, context));
    expect(serializeDocument(decoded)).toBe(before);
    decoded.assets['asset:used']!.name = 'Detached asset';
    decoded.componentSets[0]!.components[0]!.name = 'Detached component';
    expect(serializeDocument(context)).toBe(before);
    expectParseError(source, 'CONTEXT_REQUIRED');
    expectParseError(source.replace('"version":"1.0.0"', '"version":"2.0.0"'), 'RESOURCE_VERSION_CONFLICT', context);
    expectParseError(source.replace('"id":"doc:acceptance"', '"id":"different"'), 'CONTEXT_ID_MISMATCH', context);
  });

  it('requires explicit drops even for unused resources and rejects deleting resources still referenced', () => {
    const context = freezeDeep(fullDocument());
    const source = referenceScript(context);
    expectParseError(source.replace('asset-ref "asset:unused"\n', ''), 'RESOURCE_OMITTED', context);
    const unusedDropped = parsedDocument(parseDiagram(source.replace('asset-ref "asset:unused"', 'drop asset "asset:unused"'), context));
    expect(unusedDropped.assets).not.toHaveProperty('asset:unused');
    expect(unusedDropped.assets['asset:used']).toEqual(context.assets['asset:used']);
    expectParseError(source.replace('asset-ref "asset:used"', 'drop asset "asset:used"'), undefined, context);
    expectParseError(source.replace('set-ref "acme.core" {"version":"1.0.0"}', 'drop set "acme.core"'), undefined, context);

    const cleared = parsedDocument(parseDiagram([
      'sketchdraw 1', 'document {"title":"Cleared explicitly"}',
      'drop asset "asset:used"', 'drop asset "asset:unused"',
      'drop set "acme.core"', 'drop set "empty.set"',
    ].join('\n'), context));
    expect(cleared.id).toBe(context.id);
    expect(cleared.assets).toEqual({});
    expect(cleared.componentSets).toEqual([]);
    expect(cleared.elements).toEqual([]);
    expect(formatDiagram(cleared)).not.toContain('drop ');
    expect(serializeDocument(parsedDocument(parseDiagram(formatDiagram(cleared))))).toBe(serializeDocument(cleared));
  });

  it('rejects duplicate decoded JSON keys and locates them using UTF-16 editor columns', () => {
    const line = 'document {"id":"doc:dup","title":"🧭","ti\\u0074le":"duplicate"}';
    const failure = expectParseError(`sketchdraw 1\n${line}`, 'DUPLICATE_JSON_KEY');
    const diagnostic = failure.diagnostics.find((entry) => entry.code === 'DUPLICATE_JSON_KEY')!;
    expect(diagnostic.line).toBe(2);
    expect(diagnostic.column).toBe(line.indexOf('"ti\\u0074le"') + 1);

    expectParseError('sketchdraw 1\ndocument {"id":"d","title":"x","metadata":{"a":"first","a":"second"}}', 'DUPLICATE_JSON_KEY');
    expectParseError('sketchdraw 1\ndocument {"id":"d","title":"x","metadata":{"__proto__":"pollution"}}');
    expect(({} as Record<string, unknown>).pollution).toBeUndefined();
  });

  it('returns actionable semantic errors without a partial document or a changed context', () => {
    const context = freezeDeep(document());
    const before = serializeDocument(context);
    const line = 'rectangle "bad" {"text":"🧭","x":0,"y":0,"width":-1,"height":20}';
    const failure = expectParseError(`sketchdraw 1\ndocument {"title":"Draft"}\n${line}`, undefined, context);
    const diagnostic = failure.diagnostics.find((entry) => entry.issuePath?.endsWith('.width'));
    expect(diagnostic).toBeDefined();
    expect(diagnostic).toMatchObject({ line: 3, elementId: 'bad', severity: 'error' });
    expect(diagnostic!.column).toBeGreaterThan(1);
    expect(serializeDocument(context)).toBe(before);
    expectParseError('sketchdraw 1\ndocument {"id":"d","title":"x"}\nrectangle "a" {"x":0,"y":0,"width":20,"height":20}\nrectangle "a" {"x":0,"y":0,"width":20,"height":20}', 'DUPLICATE_DECLARATION');
  });

  it('does not let a valid old code draft overwrite a newer controller revision', () => {
    const base = document([shape('shape')]);
    const controller = createController(base);
    const draft = controller.getSnapshot();
    const source = formatDiagram(draft.document).replace('"title":"Architektur 🧭"', '"title":"Draft title"');
    controller.dispatch({ type: 'rename', title: 'Remote title' }, { actorId: 'remote', expectedRevision: 0, source: 'agent' });
    const parsed = parsedDocument(parseDiagram(source, draft.document));
    expect(() => controller.dispatch({ type: 'replace', document: parsed }, {
      actorId: 'local', expectedRevision: draft.revision, source: 'code',
    })).toThrow(DomainConflictError);
    expect(controller.getSnapshot().document.title).toBe('Remote title');
    expect(parsed.title).toBe('Draft title');
  });
});

describe('Component catalog acceptance', () => {
  it('inserts a new set plus component as one real controller transaction and undo unit', () => {
    const base = freezeDeep(document([shape('parent', 'container', { x: 100, y: 200, width: 500, height: 300 })]));
    const set = freezeDeep(componentSet());
    const before = serializeDocument(base);
    const controller = createController(base);
    const insertion = instantiateComponent(base, {
      set, type: 'custom.acme.queue', id: 'queue:first', at: { x: 140, y: 230 }, parentId: 'parent',
      label: 'Job buffer', metadata: { owner: 'Jobs', 'widget:custom.acme.queue:capacity': '42' },
    });
    expect(serializeDocument(base)).toBe(before);
    const first = controller.dispatch(insertion.command, { actorId: 'local', expectedRevision: 0, source: 'human' });
    expect(first.revision).toBe(1);
    expect(first.document.componentSets).toEqual([set]);
    expect(first.document.elements[1]).toEqual(insertion.element);
    expect(first.document.elements[1]).toMatchObject({
      id: 'queue:first', kind: 'component', componentType: 'custom.acme.queue', parentId: 'parent',
      x: 140, y: 230, width: 160, height: 80, rotation: 0, label: 'Job buffer', text: 'Warteschlange',
      style: { fill: '#e0f2fe', fontFamily: 'mono' }, metadata: { owner: 'Jobs', 'widget:custom.acme.queue:capacity': '42' },
    });
    expect(serializeDocument(controller.undo('local').document)).toBe(before);
    const restored = controller.redo('local');
    const second = instantiateComponent(restored.document, {
      set, type: 'custom.acme.queue', id: 'queue:second', at: { x: 320, y: 230 },
    });
    const two = controller.dispatch(second.command, { actorId: 'local', expectedRevision: restored.revision, source: 'human' });
    expect(two.document.componentSets).toHaveLength(1);
    expect(two.document.elements).toHaveLength(3);
    const undoneSecond = controller.undo('local').document;
    expect(undoneSecond.componentSets).toEqual([set]);
    expect(undoneSecond.elements.map((element) => element.id)).toEqual(['parent', 'queue:first']);
  });

  it('preserves existing catalog content and rejects conflicting imports without partial changes', () => {
    const base = document();
    const set = componentSet();
    base.componentSets = [set];
    freezeDeep(base);
    const before = serializeDocument(base);
    expect(prepareComponentSetImport(base, structuredClone(set))).toBeNull();
    const contentConflict = structuredClone(set);
    contentConflict.components[0]!.name = 'Changed with same version';
    expectValidationError(() => prepareComponentSetImport(base, contentConflict), 'SET_CONTENT_CONFLICT');
    const versionConflict = structuredClone(set);
    versionConflict.version = '2.0.0';
    expectValidationError(() => prepareComponentSetImport(base, versionConflict), 'SET_VERSION_CONFLICT');
    const collision = structuredClone(set);
    collision.id = 'another.set';
    expectValidationError(() => prepareComponentSetImport(base, collision), 'COMPONENT_TYPE_COLLISION');
    expect(serializeDocument(base)).toBe(before);
  });

  it('validates new instance identities, parent references and declared widget values', () => {
    const base = freezeDeep(document([shape('existing')]));
    const request = { set: componentSet(), type: 'custom.acme.queue', id: 'new', at: { x: 0, y: 0 } };
    expectValidationError(() => instantiateComponent(base, { ...request, id: 'existing' }));
    expectValidationError(() => instantiateComponent(base, { ...request, type: 'custom.acme.missing' }));
    expectValidationError(() => instantiateComponent(base, { ...request, parentId: 'missing' }));
    expectValidationError(() => instantiateComponent(base, { ...request, parentId: 'existing' }));
    const invalidMetadata: Array<Record<string, string>> = [
      { 'widget:custom.acme.queue:capacity': 'NaN' },
      { 'widget:custom.acme.queue:capacity': '-0' },
      { 'widget:custom.acme.queue:capacity': '01' },
      { 'widget:custom.acme.queue:region': 'not-an-option' },
      { 'widget:custom.other.queue:capacity': '10' },
    ];
    for (const metadata of invalidMetadata) {
      expectValidationError(() => instantiateComponent(base, { ...request, metadata }));
    }
    const valid = instantiateComponent(base, { ...request, metadata: {
      'widget:custom.acme.queue:capacity': '1.5', 'widget:custom.acme.queue:region': 'eu',
      'widget:custom.acme.queue:note': 'Text 🧭', free: 'unchanged',
    } });
    expect(valid.element.metadata).toMatchObject({ free: 'unchanged', 'widget:custom.acme.queue:capacity': '1.5' });
  });

  it('provides deeply frozen built-ins and detached validated imports', () => {
    assertDeepFrozen(builtInComponentSets);
    expect(new Set(builtInComponentSets.flatMap((set) => set.components.map((entry) => entry.provider))))
      .toEqual(new Set(['generic', 'aws', 'azure', 'gcp', 'kubernetes']));
    const set = builtInComponentSets[0]!;
    const before = JSON.stringify(set);
    const copy = validateComponentSet(set);
    expect(copy).toEqual(set);
    expect(copy).not.toBe(set);
    copy.components[0]!.name = 'Detached edit';
    expect(JSON.stringify(set)).toBe(before);
  });

  it('accepts the declared safe SVG profile without rewriting its stored source', () => {
    const set = componentSet();
    set.components[0]!.iconSvg = '<svg viewBox="0 0 2.4e1 24" fill="&#35;abc"><g stroke="currentColor"><path d="m1 1 l2 2 h3 v4 c1 2 3 4 5 6 q1 2 3 4 z"/><rect x="1" y="1" width="2" height="3"/></g></svg>';
    expect(parseComponentSet(JSON.stringify(set)).components[0]!.iconSvg).toBe(set.components[0]!.iconSvg);
  });

  it('rejects active, externally referential and unsupported SVG at the new catalog boundary', () => {
    const invalidIcons = [
      '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///unread">]><svg viewBox="0 0 24 24">&x;</svg>',
      '<?xml-stylesheet href="https://example.com/style"?><svg viewBox="0 0 24 24"/>',
      '<svg viewBox="0 0 24 24"><script>throw 1</script></svg>',
      '<svg viewBox="0 0 24 24"><foreignObject/></svg>',
      '<svg viewBox="0 0 24 24" onload="throw 1"/>',
      '<svg viewBox="0 0 24 24"><image href="https://example.com/image.png"/></svg>',
      '<svg viewBox="0 0 24 24"><path d="M0 0L2 2" fill="url(&#35;paint)"/></svg>',
      '<svg viewBox="0 0 24 24"><g transform="translate(calc(2))"/></svg>',
      '<svg viewBox="0 0 24 24"><path d="M0 0 A1 1 0 3 1 2 2"/></svg>',
      '<svg viewBox="0 0 0 24"/>',
      '<svg viewBox="0 0 24 24"><svg viewBox="0 0 1 1"/></svg>',
    ];
    for (const iconSvg of invalidIcons) {
      const set = componentSet();
      set.components[0]!.iconSvg = iconSvg;
      expectValidationError(() => validateComponentSet(set));
      expect(set.components[0]!.iconSvg).toBe(iconSvg);
    }
  });

  it('rejects duplicate catalog JSON keys and invalid widget declarations before installation', () => {
    const serialized = JSON.stringify(componentSet());
    expectValidationError(() => parseComponentSet(serialized.replace('"version":"1.0.0"', '"version":"1.0.0","version":"2.0.0"')));
    for (const widget of [
      { key: 'region', label: 'Region', kind: 'select' as const, options: ['eu', 'eu'] },
      { key: 'region', label: 'Region', kind: 'select' as const, options: [] },
      { key: 'note', label: 'Note', kind: 'text' as const, options: ['unexpected'] },
    ]) {
      const set = componentSet();
      set.components[0]!.widgets = [widget];
      expectValidationError(() => validateComponentSet(set));
    }
  });
});
