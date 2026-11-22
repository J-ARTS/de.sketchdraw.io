import { describe, expect, it } from 'vitest';
import { applyCommand, createDocument, type SketchDocument } from '../../src/domain';
import { builtInComponentSets, cloudCardLayout, instantiateComponent, isCloudCard } from '../../src/catalog';
import { prepareSvgExport } from '../../src/interop';
import { getElementChildren, getElementTextContent, parseXmlDocument, type XmlElementNode } from '../../src/interop/xml';

const all = (node: XmlElementNode): XmlElementNode[] => [node, ...getElementChildren(node).flatMap(all)];
const TYPE = 'aws.compute.lambda';
const set = builtInComponentSets.find((entry) => entry.components.some((component) => component.type === TYPE))!;

function withCloudCard(patch: Parameters<typeof applyCommand>[1] extends infer _ ? Record<string, unknown> : never = {}): SketchDocument {
  const document = createDocument('Cloud');
  const { command } = instantiateComponent(document, { set, type: TYPE, id: 'cloud:1', pageId: document.pages[0]!.id, at: { x: 40, y: 60 } });
  let next = applyCommand(document, command);
  next = applyCommand(next, { type: 'update', changes: [{ id: 'cloud:1', patch: { width: 160, height: 160, ...patch } }] });
  return next;
}
/** The group of the element in the exported SVG and its parts. */
function exported(document: SketchDocument) {
  const root = parseXmlDocument(prepareSvgExport(document, { embedDocument: false }).contents);
  const group = all(root).find((node) => node.local === 'g' && all(node).some((child) => child.local === 'title'))!;
  const children = getElementChildren(group);
  return {
    surface: children.find((node) => node.local === 'rect')!,
    icon: children.find((node) => node.local === 'svg')!,
    texts: children.filter((node) => node.local === 'text'),
  };
}

describe('SVG export of a cloud component (#259)', () => {
  it('draws the card the canvas draws: rounded surface, icon in the middle, name and provider below', () => {
    const document = withCloudCard();
    const element = document.elements[0]!;
    expect(isCloudCard(element, [...document.componentSets, ...builtInComponentSets])).toBe(true);
    const layout = cloudCardLayout(element, 'AWS Lambda');
    const { surface, icon, texts } = exported(document);

    // Untouched colours give the surface of the light theme, not the line colour of the definition.
    expect(surface.attributes).toMatchObject({ width: '160', height: '160', rx: '14', fill: '#f3f1fa', stroke: '#ebe9f3' });
    // The icon has the size and the place it has on the canvas, not a small one in the corner.
    expect(Number(icon.attributes['width'])).toBeCloseTo(layout.icon.size, 5);
    expect(Number(icon.attributes['height'])).toBeCloseTo(layout.icon.size, 5);
    expect(Number(icon.attributes['x'])).toBeCloseTo(layout.icon.x, 5);
    expect(Number(icon.attributes['y'])).toBeCloseTo(16, 5);
    expect(layout.icon.size).toBeCloseTo(60.8, 5);

    // Name and provider, centred under the icon.
    expect(texts.map(getElementTextContent)).toEqual(['AWS Lambda', 'AWS']);
    const [title, provider] = texts as [XmlElementNode, XmlElementNode];
    expect(title.attributes).toMatchObject({ 'text-anchor': 'middle', 'font-size': '14', fill: '#1e1e1e' });
    const line = getElementChildren(title)[0]!;
    expect(Number(line.attributes['x'])).toBe(80);
    expect(Number(line.attributes['y'])).toBeCloseTo(layout.title.y, 5);
    expect(Number(line.attributes['y'])).toBeGreaterThan(Number(icon.attributes['y']) + Number(icon.attributes['height']));
    expect(provider.attributes).toMatchObject({ x: '80', 'text-anchor': 'middle', 'font-size': '12', fill: '#5f5c74' });
    expect(Number(provider.attributes['y'])).toBeCloseTo(layout.providerY, 5);
  });

  it('keeps colours the user chose and breaks a long name into two lines', () => {
    const document = withCloudCard({ text: 'Order processing function', style: { ...withCloudCard().elements[0]!.style, fill: '#fde68a', stroke: '#0f766e', textColor: '#7c2d12' } });
    const { surface, texts } = exported(document);
    expect(surface.attributes).toMatchObject({ fill: '#fde68a', stroke: '#0f766e' });
    expect(texts[0]!.attributes['fill']).toBe('#7c2d12');
    const lines = getElementChildren(texts[0]!);
    expect(lines.map(getElementTextContent)).toEqual(['Order processing', 'function']);
    expect(Number(lines[1]!.attributes['y']) - Number(lines[0]!.attributes['y'])).toBe(18);
  });

  it('exports a small cloud component like the canvas draws it: no card, the symbol centred at the top', () => {
    const document = withCloudCard({ width: 100, height: 60 });
    const { surface, icon } = exported(document);
    expect(surface.attributes['rx']).toBeUndefined();
    // 32 px wide, centred: (100 - 32) / 2; 15 % of the height from the top, at least 8 px.
    expect(Number(icon.attributes['x'])).toBe(34);
    expect(Number(icon.attributes['y'])).toBe(9);
  });
});
