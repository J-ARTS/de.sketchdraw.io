import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importDrawio, importMermaid, importSvg, prepareDrawioExport, prepareMermaidExport, prepareSvgExport, type InteropImportResult } from '@/interop';

/**
 * Files written by the exporter of release 0.1.8 (see tests/fixtures/interop/release-0.1.8/README.md). The picture
 * of SVG and draw.io has changed since; a file of that release must still come back from its embedded document (#272).
 */
const fixture = (name: string) => readFileSync(resolve(__dirname, '../../fixtures/interop/release-0.1.8', name), 'utf8');
const read = (name: string, text = fixture(name)): InteropImportResult => name.endsWith('.svg') ? importSvg(text) : name.endsWith('.drawio') ? importDrawio(text, { pageIndex: 0 }) : importMermaid(text);
const codes = (result: InteropImportResult) => result.diagnostics.map((entry) => entry.code);
const envelopeProjection = (contents: string, pattern: RegExp) => JSON.parse(Buffer.from(pattern.exec(contents)![1]!, 'base64').toString('utf8')).projection as string;

describe('files of release 0.1.8', () => {
  it.each(['ec2-v0.1.8.svg', 'ec2-v0.1.8.drawio', 'ec2-v0.1.8.mmd'])('%s comes back unchanged as an editable card with its document attribute', (name) => {
    const result = read(name);
    expect(result.fidelity).toBe('own-roundtrip');
    expect(codes(result)).not.toContain('EMBEDDED_MODEL_STALE');
    expect(result.document.metadata).toEqual({ owner: 'platform-team' });
    expect(result.document.elements).toHaveLength(1);
    expect(result.document.elements[0]).toMatchObject({ kind: 'component', componentType: 'aws.compute.instance', width: 150, height: 150, text: 'Amazon EC2' });
    expect(result.document.componentSets.map((set) => set.id)).toContain('sketchdraw.aws');
  });

  it.each(['mixed-v0.1.8.svg', 'mixed-v0.1.8.drawio', 'mixed-v0.1.8.mmd'])('%s comes back with every element, the links of the card and the emptied texts', (name) => {
    const result = read(name);
    expect(result.fidelity).toBe('own-roundtrip');
    expect(result.document.elements.map((element) => element.kind).sort()).toEqual(['component', 'component', 'component', 'component', 'connector', 'ellipse', 'rectangle', 'sticky-note', 'text']);
    const byType = (type: string) => result.document.elements.find((element) => element.componentType === type)!;
    expect(byType('generic.service')).toMatchObject({ text: '', label: 'Service' });
    expect(byType('generic.isometric.instance').text).toBe('');
    expect(byType('generic.resource-card').metadata).toMatchObject({ 'resource-card:link-order': 'docs,portal', 'resource-card:link:docs:url': 'https://example.com/docs' });
    expect(result.document.elements.find((element) => element.kind === 'connector')).toMatchObject({ from: { elementId: 'el:rect' }, to: { elementId: 'el:ellipse' }, text: 'ruft auf' });
  });

  it('a release SVG whose picture was edited afterwards is still recognised and not restored', () => {
    const source = fixture('ec2-v0.1.8.svg');
    const edited = source.replace('>Amazon EC2<', '>Amazon EC3<');
    expect(edited).not.toBe(source);
    const result = read('ec2-v0.1.8.svg', edited);
    expect(codes(result)).toContain('EMBEDDED_MODEL_STALE');
    expect(result.fidelity).not.toBe('own-roundtrip');
    expect(result.document.elements.some((element) => element.kind === 'component')).toBe(false);
    expect(result.document.metadata).toEqual({});
  });

  it('a release draw.io file and a release Mermaid file edited afterwards are recognised too', () => {
    const drawio = fixture('ec2-v0.1.8.drawio'); const editedDrawio = drawio.replace('value="Amazon EC2"', 'value="Amazon EC3"');
    expect(editedDrawio).not.toBe(drawio);
    expect(codes(read('ec2-v0.1.8.drawio', editedDrawio))).toContain('EMBEDDED_MODEL_STALE');
    const mermaid = fixture('ec2-v0.1.8.mmd'); const editedMermaid = mermaid.replace('Amazon EC2', 'Amazon EC3');
    expect(editedMermaid).not.toBe(mermaid);
    expect(codes(read('ec2-v0.1.8.mmd', editedMermaid))).toContain('EMBEDDED_MODEL_STALE');
  });

  it('a file of today names the picture it was written with and comes back as well', () => {
    const document = read('mixed-v0.1.8.svg').document;
    const svg = prepareSvgExport(document).contents, drawio = prepareDrawioExport(document).contents, mermaid = prepareMermaidExport(document).contents;
    expect(envelopeProjection(svg, /<sd:document[^>]*>([^<]+)</)).toBe('svg-v2');
    expect(envelopeProjection(drawio, /sketchdrawInterop="([^"]+)"/)).toBe('drawio-v3');
    for (const [name, contents] of [['now.svg', svg], ['now.drawio', drawio], ['now.mmd', mermaid]] as const) {
      const result = read(name, contents);
      expect(result.fidelity, name).toBe('own-roundtrip');
      expect(result.document.elements, name).toHaveLength(document.elements.length);
    }
    // The picture of today under the number of the release is not what that release drew: it must not be trusted.
    const relabelled = svg.replace(/(<sd:document[^>]*>)([^<]+)</, (_all, open: string, envelope: string) => `${open}${Buffer.from(Buffer.from(envelope, 'base64').toString('utf8').replace('"projection":"svg-v2"', '"projection":"svg-v1"'), 'utf8').toString('base64')}<`);
    expect(codes(read('relabelled.svg', relabelled))).toContain('EMBEDDED_MODEL_STALE');
  });
});
