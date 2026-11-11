import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createDocument, createElement, DOMAIN_LIMITS, validateDocument } from '../../../src/domain';
import { exportMermaid, importMermaid, prepareMermaidExport } from '../../../src/interop/mermaid';
import { InteropError } from '../../../src/interop/types';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
function errorCode(source: string, code: string): void {
  try { importMermaid(source); throw new Error('Unexpected successful import'); }
  catch (error) { expect(error).toBeInstanceOf(InteropError); expect((error as InteropError).code).toBe(code); }
}

describe('bounded Mermaid flowchart interoperability', () => {
  it.each(['LR', 'RL', 'TB', 'TD', 'BT'])('imports %s shapes, bindings, labels, chains and cycles', direction => {
    const result = importMermaid(`graph ${direction}\nA[Start] -->|"Go ❤"| B(Rounded) --> C((Circle))\nC -- back --> A\nD{Decision} -.-> E[(Database)]\nF[[Process]] ==> G{{Hexagon}}\nA --- D`);
    expect(result.fidelity).toBe('supported-subset');
    expect(result.document.elements.filter(el => el.kind === 'connector')).toHaveLength(6);
    expect(result.document.elements.find(el => el.id === 'E')?.shapeVariant).toBe('cylinder');
    expect(result.document.elements.find(el => el.id === 'G')?.shapeVariant).toBe('hexagon');
    expect(result.document.elements.find(el => el.text === 'Go ❤')?.to?.elementId).toBe('B');
    const a = result.document.elements.find(el => el.id === 'A')!, b = result.document.elements.find(el => el.id === 'B')!;
    if (direction === 'LR') expect(a.x).toBeLessThan(b.x);
    if (direction === 'RL') expect(a.x).toBeGreaterThan(b.x);
    if (direction === 'BT') expect(a.y).toBeGreaterThan(b.y);
    expect(() => validateDocument(result.document)).not.toThrow();
  });

  it('supports code fences, comments, same-line headers and semicolon statements', () => {
    const result = importMermaid('```mermaid\n%% A comment\nflowchart LR A[Browser]; A --> B[Server] %% comment\n```');
    expect(result.document.elements).toHaveLength(3);
    expect(result.document.elements.find(el => el.id === 'B')?.text).toBe('Server');
  });

  it('decodes Unicode and entities without confusing quoted delimiters', () => {
    const source = 'flowchart LR\nä["Brackets ] ; #quot;Hello#quot; &amp; &#x1f600; #10;Next"] -->|"a | b #quot;"| B';
    const doc = importMermaid(source).document;
    expect(doc.elements[0]?.text).toBe('Brackets ] ; "Hello" & 😀 \nNext');
    expect(doc.elements.find(el => el.kind === 'connector')?.text).toBe('a | b "');
  });

  it('uses the final node definition and keeps nested subgraph memberships', () => {
    const doc = importMermaid('flowchart TB\nsubgraph outer["Outer"]\nA[old]\nsubgraph inner["Inner"]\nB((Child))\nend\nA --> B\nend\nA[New]\nB --> C').document;
    expect(doc.elements.find(el => el.id === 'A')).toMatchObject({ text: 'New', parentId: 'outer' });
    expect(doc.elements.find(el => el.id === 'B')?.parentId).toBe('inner');
    expect(doc.elements.find(el => el.id === 'inner')?.parentId).toBe('outer');
    expect(doc.elements.find(el => el.id === 'C')?.parentId).toBeUndefined();
    expect(() => validateDocument(doc)).not.toThrow();
  });

  it('retains a subgraph title without explicit brackets', () => {
    expect(importMermaid('flowchart LR\nsubgraph One two three\nA\nend').document.elements[0]?.text).toBe('One two three');
  });

  it('gives multiword subgraphs independent generated IDs without stealing a real node', () => {
    const doc = importMermaid('flowchart LR\nsubgraph Data Layer\nA\nend\nsubgraph Data Store\nB\nend\nData --> A').document;
    const groups = doc.elements.filter(el => el.kind === 'container');
    expect(groups.map(el => el.text)).toEqual(['Data Layer', 'Data Store']);
    expect(groups[0]?.id).not.toBe(groups[1]?.id);
    expect(doc.elements.find(el => el.id === 'Data')).toMatchObject({ kind: 'rectangle', text: 'Data' });
    expect(doc.elements.find(el => el.id === 'A')?.parentId).toBe(groups[0]?.id);
    expect(doc.elements.find(el => el.id === 'B')?.parentId).toBe(groups[1]?.id);
  });

  it('assigns previously referenced nodes when a subgraph closes and retains membership outside', () => {
    const doc = importMermaid('flowchart LR\nA --> B\nsubgraph inner[Inner]\nA\nB\nend\nA --> C').document;
    expect(doc.elements.find(el => el.id === 'A')?.parentId).toBe('inner');
    expect(doc.elements.find(el => el.id === 'B')?.parentId).toBe('inner');
    expect(doc.elements.find(el => el.id === 'C')?.parentId).toBeUndefined();
  });

  it('matches first-completed membership for nested and sibling groups', () => {
    const nested = importMermaid('flowchart LR\nsubgraph outer\nA\nsubgraph inner\nA --> B\nend\nend').document;
    expect(nested.elements.find(el => el.id === 'A')?.parentId).toBe('inner');
    expect(nested.elements.find(el => el.id === 'inner')?.parentId).toBe('outer');
    const siblings = importMermaid('flowchart LR\nsubgraph first\nA\nend\nsubgraph second\nA --> B\nend').document;
    expect(siblings.elements.find(el => el.id === 'A')?.parentId).toBe('first');
    expect(siblings.elements.find(el => el.id === 'B')?.parentId).toBe('second');
  });

  it('supports references to existing groups while excluding self-membership', () => {
    const doc = importMermaid('flowchart LR\nsubgraph first\nA --> first\nend\nsubgraph second\nB --> first\nend').document;
    expect(doc.elements.find(el => el.id === 'first')?.parentId).toBe('second');
    expect(doc.elements.find(el => el.id === 'A')?.parentId).toBe('first');
    expect(doc.elements.filter(el => el.kind === 'connector')).toHaveLength(2);
    expect(() => validateDocument(doc)).not.toThrow();
  });

  it('rejects group-reference cycles and excessively deep nonlexical hierarchies', () => {
    errorCode('flowchart LR\nsubgraph outer\nsubgraph inner\nA --> outer\nend\nend', 'MERMAID_SYNTAX_INVALID');
    const source = 'flowchart LR\nsubgraph g0\nA\nend\n' + Array.from({ length: 33 }, (_, i) => `subgraph g${i + 1}\ng${i}\nend\n`).join('');
    errorCode(source, 'LIMIT_EXCEEDED');
  });

  it('accepts self links and all documented subset line styles', () => {
    const doc = importMermaid('flowchart LR\nA --> A\nA <--> B\nB <-.-> C\nC <==> D\nD -.- E\nE === F\nF -. dotted .-> G\nG == thick ==> H').document;
    const edges = doc.elements.filter(el => el.kind === 'connector');
    expect(edges).toHaveLength(8);
    expect(edges[0]?.points).toHaveLength(4);
    expect(edges[1]).toMatchObject({ startMarker: 'solid-arrow', endMarker: 'solid-arrow' });
    expect(edges[6]?.style.strokeDash).toBe('dotted');
    expect(edges[7]?.style.strokeWidth).toBe(4);
  });

  it.each(['sequenceDiagram\nA->>B: Hello', 'pie\n"A": 1', '---\ntitle: Test\n---\nflowchart LR'])('rejects other diagram types/frontmatter: %s', source => {
    errorCode(source, 'MERMAID_DIAGRAM_UNSUPPORTED');
  });
  it.each([
    'flowchart LR\n%%{init: {}}%%\nA --> B', 'flowchart LR\nclick A "https://example.com"',
    'flowchart LR\nA["<script>alert(1)</script>"]', 'flowchart LR\nA["`markdown`"]',
    'flowchart LR\nA:::danger', 'flowchart LR\nA & B --> C', 'flowchart LR\nA---oB',
    'flowchart LR\nA([stadium])', 'flowchart LR\nstyle A fill:red',
  ])('rejects unsupported syntax without a partial import: %s', source => { errorCode(source, 'MERMAID_SYNTAX_UNSUPPORTED'); });
  it.each(['flowchart XX\nA', 'flowchart LR\nA -->', 'flowchart LR\nA["unclosed]', 'flowchart LR\nA["a"b"]', 'flowchart LR\nsubgraph X\nA', 'flowchart LR\nend'])('rejects malformed syntax: %s', source => { errorCode(source, 'MERMAID_SYNTAX_INVALID'); });

  it.each(['A --x B --> C', 'A --o B --> C', 'A -- t --- B --> C', 'A -- t ---> B', 'A ==x B ==> C', 'A -.x B -.-> C', 'A == t ==== B ==> C', 'A -. t -.- B -.-> C', 'A ---> B', 'A ---- B', 'A ----> B', 'A ====> B', 'A -.--> B', 'A -- t --- B'])('rejects unsupported edge syntax without swallowing an intermediate node: %s', edge => {
    errorCode(`flowchart LR\n${edge}`, 'MERMAID_SYNTAX_UNSUPPORTED');
  });

  it('keeps arrow-like content literal inside fully quoted edge labels', () => {
    const doc = importMermaid('flowchart LR\nA -- "x --o B --> C =." --> B').document;
    expect(doc.elements.find(el => el.kind === 'connector')?.text).toBe('x --o B --> C =.');
  });

  it('checks text, element, source and nesting limits before model expansion', () => {
    errorCode(`flowchart LR\nA[${'x'.repeat(DOMAIN_LIMITS.MAX_TEXT_LENGTH + 1)}]`, 'LIMIT_EXCEEDED');
    errorCode(`flowchart LR\n${Array.from({ length: DOMAIN_LIMITS.MAX_ELEMENTS + 1 }, (_, i) => `N${i}`).join('\n')}`, 'LIMIT_EXCEEDED');
    errorCode(`flowchart LR\n%%${'x'.repeat(8 * 1024 * 1024)}`, 'LIMIT_EXCEEDED');
    errorCode(`flowchart LR\n${Array.from({ length: 33 }, (_, i) => `subgraph g${i}`).join('\n')}\nA\n${'end\n'.repeat(33)}`, 'LIMIT_EXCEEDED');
  });

  it('rejects 200k adversarial fence and HTML-prefix inputs within a killable fixed time budget', () => {
    // A child-process timeout also protects the test runner if a catastrophic
    // regex regression blocks the synchronous importer in the future.
    const script = String.raw`
      const { buildSync } = require('esbuild');
      const { performance } = require('node:perf_hooks');
      const built = buildSync({ entryPoints: ['src/interop/mermaid.ts'], bundle: true, platform: 'browser', format: 'cjs', write: false, alias: { '@': process.cwd() + '/src' } });
      const mod = { exports: {} };
      new Function('module', 'exports', built.outputFiles[0].text)(mod, mod.exports);
      const cases = [
        ['fence', '\x60\x60\x60mermaid\n' + '\n'.repeat(200000) + 'x', 'MERMAID_SYNTAX_UNSUPPORTED'],
        ['html', 'flowchart LR\nA["' + '<a'.repeat(200000) + '"]', 'LIMIT_EXCEEDED'],
        ['raw-label', 'flowchart LR\nA["' + '#65;'.repeat(200000) + '"]', 'LIMIT_EXCEEDED']
      ];
      const results = cases.map(([name, source, expected]) => {
        const start = performance.now(); let code;
        try { mod.exports.importMermaid(source); } catch (error) { code = error.code; }
        const elapsed = performance.now() - start;
        if (code !== expected || elapsed > 1500) throw new Error(name + ': ' + code + ' after ' + elapsed);
        return { name, code, elapsed };
      });
      process.stdout.write(JSON.stringify(results));
    `;
    const output = execFileSync(process.execPath, ['-e', script], { cwd: process.cwd(), encoding: 'utf8', timeout: 5000, maxBuffer: 8192 });
    const results = JSON.parse(output) as { name: string; code: string; elapsed: number }[];
    expect(results).toHaveLength(3);
    expect(results.every(result => result.elapsed < 1500)).toBe(true);
  }, 7000);

  it('restores a complete own document only against the selected-page projection', () => {
    const document = createDocument('Full document');
    document.pages.push({ id: 'page:2', name: 'Second page' });
    document.assets['image:one'] = { id: 'image:one', name: 'Embedded PNG', mimeType: 'image/png', dataUrl: png };
    document.elements.push(createElement('sticky-note', { id: 'note', text: 'Keep my note' }));
    document.elements.push(createElement('image', { id: 'image', pageId: 'page:2', assetId: 'image:one' }));
    document.elements.push(createElement('rectangle', { id: 'second', pageId: 'page:2', text: 'Second' }));
    const result = prepareMermaidExport(document, { pageId: 'page:2' });
    expect(result).toMatchObject({ format: 'mermaid', mimeType: 'text/plain', suggestedExtension: '.mmd', embedsDocument: true, requiresConfirmation: true });
    expect(result.contents.split('%%')[0]).toContain('Second');
    expect(result.contents.split('%%')[0]).not.toContain('Keep my note');
    expect(importMermaid(result.contents)).toMatchObject({ fidelity: 'own-roundtrip', document });
    expect(importMermaid(result.contents).source.pageId).toBe('page:2');
    expect(importMermaid(result.contents).diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'EMBEDDED_MODEL_RESTORED', severity: 'info', pageIndex: 1, message: expect.stringContaining('(2 pages)') })]));
    expect(result.diagnostics.map(d => d.code)).toEqual(expect.arrayContaining(['MERMAID_LAYOUT_LOSS', 'MERMAID_STYLE_LOSS', 'MERMAID_ELEMENT_APPROXIMATED', 'MERMAID_OTHER_PAGES_OMITTED']));
    const changed = importMermaid(result.contents.replace('["Second"]', '["Edited"]'));
    expect(changed.fidelity).not.toBe('own-roundtrip');
    expect(changed.document.pages).toHaveLength(1);
    expect(changed.document.assets).toEqual({});
    expect(changed.document.elements.some(el => el.text === 'Edited')).toBe(true);
    expect(changed.diagnostics.some(d => d.code === 'EMBEDDED_MODEL_STALE')).toBe(true);
    const swappedPage = importMermaid(result.contents.replace('%% sketchdraw-mermaid-v1 1 ', '%% sketchdraw-mermaid-v1 0 '));
    expect(swappedPage.fidelity).not.toBe('own-roundtrip');
  });

  it('restores own CRLF files while rejecting actual edited labels with CRLF', () => {
    const doc = importMermaid('flowchart LR\nA[Original] --> B').document;
    doc.pages.push({ id: 'other', name: 'Other' });
    const crlf = prepareMermaidExport(doc).contents.replace(/\n/g, '\r\n');
    expect(importMermaid(crlf)).toMatchObject({ fidelity: 'own-roundtrip', document: doc });
    expect(importMermaid(`\x60\x60\x60mermaid\r\n${crlf}\x60\x60\x60`).fidelity).toBe('own-roundtrip');
    const edited = importMermaid(crlf.replace('Original', 'Edited'));
    expect(edited.fidelity).not.toBe('own-roundtrip');
    expect(edited.document.pages).toHaveLength(1);
    expect(edited.diagnostics.some(d => d.code === 'EMBEDDED_MODEL_STALE')).toBe(true);
  });

  it('exports valid nonempty quoted tokens and encodes syntax-sensitive label punctuation', () => {
    const doc = createDocument();
    doc.elements.push(createElement('container', { id: 'blank-group' }));
    doc.elements.push(createElement('rectangle', { id: 'blank-node', parentId: 'blank-group' }));
    for (const [index, text] of ['fa:fa-home', 'stylesheet https://a.b/c?x=1', 'style:x(y)', 'First\nSecond'].entries()) doc.elements.push(createElement('rectangle', { id: `label-${index}`, text }));
    const result = prepareMermaidExport(doc, { embedDocument: false });
    expect(result.contents).not.toContain('[""]');
    expect(result.contents).toContain('[" "]');
    expect(result.contents).not.toContain('fa:fa-home');
    expect(result.contents).toContain('fa#58;fa-home');
    expect(result.contents).not.toContain('https://');
    expect(result.diagnostics.some(d => d.code === 'MERMAID_MULTILINE_LABEL_APPROXIMATED')).toBe(true);
    const imported = importMermaid(result.contents).document;
    expect(imported.elements.map(el => el.text)).toEqual(doc.elements.map(el => el.text ?? ''));
  });

  it('rejects duplicated envelopes and safely ignores corrupt ones', () => {
    const doc = importMermaid('flowchart LR\nA --> B').document;
    const exported = prepareMermaidExport(doc).contents;
    const envelope = exported.split('\n').find(line => line.startsWith('%% sketchdraw-'))!;
    errorCode(`${exported}\n${envelope}`, 'MERMAID_SYNTAX_INVALID');
    const corrupt = importMermaid('flowchart LR\nA --> B\n%% sketchdraw-mermaid-v1 0 !!!');
    expect(corrupt.diagnostics.some(d => d.code === 'EMBEDDED_MODEL_INVALID')).toBe(true);
    expect(corrupt.document.elements).toHaveLength(3);
  });

  it('exports safe literal labels and portable subgraphs, preserving semantic edges', () => {
    const doc = importMermaid('flowchart LR\nsubgraph group["Group"]\nA -->|"label"| B\nend').document;
    doc.elements.find(el => el.id === 'A')!.text = 'quote " and ] | ; <b>x</b> &\n%%{init:}';
    const portable = prepareMermaidExport(doc, { embedDocument: false });
    expect(portable.contents).not.toContain('%%{init:}');
    expect(portable.embedsDocument).toBe(false);
    const imported = importMermaid(portable.contents);
    expect(imported.document.elements.find(el => el.kind === 'rectangle')?.text).toBe(doc.elements.find(el => el.id === 'A')!.text);
    expect(imported.document.elements.filter(el => el.kind === 'container')).toHaveLength(1);
    expect(imported.document.elements.filter(el => el.kind === 'connector')).toHaveLength(1);
  });

  it('represents free endpoints explicitly and requires review for lossy convenience exports', () => {
    const doc = createDocument();
    doc.elements.push(createElement('connector', { id: 'free' }));
    const result = prepareMermaidExport(doc, { embedDocument: false });
    expect(result.diagnostics.some(d => d.code === 'MERMAID_FREE_ENDPOINT_APPROXIMATED')).toBe(true);
    expect(importMermaid(result.contents).document.elements).toHaveLength(3);
    expect(() => exportMermaid(doc)).toThrow(expect.objectContaining({ code: 'LOSS_CONFIRMATION_REQUIRED' }));
    expect(() => prepareMermaidExport(doc, { pageId: 'missing' })).toThrow(expect.objectContaining({ code: 'PAGE_NOT_FOUND' }));
  });

  it('preserves label-only nodes and connectors in the portable projection', () => {
    const doc = importMermaid('flowchart LR\nA --> B').document;
    const node = doc.elements.find(el => el.id === 'A')!, edge = doc.elements.find(el => el.kind === 'connector')!;
    node.text = ''; node.label = 'Node label';
    edge.text = ''; edge.label = 'Ja | nein; "x"';
    const result = importMermaid(prepareMermaidExport(doc, { embedDocument: false }).contents);
    expect(result.document.elements.some(el => el.text === 'Node label')).toBe(true);
    expect(result.document.elements.find(el => el.kind === 'connector')?.text).toBe('Ja | nein; "x"');
  });

  it('does not interpret metadata-looking lines inside quoted labels', () => {
    const result = importMermaid('flowchart LR\nA["First line\n%% sketchdraw-mermaid-v1 0 not-an-envelope\nLast line"]');
    expect(result.document.elements[0]?.text).toContain('%% sketchdraw-mermaid-v1 0 not-an-envelope');
    expect(result.diagnostics.some(d => d.code.startsWith('EMBEDDED_MODEL'))).toBe(false);
  });

  it('warns about embedded invisible content and renderer size without hiding portable losses', () => {
    const doc = createDocument();
    doc.elements.push(createElement('sticky-note', { text: 'x'.repeat(40_000) }));
    const exported = prepareMermaidExport(doc);
    expect(exported.diagnostics.map(d => d.code)).toEqual(expect.arrayContaining(['MERMAID_EMBEDDED_DOCUMENT', 'MERMAID_RENDERER_SIZE_LIMIT', 'MERMAID_ELEMENT_APPROXIMATED']));
    expect(importMermaid(exported.contents).document).toEqual(doc);
    expect(prepareMermaidExport(doc, { embedDocument: false }).diagnostics.some(d => d.code === 'MERMAID_RENDERER_SIZE_LIMIT')).toBe(false);
  });
});
