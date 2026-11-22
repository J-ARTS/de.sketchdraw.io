import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDocument, createElement, createTableDocument, tablePlainText, type SketchDocument } from '@/domain';
import { importDrawio, importSvg, prepareDrawioExport, prepareSvgExport } from '@/interop';

/** The EC2 card of the audit (150 x 150), taken from the release file so the element is what the app creates. */
const ec2 = (): SketchDocument => importSvg(readFileSync(resolve(__dirname, '../../fixtures/interop/release-0.1.8/ec2-v0.1.8.svg'), 'utf8')).document;
const cellOf = (xml: string, value: string): string => new RegExp(`<mxCell [^>]*value="${value}"[^>]*>`).exec(xml)![0];
const picture = (cell: string): string => Buffer.from(/image=data:image\/svg\+xml,([A-Za-z0-9+/=]+)/.exec(cell)![1]!, 'base64').toString('utf8');

describe('draw.io export of components (#260)', () => {
  it('writes a cloud card as the picture the canvas shows; its name is written by draw.io and stays editable', () => {
    const exported = prepareDrawioExport(ec2(), { embedDocument: false });
    const cell = cellOf(exported.contents, 'Amazon EC2');
    expect(cell).toContain('shape=image;');
    // The name is the label of the cell: draw.io writes it under the icon, where the canvas shows it, in bold 14 px.
    expect(cell).not.toContain('noLabel');
    for (const entry of ['html=1;', 'verticalAlign=top;', 'align=center;', 'fontSize=14;', 'fontStyle=1;', 'fontColor=#1e1e1e;', 'whiteSpace=wrap;', 'spacingTop=89.98;']) expect(cell, entry).toContain(entry);
    expect(cell).toContain('sketchdrawComponent=aws.compute.instance;');
    const svg = picture(cell);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="-1 -1 152 152" width="150" height="150">/);
    expect(svg).toMatch(/<rect x="0" y="0" width="150" height="150" rx="\d+"/);
    expect(svg).toContain('fill="#ED7100"'); // the EC2 tile of the icon
    // The picture holds what draw.io has no text for: card, icon and the provider line – not the name a second time.
    expect(svg).not.toContain('Amazon EC2</tspan>');
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
    expect(svg).not.toContain('>Azure OpenAI</tspan>'); expect(svg).toContain('>LLM</tspan>');
    for (const entry of ['align=left;', 'spacingLeft=90;', 'fontSize=20;', 'fontStyle=1;', 'fontColor=#1e1e1e;']) expect(cell, entry).toContain(entry);
    expect(svg).toContain('>DOCS</text>'); expect(svg).toContain('>PORTAL</text>');
    // Without a chosen text colour the card is written in black, as on the canvas.
    expect(svg).toContain('fill="#1e1e1e"');
    expect(importSvg(prepareSvgExport(mixed, { embedDocument: false }).contents).document.elements.length).toBeGreaterThan(0);
    const back = importDrawio(exported, { pageIndex: 0 }).document.elements.find((element) => element.componentType === 'generic.resource-card');
    expect(back).toMatchObject({ text: 'Azure OpenAI', description: 'LLM' });
    // An emptied text stays empty on the way through draw.io.
    expect(importDrawio(exported, { pageIndex: 0 }).document.elements.find((element) => element.componentType === 'generic.service')?.text).toBe('');
  });

  it('writes notes, tables and web pages as pictures too and reads them back as what they were', () => {
    const document = createDocument('Bilder');
    const page = document.pages[0]!.id;
    const table = createTableDocument(2, 2); table.cells.forEach((cell, index) => { cell.text = `Z${index}`; });
    document.elements = [
      createElement('sticky-note', { id: 'el:note', pageId: page, x: 0, y: 0, text: 'Erste Zeile\nZweite & <dritte>', author: 'Jeremy' }),
      createElement('table', { id: 'el:table', pageId: page, x: 300, y: 0, width: 240, height: 80, table, text: tablePlainText(table) }),
      createElement('web-embed', { id: 'el:web', pageId: page, x: 600, y: 0, embedUrl: 'https://example.com/', label: 'Beispiel' }),
    ];
    const exported = prepareDrawioExport(document, { embedDocument: false }).contents;
    const note = /<mxCell [^>]*sketchdrawKind=sticky-note[^>]*>/.exec(exported)![0];
    // The text of the note is a label of draw.io (editable, inside the margin of the note); the picture has the paper and the author.
    expect(note).toContain('value="Erste Zeile&lt;br&gt;Zweite &amp;amp; &amp;lt;dritte&amp;gt;"');
    for (const entry of ['shape=image;', 'html=1;', 'spacing=20;', 'verticalAlign=top;', 'whiteSpace=wrap;']) expect(note, entry).toContain(entry);
    expect(picture(note)).toContain('>Jeremy</text>'); expect(picture(note)).not.toContain('Erste Zeile');
    const tableCell = /<mxCell [^>]*sketchdrawKind=table[^>]*>/.exec(exported)![0];
    expect(tableCell).toContain('noLabel=1;'); expect(picture(tableCell)).toContain('Z3');

    const back = importDrawio(exported, { pageIndex: 0 });
    expect(back.document.elements.map((element) => element.kind)).toEqual(['sticky-note', 'table', 'rectangle']);
    expect(back.document.elements[0]).toMatchObject({ text: 'Erste Zeile\nZweite & <dritte>', author: 'Jeremy' });
    expect(back.document.elements[1]!.table!.cells.map((cell) => cell.text)).toEqual(['Z0', 'Z1', 'Z2', 'Z3']);
    expect(back.diagnostics.map((entry) => entry.code)).not.toContain('EXTERNAL_RESOURCE_BLOCKED');
    expect(back.document.elements.some((element) => element.text === 'Blocked image')).toBe(false);
    expect(importDrawio(prepareDrawioExport(document).contents, { pageIndex: 0 }).fidelity).toBe('own-roundtrip');
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
    const referenceTable = createTableDocument(3, 2); ['Dienst', 'Zuständig', 'API', 'Team A', 'Datenbank', 'Team B'].forEach((text, index) => { referenceTable.cells[index]!.text = text; });
    document.elements = [
      { ...document.elements[0]!, id: 'el:ec2', x: 40, y: 40 },
      { ...byType('generic.resource-card'), id: 'el:card', x: 300, y: 40, pageId: page },
      { ...byType('kubernetes.workload.pod'), id: 'el:pod', x: 40, y: 260, pageId: page },
      { ...byType('generic.isometric.instance'), id: 'el:iso', x: 300, y: 270, text: 'Instanz', pageId: page },
      { ...byType('generic.service'), id: 'el:service', x: 480, y: 290, text: 'Dienst', pageId: page },
      createElement('connector', { id: 'el:link', x: 190, y: 115, width: 110, height: 0, pageId: page, from: { elementId: 'el:ec2', anchor: { x: 1, y: .5 } }, to: { elementId: 'el:card', anchor: { x: 0, y: .5 } }, text: 'nutzt' }),
      createElement('sticky-note', { id: 'el:note', x: 700, y: 40, width: 200, height: 200, pageId: page, text: 'Offene Punkte\nLizenz klären', author: 'Jeremy' }),
      createElement('table', { id: 'el:table', x: 300, y: 420, width: 320, height: 96, pageId: page, table: referenceTable, text: tablePlainText(referenceTable) }),
    ];
    const exported = prepareDrawioExport(document, { embedDocument: false }).contents;
    if (process.env['UPDATE_FIXTURES'] === '1') writeFileSync(path, exported);
    expect(exported).toBe(readFileSync(path, 'utf8'));
  });
});

describe('draw.io files written by draw.io', () => {
  it('an arrow whose connection point lies a little outside its shape is imported, attached to the edge', () => {
    // draw.io 26 writes values like 1.005 or -0.007 when an arrow is dropped next to an edge; such a file was refused as a whole.
    const xml = `<mxfile host="Electron" version="26.0.15"><diagram name="Seite-1" id="p1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
      <mxCell id="a" value="A" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell>
      <mxCell id="b" value="B" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="320" y="40" width="120" height="60" as="geometry"/></mxCell>
      <mxCell id="e" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;exitX=1.005;exitY=0.5;exitDx=0;exitDy=0;exitPerimeter=0;entryX=-0.007;entryY=1.004;entryDx=0;entryDy=0;entryPerimeter=0;" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>
    </root></mxGraphModel></diagram></mxfile>`;
    const result = importDrawio(xml, { pageIndex: 0 });
    const arrow = result.document.elements.find((element) => element.kind === 'connector')!;
    const [a, b] = ['A', 'B'].map((text) => result.document.elements.find((element) => element.text === text)!);
    expect(arrow.from).toEqual({ elementId: a!.id, anchor: { x: 1, y: .5 } });
    expect(arrow.to).toEqual({ elementId: b!.id, anchor: { x: 0, y: 1 } });
    expect(result.diagnostics.filter((entry) => entry.code === 'ROUTING_APPROXIMATED' && /outside its shape/.test(entry.message))).toHaveLength(2);
  });
});
