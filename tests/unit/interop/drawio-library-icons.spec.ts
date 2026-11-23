import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMPONENT_PRESENTATION_KEY, figureLayout, isIconFigure } from '../../../src/catalog';
import { toOfficialComponentSets, type OfficialProvider, type RawOfficialLibrary } from '../../../src/catalog/official-sets';
import { serializeDocument, type ComponentSet } from '../../../src/domain';
import { DRAWIO_LIBRARY_ICON_KEY, importDrawio, prepareDrawioExport } from '../../../src/interop';
import { drawioLibraryIconCount, drawioLibraryProviders, resolveDrawioLibraryIcons, resolveLibraryIcons } from '../../../src/renderer/lib/drawio-library-icons';

/** A file rebuilt by hand in the shape draw.io writes: icons are named by their library, not carried along. */
const FILE = readFileSync('tests/fixtures/interop/external/drawio-library-icons.drawio', 'utf8');
const library = (provider: OfficialProvider): ComponentSet[] => toOfficialComponentSets(JSON.parse(readFileSync(`src/catalog/official/${provider}.json`, 'utf8')) as RawOfficialLibrary);
const load = async (provider: OfficialProvider): Promise<ComponentSet[]> => library(provider);

describe('icons of the draw.io libraries (#280)', () => {
  it('the import notes the library icon a cell names and keeps the cell as a labelled box', () => {
    const imported = importDrawio(FILE);
    const byText = (text: string) => imported.document.elements.find((element) => element.text === text)!;
    expect(byText('Rohdaten')).toMatchObject({ kind: 'rectangle', x: 80, y: 80, width: 68, height: 68, metadata: { [DRAWIO_LIBRARY_ICON_KEY]: 'azure2/general/Blob_Block' } });
    expect(byText('Azure OpenAI').metadata?.[DRAWIO_LIBRARY_ICON_KEY]).toBe('azure2/ai_machine_learning/Azure_OpenAI');
    expect(byText('API').metadata?.[DRAWIO_LIBRARY_ICON_KEY]).toBe('kubernetes/api');
    expect(byText('Shop').metadata?.[DRAWIO_LIBRARY_ICON_KEY]).toBe('kubernetes/deploy');
    expect(byText('Laptop').metadata?.[DRAWIO_LIBRARY_ICON_KEY]).toBe('clip_art/computers/Laptop_128x128');
    // A picture from a web address is not a library icon and stays blocked; an ordinary box carries no note.
    expect(byText('Logo').metadata?.[DRAWIO_LIBRARY_ICON_KEY]).toBeUndefined();
    expect(byText('Notiz').metadata?.[DRAWIO_LIBRARY_ICON_KEY]).toBeUndefined();
    expect(drawioLibraryIconCount(imported.document)).toBe(7);
    expect(drawioLibraryProviders(imported.document).sort()).toEqual(['azure', 'kubernetes']);
    // Each of them is named once in the diagnostics, as a library icon and not as a broken picture.
    expect(imported.diagnostics.filter((entry) => entry.code === 'DRAWIO_LIBRARY_ICON')).toHaveLength(7);
    expect(imported.diagnostics.filter((entry) => entry.code === 'UNSUPPORTED_SHAPE')).toEqual([]);
  });

  it('icons the app has become icons at the place and size of the box, with its text; the others stay boxes', async () => {
    const imported = importDrawio(FILE);
    const { document, resolved, unresolved } = await resolveDrawioLibraryIcons(imported.document, load);
    expect({ resolved, unresolved }).toEqual({ resolved: 5, unresolved: 2 });
    const element = (id: string) => document.elements.find((entry) => entry.id === imported.document.elements.find((source) => source.text === id || source.id === id)!.id)!;

    // The icon is drawn as in draw.io: the symbol where the cell was, its text below. The element therefore keeps
    // the top and the middle of the cell, is as wide as the label needs and higher by the line of the label.
    const blob = element('Rohdaten');
    expect(blob).toMatchObject({ kind: 'component', componentType: 'azure.general.blob-block', x: 80, y: 80, width: 68, height: 68 + 19, text: 'Rohdaten', label: 'Rohdaten', metadata: { [COMPONENT_PRESENTATION_KEY]: 'icon' } });
    expect(blob.style.fontSize).toBe(12);
    expect(isIconFigure(blob)).toBe(true);
    // The symbol itself has the size and the place of the cell.
    expect(figureLayout(blob, 1).icon).toEqual({ x: 0, y: 0, size: 68 });
    const openai = element('Azure OpenAI');
    expect(openai).toMatchObject({ kind: 'component', componentType: 'azure.ai-machine-learning.azure-openai', text: 'Azure OpenAI', y: 80 });
    expect(openai.width).toBeGreaterThan(68);
    expect(openai.x + openai.width / 2).toBe(280 + 34);
    const api = element('API');
    expect(api).toMatchObject({ kind: 'component', componentType: 'kubernetes.control-plane.api-server', x: 480, y: 80, width: 50, text: 'API' });
    expect(figureLayout(api, 1).icon.size).toBe(48);
    expect(element('Shop')).toMatchObject({ kind: 'component', componentType: 'kubernetes.ressourcen.deployment', text: 'Shop' });
    // A cell without a text takes the name of the icon.
    const ccm = document.elements.find((entry) => entry.componentType === 'kubernetes.control-plane.cloud-controller-manager')!;
    expect(ccm).toMatchObject({ kind: 'component', y: 80, text: 'Cloud Controller Manager' });
    expect(ccm.x + ccm.width / 2).toBe(640 + 25);

    expect(element('Neuer Dienst')).toMatchObject({ kind: 'rectangle', text: 'Neuer Dienst' });
    expect(element('Laptop')).toMatchObject({ kind: 'rectangle', text: 'Laptop' });
    // Nothing about draw.io is left in the document.
    expect(document.elements.some((entry) => entry.metadata?.[DRAWIO_LIBRARY_ICON_KEY] !== undefined)).toBe(false);

    // The document carries the sets of the icons it uses, and only those; it is valid and can be saved and exported.
    expect(document.componentSets.map((set) => set.id).sort()).toEqual(['sketchdraw.azure.ai-machine-learning', 'sketchdraw.azure.general', 'sketchdraw.kubernetes.control-plane', 'sketchdraw.kubernetes.ressourcen']);
    expect(() => serializeDocument(document)).not.toThrow();
    expect(() => prepareDrawioExport(document, { embedDocument: false })).not.toThrow();
    // Connectors still end at the same elements.
    const connectors = document.elements.filter((entry) => entry.kind === 'connector');
    expect(connectors).toHaveLength(2);
    for (const connector of connectors) {
      for (const end of [connector.from, connector.to]) expect(document.elements.some((entry) => entry.id === end?.elementId && entry.kind === 'component')).toBe(true);
    }
  });

  it('matches names the way draw.io writes them and prefers the category of the file', () => {
    const imported = importDrawio(FILE);
    const sets = [...library('azure'), ...library('kubernetes')];
    const withReference = (reference: string) => ({ ...imported.document, elements: imported.document.elements.map((entry) => (entry.text === 'Rohdaten' ? { ...entry, metadata: { [DRAWIO_LIBRARY_ICON_KEY]: reference } } : entry.metadata?.[DRAWIO_LIBRARY_ICON_KEY] ? { ...entry, metadata: {} } : entry)) });
    const typeFor = (reference: string) => resolveLibraryIcons(withReference(reference), sets).document.elements.find((entry) => entry.text === 'Rohdaten')!.componentType;
    expect(typeFor('azure2/general/Blob_Block')).toBe('azure.general.blob-block');
    expect(typeFor('azure2/ai_machine_learning/Azure_OpenAI')).toBe('azure.ai-machine-learning.azure-openai');
    expect(typeFor('kubernetes/c_c_m')).toBe('kubernetes.control-plane.cloud-controller-manager');
    expect(typeFor('kubernetes/c_m')).toBe('kubernetes.control-plane.controller-manager');
    expect(typeFor('kubernetes/cm')).toBe('kubernetes.ressourcen.configmap');
    expect(typeFor('kubernetes/master')).toBe('kubernetes.infrastruktur.control-plane');
    expect(typeFor('kubernetes/svc')).toBe('kubernetes.ressourcen.service');
    expect(typeFor('kubernetes/no_such_icon')).toBeUndefined();
    expect(typeFor('aws4/ec2')).toBeUndefined();
    expect(typeFor('azure2/')).toBeUndefined();
  });

  it('resolves nothing when a library cannot be loaded, and leaves a document without library icons as it is', async () => {
    const imported = importDrawio(FILE);
    const offline = await resolveDrawioLibraryIcons(imported.document, async () => { throw new Error('offline'); });
    expect({ resolved: offline.resolved, unresolved: offline.unresolved }).toEqual({ resolved: 0, unresolved: 7 });
    expect(offline.document.elements.every((entry) => entry.kind !== 'component')).toBe(true);
    expect(offline.document.componentSets).toEqual(imported.document.componentSets);

    const plain = { ...imported.document, elements: imported.document.elements.filter((entry) => entry.text === 'Notiz') };
    const untouched = await resolveDrawioLibraryIcons(plain, load);
    expect(untouched.document).toBe(plain);
    expect({ resolved: untouched.resolved, unresolved: untouched.unresolved }).toEqual({ resolved: 0, unresolved: 0 });
  });
});
