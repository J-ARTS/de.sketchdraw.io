import { expect, it } from 'vitest';
import { applyCommand, createDocument, createElement } from '../../src/domain';
import { prepareDrawioExport, prepareSvgExport } from '../../src/interop';
import { getElementChildren, getElementTextContent, parseXmlDocument, type XmlElementNode } from '../../src/interop/xml';

function all(node: XmlElementNode): XmlElementNode[] { return [node, ...getElementChildren(node).flatMap(all)]; }
const document = () => applyCommand(createDocument('Visible labels'), { type: 'add', elements: [
  createElement('rectangle', { id: 'label-only', label: 'Label only & visible' }),
  createElement('ellipse', { id: 'empty-text', text: '', label: 'Emptied text stays empty' }),
  createElement('rectangle', { id: 'explicit-text', text: 'Visible text', label: 'Accessible label' }),
] });
it('exports the same visible label/text fallback as the canvas into native SVG text', () => {
  const result = prepareSvgExport(document(), { embedDocument: false });
  const text = all(parseXmlDocument(result.contents)).filter(node => node.local === 'text').map(getElementTextContent);
  // A text the user emptied stays empty; the label stands in only where no text was set (#258).
  expect(text).toEqual(['Label only & visible', 'Visible text']);
});
it('exports canvas-visible labels as editable native draw.io values', () => {
  const result = prepareDrawioExport(document(), { embedDocument: false });
  const values = all(parseXmlDocument(result.contents)).filter(node => node.local === 'mxCell' && node.attributes['vertex'] === '1').map(node => node.attributes['value']);
  expect(values).toEqual(['Label only & visible', '', 'Visible text']);
});
