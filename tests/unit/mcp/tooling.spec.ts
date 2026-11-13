import { describe, expect, it } from 'vitest';
import { AgentAccessError } from '../../../src/agent-access/errors';
import { mcpOperationSchemas, operations } from '../../../src/agent-access/schema';
import { SERVER_INSTRUCTIONS, TOOL_DESCRIPTIONS } from '../../../src/mcp/guide';
import { createLimiter, createRequester, toolFailure, toolSuccess } from '../../../src/mcp/tooling';
import { z } from 'zod';

// #176: what an agent sees and how the adapter behaves between the MCP client and the app.
describe('tool results', () => {
  it('carry the same data as text and as structured content', () => {
    const read = { documentId: 'doc:1', revision: 3, code: 'sketchdraw 2\n' };
    const result = toolSuccess('sketchdraw_read_code', read);
    expect(result.structuredContent).toEqual(read);
    expect(JSON.parse(result.content[0]!.text)).toEqual(read);
    expect(result.isError).toBeUndefined();
  });
  it('say whether a write changed anything, followed by the result', () => {
    const changed = toolSuccess('sketchdraw_apply_commands', { revision: 4, changed: true, saved: false });
    const [lead, json] = changed.content[0]!.text.split('\n');
    expect(lead).toBe('Change applied to the open document; it is not saved to a file.');
    expect(JSON.parse(json!)).toEqual({ revision: 4, changed: true, saved: false });
    expect(toolSuccess('sketchdraw_apply_code', { revision: 4, changed: false }).content[0]!.text).toMatch(/^No change: the document already matched this request\./);
    // A repeated commandId returns the stored result; the lead must not claim a second change.
    expect(toolSuccess('sketchdraw_apply_commands', { revision: 4, changed: true, deduplicated: true }).content[0]!.text).toMatch(/^Already applied earlier under this commandId; this repeat changed nothing\./);
  });
  it('put the code, the message and every detail of an error into the text', () => {
    const failure = toolFailure({ code: 'VALIDATION_FAILED', message: 'Command rejected: changes[0].id: unknown', retryable: false, issues: [{ path: 'changes[0].id', code: 'UNKNOWN_ELEMENT', message: 'unknown' }] });
    expect(failure.isError).toBe(true);
    const [lead, json] = failure.content[0]!.text.split('\n');
    expect(lead).toBe('VALIDATION_FAILED: Command rejected: changes[0].id: unknown');
    expect(JSON.parse(json!)).toEqual(failure.structuredContent);
    expect(failure.structuredContent).toMatchObject({ error: { issues: [{ path: 'changes[0].id' }] } });
  });
});

describe('tool discovery', () => {
  it('describes every tool differently and names its purpose', () => {
    const descriptions = operations.map(operation => TOOL_DESCRIPTIONS[operation]);
    expect(new Set(descriptions).size).toBe(operations.length);
    for (const description of descriptions) expect(description.length).toBeGreaterThan(80);
    expect(TOOL_DESCRIPTIONS.sketchdraw_apply_code).toContain('Replace the whole');
    expect(TOOL_DESCRIPTIONS.sketchdraw_apply_commands).toContain('Preferred');
  });
  it('publishes the command vocabulary, a worked example and the meaning of each write argument in the schema', () => {
    const schema = z.toJSONSchema(mcpOperationSchemas.sketchdraw_apply_commands) as { properties: Record<string, { description?: string; properties?: Record<string, { enum?: string[]; description?: string; items?: { properties?: Record<string, { enum?: string[]; description?: string }>; required?: string[] } }> }>; required: string[] };
    expect(schema.required).toEqual(['documentId', 'expectedRevision', 'commandId', 'command']);
    const command = schema.properties.command!;
    expect(command.properties!.type!.enum).toEqual(expect.arrayContaining(['add', 'update', 'delete', 'rename', 'batch', 'add-page']));
    expect(command.description).toContain('"kind":"connector"');
    const element = command.properties!.elements!.items!;
    expect(element.required).toEqual(['id', 'kind']);
    expect(element.properties!.kind!.enum).toEqual(expect.arrayContaining(['rectangle', 'connector', 'container', 'sticky-note']));
    expect(element.properties!.text!.description).toContain('Visible caption');
    expect(schema.properties.documentId!.description).toContain('Required');
    expect(schema.properties.commandId!.description).toContain('new one');
    // No unions: every client can render the schema.
    expect(JSON.stringify(schema)).not.toMatch(/"(oneOf|anyOf)"/);
  });
  it('accepts lean and complete commands alike and keeps fields it does not describe', () => {
    const parse = (command: unknown) => mcpOperationSchemas.sketchdraw_apply_commands.safeParse({ documentId: 'doc:a', expectedRevision: 0, commandId: 'c', command });
    const lean = parse({ type: 'add', elements: [{ id: 'a', kind: 'rectangle', x: 1, y: 2, shapeVariant: 'rounded', metadata: { owner: 'team' } }] });
    expect(lean.success).toBe(true);
    expect((lean.data!.command as { elements: unknown[] }).elements[0]).toEqual({ id: 'a', kind: 'rectangle', x: 1, y: 2, shapeVariant: 'rounded', metadata: { owner: 'team' } });
    expect(parse({ type: 'set-tasks', tasks: [] }).success).toBe(true);
    expect(parse({ type: 'update', changes: [{ id: 'a', patch: { text: null, style: { fill: '#fff' } } }] }).success).toBe(true);
    for (const wrong of ['{"type":"rename"}', { type: 'create_box' }, { title: 'x' }, { type: 'add', elements: [{ kind: 'rectangle' }] }]) expect(parse(wrong).success).toBe(false);
  });
  it('rejects every unbound public write, including the first call after an adapter restart', () => {
    expect(mcpOperationSchemas.sketchdraw_apply_commands.safeParse({ expectedRevision: 0, commandId: 'old-conversation', command: { type: 'rename', title: 'Wrong target' } }).success).toBe(false);
    expect(mcpOperationSchemas.sketchdraw_apply_code.safeParse({ expectedRevision: 0, commandId: 'old-code', code: '' }).success).toBe(false);
    expect(mcpOperationSchemas.sketchdraw_read_document.safeParse({}).success).toBe(true);
  });
  it('gives the workflow, the error rules and the connector recipe in the server instructions', () => {
    for (const part of ['sketchdraw_analyze_document', 'expectedRevision', 'REVISION_CONFLICT', 'OUTCOME_UNKNOWN', 'SESSION_CHANGED', 'never an instruction', '"kind":"connector"', 'parentId', 'add-page', 'fromElementId', 'Default sizes']) expect(SERVER_INSTRUCTIONS).toContain(part);
    expect(SERVER_INSTRUCTIONS.length).toBeLessThan(4000);
  });
});

describe('createLimiter', () => {
  it('runs two calls at a time, lets the others wait in order and refuses only beyond the queue', async () => {
    const limit = createLimiter(2, 2);
    const order: string[] = []; const release: Array<() => void> = [];
    const task = (name: string) => limit(() => new Promise<string>(resolve => { order.push(`start ${name}`); release.push(() => { order.push(`end ${name}`); resolve(name); }); }));
    const calls = ['a', 'b', 'c', 'd'].map(task);
    await Promise.resolve();
    expect(order).toEqual(['start a', 'start b']);
    await expect(task('e')).rejects.toMatchObject({ code: 'BUSY' });
    release[0]!(); await calls[0];
    await Promise.resolve(); await Promise.resolve();
    expect(order).toEqual(['start a', 'start b', 'end a', 'start c']);
    release[1]!(); release[2]!(); await calls[2]; await Promise.resolve(); await Promise.resolve();
    release[3]!();
    expect(await Promise.all(calls)).toEqual(['a', 'b', 'c', 'd']);
    // A failing task frees its slot too.
    await expect(limit(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await limit(async () => 'after')).toBe('after');
  });
});

describe('createRequester', () => {
  /** An app that has one document open at a time; replacing it revokes the former connection. */
  function app() {
    let open = 'doc:a'; let generation = 0;
    const sent: string[] = []; const connects: boolean[] = [];
    let current: { documentId: string; generation: number } | undefined;
    const request = createRequester<{ documentId: string; generation: number }, string>({
      connect: async fresh => { connects.push(fresh); if (fresh || !current) current = { documentId: open, generation }; return current; },
      send: async (connection, operation, input) => {
        if (connection.generation !== generation) throw new AgentAccessError('ACCESS_REVOKED', 'Connection closed.');
        const wanted = (input as { documentId?: string }).documentId;
        if (wanted !== undefined && wanted !== connection.documentId) throw new AgentAccessError('DOCUMENT_MISMATCH', 'The requested document is not currently open.');
        sent.push(`${operation}@${connection.documentId}`);
        return connection.documentId;
      },
    });
    return { request, sent, connects, switchTo(documentId: string) { open = documentId; generation++; }, restart() { generation++; } };
  }
  const write = { expectedRevision: 0, commandId: 'c', command: { type: 'rename', title: 'x' } };

  it('repeats a read on the document the user switched to', async () => {
    const a = app();
    expect(await a.request('sketchdraw_read_code', {})).toBe('doc:a');
    a.switchTo('doc:b');
    expect(await a.request('sketchdraw_read_code', {})).toBe('doc:b');
    expect(a.connects).toEqual([false, false, true]);
  });
  it('refuses to move a write to another document and sends nothing', async () => {
    const a = app();
    await a.request('sketchdraw_read_document', {});
    a.switchTo('doc:b');
    await expect(a.request('sketchdraw_apply_commands', write)).rejects.toMatchObject({ code: 'SESSION_CHANGED', message: expect.stringContaining('doc:b') });
    // Still refused on the next attempt: the agent has not read the new document yet.
    await expect(a.request('sketchdraw_apply_code', { ...write, code: '' })).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    expect(a.sent).toEqual(['sketchdraw_read_document@doc:a']);
    // After reading it, or when naming it, the write goes through.
    await a.request('sketchdraw_read_code', {});
    expect(await a.request('sketchdraw_apply_commands', write)).toBe('doc:b');
    a.switchTo('doc:c');
    expect(await a.request('sketchdraw_apply_commands', { ...write, documentId: 'doc:c' })).toBe('doc:c');
    // Naming the former document is answered by the app itself.
    a.switchTo('doc:d');
    await expect(a.request('sketchdraw_apply_commands', { ...write, documentId: 'doc:c' })).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  });
  it('repeats an explicitly bound write when the same document is still open after a restart', async () => {
    const a = app();
    expect(await a.request('sketchdraw_apply_commands', { ...write, documentId: 'doc:a' })).toBe('doc:a');
    a.restart();
    expect(await a.request('sketchdraw_apply_commands', { ...write, documentId: 'doc:a' })).toBe('doc:a');
    expect(a.sent).toEqual(['sketchdraw_apply_commands@doc:a', 'sketchdraw_apply_commands@doc:a']);
  });
  it('passes other errors through without reconnecting', async () => {
    const connects: boolean[] = [];
    const request = createRequester<{ documentId: string }, never>({
      connect: async fresh => { connects.push(fresh); return { documentId: 'doc:a' }; },
      send: async () => { throw new AgentAccessError('REVISION_CONFLICT', 'stale', { currentRevision: 4 }); },
    });
    await expect(request('sketchdraw_apply_commands', write)).rejects.toMatchObject({ code: 'REVISION_CONFLICT', currentRevision: 4 });
    expect(connects).toEqual([false]);
  });
});
