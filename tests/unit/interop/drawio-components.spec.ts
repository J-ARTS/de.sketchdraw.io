import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDocument, createElement, type SketchDocument } from '@/domain';
import { importDrawio, importSvg, prepareDrawioExport } from '@/interop';

/** The EC2 card of the audit (150 x 150), taken from the release file so the element is what the app creates. */
const ec2 = (): SketchDocument => importSvg(readFileSync(resolve(__dirname, '../../fixtures/interop/release-0.1.8/ec2-v0.1.8.svg'), 'utf8')).document;
const cellOf = (xml: string, value: string): string => new RegExp(`<mxCell [^>]*value="${value}"[^>]*>`).exec(xml)![0];
const picture = (cell: string): string => Buffer.from(/image=data:image\/svg\+xml,([A-Za-z0-9+/=]+)/.exec(cell)![1]!, 'base64').toString('utf8');

describe('draw.io export of components (#260)', () => {
  it('writes a cloud card as the picture the canvas shows: card, icon, name and provider', () => {
    const exported = prepareDrawioExport(ec2(), { embedDocument: false });
    const cell = cellOf(exported.contents, 'Amazon EC2');
    expect(cell).toContain('shape=image;');
    // The name is the value of the cell for draw.io and for reading the file back; the picture shows it.
    expect(cell).toContain('noLabel=1;');
    expect(cell).toContain('sketchdrawComponent=aws.compute.instance;');
    const svg = picture(cell);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="-1 -1 152 152" width="150" height="150">/);
    expect(svg).toMatch(/<rect x="0" y="0" width="150" height="150" rx="\d+"/);
    expect(svg).toContain('fill="#ED7100"'); // the EC2 tile of the icon
    expect(svg).toContain('>Amazon EC2</tspan>');
    expect(svg).toContain('>AWS</text>');
    expect(exported.diagnostics.map((entry) => entry.code)).not.toContain('COMPONENT_ICON_FALLBACK');
  });

  it('reads its own portable file back as the component, and its file with the embedded document unchanged', () => {
    const document = ec2();
    const portable = importDrawio(prepareDrawioExport(document, { embedDocument: false }).contents, { pageIndex: 0 });
    expect(portable.document.elements).toHaveLength(1);
    expect(portable.document.elements[0]).toMatchObject({ kind: 'component', componentType: 'aws.compute.instance', text: 'Amazon EC2', width: 150, height: 150 });
    expect(portable.document.componentSets.map((set) => set.id)).toEqual(['sketchdraw.aws']);
    expect(portable.diagnostics.map((entry) => entry.code)).not.toContain('EXTERNAL_RESOURCE_BLOCKED');

    const embedded = importDrawio(prepareDrawioExport(document).contents, { pageIndex: 0 });
    expect(embedded.fidelity).toBe('own-roundtrip');
    expect(embedded.document.metadata).toEqual({ owner: 'platform-team' });
  });

  it('keeps the description of a resource card and draws its links into the picture', () => {
    const mixed = importSvg(readFileSync(resolve(__dirname, '../../fixtures/interop/release-0.1.8/mixed-v0.1.8.svg'), 'utf8')).document;
    const exported = prepareDrawioExport(mixed, { embedDocument: false }).contents;
    const cell = cellOf(exported, 'Azure OpenAI');
    expect(cell).toContain('sketchdrawDescription=LLM;');
    const svg = picture(cell);
    expect(svg).toContain('>Azure OpenAI</tspan>'); expect(svg).toContain('>LLM</tspan>');
    expect(svg).toContain('>DOCS</text>'); expect(svg).toContain('>PORTAL</text>');
    // Without a chosen text colour the card is written in black, as on the canvas.
    expect(svg).toContain('fill="#1e1e1e"');
    const back = importDrawio(exported, { pageIndex: 0 }).document.elements.find((element) => element.componentType === 'generic.resource-card');
    expect(back).toMatchObject({ text: 'Azure OpenAI', description: 'LLM' });
    // An emptied text stays empty on the way through draw.io.
    expect(importDrawio(exported, { pageIndex: 0 }).document.elements.find((element) => element.componentType === 'generic.service')?.text).toBe('');
  });

  it('a component of a library the file does not carry comes back as an editable rectangle with its text', () => {
    const document = createDocument('Eigene Komponente');
    document.componentSets = [{ id: 'custom.set', name: 'Eigene', version: '1.0.0', components: [{ type: 'custom.thing', name: 'Ding', provider: 'custom', category: 'Eigene', defaultWidth: 160, defaultHeight: 80, style: {} }] }];
    document.elements = [createElement('component', { id: 'el:1', pageId: document.pages[0]!.id, componentType: 'custom.thing', text: 'Mein Ding', width: 160, height: 80 })];
    const exported = prepareDrawioExport(document, { embedDocument: false }).contents;
    expect(cellOf(exported, 'Mein Ding')).toContain('shape=image;');
    const back = importDrawio(exported, { pageIndex: 0 });
    expect(back.document.elements[0]).toMatchObject({ kind: 'rectangle', text: 'Mein Ding' });
    expect(back.diagnostics.map((entry) => entry.code)).toContain('COMPONENT_DEFINITION_MISSING');
  });

  /**
   * The file that was opened in the draw.io editor to compare the cards with the canvas (see the README next to it).
   * Run with UPDATE_FIXTURES=1 to write it again after a deliberate change of the export, then check it in draw.io.
   */
  it('still writes the reference file that was checked in the draw.io editor', () => {
    const path = resolve(__dirname, '../../fixtures/interop/drawio-export/cards-reference.drawio');
    const mixed = importSvg(readFileSync(resolve(__dirname, '../../fixtures/interop/release-0.1.8/mixed-v0.1.8.svg'), 'utf8')).document;
    const document = ec2();
    const page = document.pages[0]!.id;
    const byType = (type: string) => mixed.elements.find((element) => element.componentType === type)!;
    document.componentSets.push(...mixed.componentSets);
    document.elements = [
      { ...document.elements[0]!, id: 'el:ec2', x: 40, y: 40 },
      { ...byType('generic.resource-card'), id: 'el:card', x: 300, y: 40, pageId: page },
      { ...byType('kubernetes.workload.pod'), id: 'el:pod', x: 40, y: 260, pageId: page },
      { ...byType('generic.isometric.instance'), id: 'el:iso', x: 300, y: 270, text: 'Instanz', pageId: page },
      { ...byType('generic.service'), id: 'el:service', x: 480, y: 290, text: 'Dienst', pageId: page },
      createElement('connector', { id: 'el:link', x: 190, y: 115, width: 110, height: 0, pageId: page, from: { elementId: 'el:ec2', anchor: { x: 1, y: .5 } }, to: { elementId: 'el:card', anchor: { x: 0, y: .5 } }, text: 'nutzt' }),
    ];
    const exported = prepareDrawioExport(document, { embedDocument: false }).contents;
    if (process.env['UPDATE_FIXTURES'] === '1') writeFileSync(path, exported);
    expect(exported).toBe(readFileSync(path, 'utf8'));
  });
});
