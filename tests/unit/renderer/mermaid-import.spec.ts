import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { createDocument, validateDocument } from '@/domain';
import { InteropError } from '@/interop';
import { importedPagePayload, importMermaidCode, MERMAID_SEQUENCE_INVALID, mermaidImportKind } from '@/renderer/lib/mermaid-import';
import { readSequences } from '@/renderer/lib/sequence-model';
import { sequenceToCode } from '@/renderer/lib/sequence-code';
import { planElementPaste } from '@/renderer/state/element-clipboard';
import { applyCommand } from '@/domain';

const SEQUENCE = 'sequenceDiagram\n    participant Client\n    actor Kunde\n    Client->>Dienst: Anfrage\n    Note over Client,Dienst: geprüft\n    loop Jede Minute\n        Dienst-->>Client: Antwort\n    end\n';

describe('Mermaid import (#248)', () => {
  test('the kind of diagram is read from the first line that says something', () => {
    expect(mermaidImportKind('sequenceDiagram\nA->>B: Hi')).toBe('sequence');
    expect(mermaidImportKind('\n%% comment\n  sequenceDiagram\nA->>B: Hi')).toBe('sequence');
    expect(mermaidImportKind('```mermaid\nsequenceDiagram\nA->>B: Hi\n```')).toBe('sequence');
    expect(mermaidImportKind('flowchart LR\nA-->B')).toBe('flowchart');
    expect(mermaidImportKind('graph TD\nA-->B')).toBe('flowchart');
    expect(mermaidImportKind('pie\n"A": 1')).toBe('other');
    expect(mermaidImportKind('')).toBe('other');
  });

  test('a sequence diagram becomes a sequence diagram of the app that reads back as the same code', () => {
    const result = importMermaidCode(SEQUENCE);
    expect(result.source).toMatchObject({ format: 'mermaid', pageId: result.document.pages[0]!.id });
    expect(result.fidelity).toBe('supported-subset');
    expect(result.requiresConfirmation).toBe(false);
    expect(() => validateDocument(result.document)).not.toThrow();
    const diagrams = readSequences(result.document.elements);
    expect(diagrams).toHaveLength(1);
    const model = diagrams[0]!.model;
    expect(model.participants.map((participant) => [participant.name, participant.actor])).toEqual([['Client', false], ['Kunde', true], ['Dienst', false]]);
    const code = sequenceToCode(model);
    for (const part of ['Client->>Dienst: Anfrage', 'Note over Client,Dienst: geprüft', 'loop Jede Minute', 'Dienst-->>Client: Antwort', 'actor Kunde']) expect(code).toContain(part);
    // Every element got an id of its own, and all of them are on the one page.
    const ids = result.document.elements.map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.document.elements.every((element) => element.pageId === result.document.pages[0]!.id)).toBe(true);
  });

  test('code with errors is refused with the lines named, and other diagrams stay unsupported', () => {
    let caught: unknown;
    try { importMermaidCode('sequenceDiagram\n    Note somewhere: Text\n    A->>B: Hi'); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(InteropError);
    expect((caught as InteropError).code).toBe(MERMAID_SEQUENCE_INVALID);
    expect((caught as InteropError).diagnostics[0]).toMatchObject({ severity: 'error', sourceId: 'Zeile 2' });
    expect(() => importMermaidCode('sequenceDiagram\n')).toThrow(InteropError);
    try { importMermaidCode('pie\n"A": 1'); } catch (error) { caught = error; }
    expect((caught as InteropError).code).toBe('MERMAID_DIAGRAM_UNSUPPORTED');
    // Flowcharts go the established way.
    expect(importMermaidCode('flowchart LR\n A[Browser] --> B[Server]').document.elements.length).toBeGreaterThanOrEqual(3);
  });

  test('an imported page can be inserted into another document', () => {
    const result = importMermaidCode(SEQUENCE);
    const payload = importedPagePayload(result.document, result.source.pageId)!;
    expect(payload.elements).toHaveLength(result.document.elements.length);
    let serial = 0;
    let target = createDocument('Target');
    target = applyCommand(target, planElementPaste(payload, target, { x: 500, y: 300 }, (prefix) => `${prefix}:t${serial += 1}`).command);
    expect(readSequences(target.elements)).toHaveLength(1);
    expect(importedPagePayload(createDocument('Empty'), undefined)).toBeNull();
  });

  test.each(readdirSync(resolve(__dirname, '../../fixtures/mermaid-examples')).filter((name) => name.endsWith('.mmd')))('the example %s of the Mermaid documentation is imported as an editable diagram', (name) => {
    const result = importMermaidCode(readFileSync(resolve(__dirname, '../../fixtures/mermaid-examples', name), 'utf8'));
    expect(() => validateDocument(result.document)).not.toThrow();
    expect(result.document.elements.filter((element) => element.kind === 'connector').length).toBeGreaterThanOrEqual(4);
    expect(result.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
  });
});
