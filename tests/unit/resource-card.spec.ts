import { describe, expect, it } from 'vitest';
import {
  RESOURCE_CARD_COMPONENT_TYPE,
  builtInComponentSets,
  instantiateComponent,
  isResourceCard,
  isSafeResourceLinkUrl,
  resourceCardIconType,
  resourceCardLinks,
  resourceCardMetadataPatch,
} from '@/catalog';
import { applyCommand, createDocument, createElement, type SketchElement } from '@/domain';
import { importSvg, prepareSvgExport } from '@/interop';

function card(metadata?: Record<string, string>): SketchElement {
  return createElement('component', {
    id: 'card:one',
    componentType: RESOURCE_CARD_COMPONENT_TYPE,
    width: 360,
    height: 150,
    metadata,
  });
}

describe('resource card metadata contract', () => {
  it('uses its own catalog set so documents with the existing generic set remain compatible', () => {
    const genericSet = builtInComponentSets.find((candidate) => candidate.id === 'sketchdraw.generic')!;
    const resourceSet = builtInComponentSets.find((candidate) => candidate.id === 'sketchdraw.resource-cards')!;
    const base = createDocument('Bestehendes Diagramm');
    const service = instantiateComponent(base, { set: genericSet, type: 'generic.service', id: 'service:one', at: { x: 20, y: 30 } });
    const withGenericSet = applyCommand(base, service.command);

    const inserted = instantiateComponent(withGenericSet, { set: resourceSet, type: RESOURCE_CARD_COMPONENT_TYPE, id: 'card:one', at: { x: 80, y: 100 } });
    const result = applyCommand(withGenericSet, inserted.command);

    expect(result.componentSets.map((set) => set.id)).toEqual(['sketchdraw.generic', 'sketchdraw.resource-cards']);
    expect(result.elements.map((element) => element.componentType)).toEqual(['generic.service', RESOURCE_CARD_COMPONENT_TYPE]);
  });

  it('roundtrips an icon and ordered safe links while preserving unrelated metadata', () => {
    const previous = { provenance: 'test', 'resource-card:link:old:label': 'Alt' };
    const patch = resourceCardMetadataPatch(previous, 'azure.compute.virtual-machine', [
      { id: 'docs', label: 'Dokumentation', url: 'https://learn.microsoft.com/azure/' },
      { id: 'pricing', label: '', url: 'https://azure.microsoft.com/pricing/' },
    ]);
    const metadata = { ...previous } as Record<string, string>;
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete metadata[key]; else metadata[key] = value;
    }
    const element = card(metadata);
    expect(isResourceCard(element)).toBe(true);
    expect(resourceCardIconType(element)).toBe('azure.compute.virtual-machine');
    expect(resourceCardLinks(element)).toEqual([
      { id: 'docs', label: 'Dokumentation', url: 'https://learn.microsoft.com/azure/' },
      { id: 'pricing', label: 'azure.microsoft.com', url: 'https://azure.microsoft.com/pricing/' },
    ]);
    expect(element.metadata?.provenance).toBe('test');
    expect(element.metadata).not.toHaveProperty('resource-card:link:old:label');
  });

  it('rejects active or credential-bearing URLs and hides invalid imported links', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,test', 'https://user:secret@example.com/']) {
      expect(isSafeResourceLinkUrl(url)).toBe(false);
      expect(() => resourceCardMetadataPatch(undefined, 'generic.service', [{ id: 'bad', label: 'Bad', url }])).toThrow(/gültige HTTP- oder HTTPS-Adresse/);
    }
    expect(resourceCardLinks(card({
      'resource-card:link-order': 'bad,good',
      'resource-card:link:bad:label': 'Bad',
      'resource-card:link:bad:url': 'javascript:alert(1)',
      'resource-card:link:good:label': 'Docs',
      'resource-card:link:good:url': 'https://example.com/docs',
    }))).toEqual([{ id: 'good', label: 'Docs', url: 'https://example.com/docs' }]);
  });

  it('exports the visible card and roundtrips its editable data through embedded SVG', () => {
    const set = builtInComponentSets.find((candidate) => candidate.components.some((component) => component.type === RESOURCE_CARD_COMPONENT_TYPE))!;
    const base = createDocument('Ressourcen');
    const inserted = instantiateComponent(base, { set, type: RESOURCE_CARD_COMPONENT_TYPE, id: 'card:one', at: { x: 20, y: 30 } });
    let document = applyCommand(base, inserted.command);
    document = applyCommand(document, {
      type: 'update',
      changes: [{ id: 'card:one', patch: {
        text: 'Azure Spring Apps',
        label: 'Azure Spring Apps',
        description: 'Spring App Hosting',
        metadata: resourceCardMetadataPatch(inserted.element.metadata, 'aws.compute.lambda', [
          { id: 'docs', label: 'Documentation', url: 'https://example.com/docs' },
        ]),
      } }],
    });
    const svg = prepareSvgExport(document).contents;
    expect(svg).toContain('Azure Spring Apps');
    expect(svg).toContain('SPRING APP HOSTING');
    expect(svg).toContain('href="https://example.com/docs"');
    const roundtrip = importSvg(svg).document;
    expect(roundtrip.elements[0]).toMatchObject({
      componentType: RESOURCE_CARD_COMPONENT_TYPE,
      text: 'Azure Spring Apps',
      description: 'Spring App Hosting',
    });
    expect(resourceCardLinks(roundtrip.elements[0])).toEqual([
      { id: 'docs', label: 'Documentation', url: 'https://example.com/docs' },
    ]);
  });
});
