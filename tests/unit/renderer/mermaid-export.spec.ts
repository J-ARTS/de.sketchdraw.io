import { describe, expect, it } from 'vitest';
import { applyCommand, createDocument, createElement, type SketchDocument, type SketchElement } from '@/domain';
import { importMermaid, prepareMermaidExport } from '@/interop';
import { defaultMermaidExportTarget, MERMAID_FLOWCHART_TARGET, mermaidExportTargets, prepareMermaidCodeExport } from '@/renderer/lib/mermaid-export';
import { importMermaidCode } from '@/renderer/lib/mermaid-import';
import { parseSequenceCode } from '@/renderer/lib/sequence-code';
import { buildSequence, readSequences } from '@/renderer/lib/sequence-model';

const SEQUENCE = `sequenceDiagram
    participant Client
    participant Dienst
    Client->>Dienst: Anfrage
    Dienst-->>Client: Antwort
`;
function documentWith(elements: SketchElement[], title = 'Export'): SketchDocument {
  const document = createDocument(title);
  return applyCommand(document, { type: 'add', elements: elements.map((element) => ({ ...element, pageId: document.pages[0]!.id })) });
}
const sequenceElements = (code = SEQUENCE, origin = { x: 0, y: 0 }) => buildSequence(parseSequenceCode(code).model, origin);
const visible = (contents: string) => contents.split('\n').filter((line) => !line.startsWith('%% sketchdraw-mermaid')).join('\n');

describe('Mermaid export keeps the type of the diagram (#261)', () => {
  it('writes a sequence diagram as sequenceDiagram: participants, kind of message and order', () => {
    const document = documentWith(sequenceElements());
    expect(mermaidExportTargets(document, document.pages[0]!.id)).toEqual([{ id: expect.stringMatching(/^sequence:/), kind: 'sequence', names: 'Client, Dienst' }]);
    const result = prepareMermaidCodeExport(document, { embedDocument: false });
    expect(result.contents).toBe(SEQUENCE);
    expect(result.contents).not.toContain('flowchart');
    const lines = result.contents.split('\n').map((line) => line.trim());
    expect(lines.indexOf('Client->>Dienst: Anfrage')).toBeLessThan(lines.indexOf('Dienst-->>Client: Antwort'));
    expect(result.diagnostics.filter((entry) => entry.severity === 'warning')).toEqual([]);
  });

  it('what it wrote is read back: unchanged as the whole document, edited as the code that stands there', () => {
    const document = documentWith(sequenceElements(), 'Mit Sequenz');
    const exported = prepareMermaidCodeExport(document).contents;
    expect(visible(exported)).toBe(SEQUENCE);
    const restored = importMermaidCode(exported);
    expect(restored.fidelity).toBe('own-roundtrip');
    expect(restored.document.title).toBe('Mit Sequenz');
    expect(restored.document.elements).toHaveLength(document.elements.length);

    const edited = importMermaidCode(exported.replace('Anfrage', 'Bestellung'));
    expect(edited.fidelity).not.toBe('own-roundtrip');
    const model = readSequences(edited.document.elements)[0]!.model;
    expect(model.items.map((item) => item.type === 'message' ? item.text : '')).toEqual(['Bestellung', 'Antwort']);

    // Without the embedded document the code alone gives the same diagram again.
    const portable = importMermaidCode(prepareMermaidCodeExport(document, { embedDocument: false }).contents);
    expect(readSequences(portable.document.elements)[0]!.model.participants.map((participant) => participant.name)).toEqual(['Client', 'Dienst']);
  });

  it('offers every diagram of a page and leaves the parts of a sequence diagram out of the flowchart', () => {
    const shapes = [
      createElement('rectangle', { id: 'el:api', x: 900, y: 0, width: 160, height: 80, text: 'API' }),
      createElement('ellipse', { id: 'el:db', x: 1200, y: 0, width: 160, height: 80, text: 'Datenbank' }),
      createElement('connector', { id: 'el:edge', x: 1060, y: 40, width: 140, height: 0, from: { elementId: 'el:api', anchor: { x: 1, y: .5 } }, to: { elementId: 'el:db', anchor: { x: 0, y: .5 } }, text: 'liest' }),
      createElement('connector', { id: 'el:free', x: 900, y: 300, width: 100, height: 0 }),
      createElement('path', { id: 'el:scribble', x: 900, y: 400, width: 40, height: 40, points: [{ x: 0, y: 0 }, { x: 40, y: 40 }] }),
    ];
    const document = documentWith([...sequenceElements(), ...shapes]);
    const pageId = document.pages[0]!.id;
    const targets = mermaidExportTargets(document, pageId);
    expect(targets.map((target) => target.kind)).toEqual(['sequence', 'flowchart']);
    expect(defaultMermaidExportTarget(document, pageId)).toBe(targets[0]!.id);
    expect(defaultMermaidExportTarget(document, pageId, ['el:api'])).toBe(MERMAID_FLOWCHART_TARGET);
    const lifeline = document.elements.find((element) => element.metadata?.['sequence:role'] === 'lifeline')!;
    expect(defaultMermaidExportTarget(document, pageId, [lifeline.id])).toBe(targets[0]!.id);

    const flowchart = prepareMermaidCodeExport(document, { embedDocument: false, target: MERMAID_FLOWCHART_TARGET }).contents;
    expect(flowchart).toBe('flowchart LR\n  n0["API"]\n  n1(("Datenbank"))\n  n0 -->|"liest"| n1\n');
    const sequence = prepareMermaidCodeExport(document, { embedDocument: false, target: targets[0]!.id });
    expect(sequence.contents).toBe(SEQUENCE);
    expect(sequence.diagnostics.map((entry) => entry.code)).toContain('MERMAID_ELEMENTS_OMITTED');
  });

  it('a flowchart of today has no stand-in nodes and is read back from its embedded document', () => {
    const document = documentWith([
      createElement('rectangle', { id: 'el:a', x: 0, y: 0, width: 160, height: 80, text: 'A' }),
      createElement('rectangle', { id: 'el:empty', x: 300, y: 0, width: 160, height: 80, text: '', label: 'Vorgabe' }),
      createElement('connector', { id: 'el:free', x: 0, y: 200, width: 100, height: 0, from: { elementId: 'el:a', anchor: { x: .5, y: 1 } } }),
    ]);
    const exported = prepareMermaidExport(document);
    expect(visible(exported.contents)).toBe('flowchart LR\n  n0["A"]\n  n1[" "]\n');
    expect(exported.contents).not.toContain('Endpoint');
    expect(exported.diagnostics.map((entry) => entry.code)).toContain('MERMAID_ELEMENTS_OMITTED');
    const restored = importMermaid(exported.contents);
    expect(restored.fidelity).toBe('own-roundtrip');
    expect(restored.document.elements).toHaveLength(3);
  });
});
