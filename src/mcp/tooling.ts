import { AgentAccessError } from '../agent-access/errors';
import { AGENT_WRITE_OPERATIONS, type AgentAccessErrorPayload, type AgentOperationName } from '../agent-access/types';

/** Transport-independent behaviour of the MCP adapter (#176), separated from server.ts so it can be tested without stdio. */
type TextBlock = { type: 'text'; text: string };
// A type alias, not an interface: the SDK's result type carries an index signature.
export type ToolResponse = { content: TextBlock[]; structuredContent: Record<string, unknown>; isError?: true };

/**
 * The result is delivered twice: as `structuredContent` and as the same JSON in a text block. Many clients hand their
 * model only one of the two; a placeholder text would leave those models without the document.
 */
export function toolSuccess(operation: AgentOperationName, result: object): ToolResponse {
  const structuredContent = result as Record<string, unknown>;
  const json = JSON.stringify(structuredContent);
  if (!AGENT_WRITE_OPERATIONS.has(operation)) return { content: [{ type: 'text', text: json }], structuredContent };
  const lead = structuredContent.deduplicated === true
    ? 'Already applied earlier under this commandId; this repeat changed nothing. The stored result follows.'
    : structuredContent.changed === false
      ? 'No change: the document already matched this request. Nothing was saved to a file.'
      : 'Change applied to the open document; it is not saved to a file.';
  return { content: [{ type: 'text', text: `${lead}\n${json}` }], structuredContent };
}
export function toolFailure(payload: AgentAccessErrorPayload): ToolResponse {
  return { isError: true, content: [{ type: 'text', text: `${payload.code}: ${payload.message}\n${JSON.stringify({ error: payload })}` }], structuredContent: { error: payload } };
}

/**
 * Runs at most `limit` tasks at once and lets further ones wait in order. Agent clients issue several read calls in
 * parallel; the app accepts two per connection, and the surplus used to fail with BUSY.
 */
export function createLimiter(limit: number, maxWaiting: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: Array<() => void> = [];
  const release = () => { active--; waiting.shift()?.(); };
  return async task => {
    if (active >= limit) {
      if (waiting.length >= maxWaiting) throw new AgentAccessError('BUSY', 'Too many Sketchdraw calls are waiting; retry shortly.');
      await new Promise<void>(resolve => { waiting.push(resolve); });
    }
    active++;
    try { return await task(); } finally { release(); }
  };
}

export interface DocumentConnection { readonly documentId: string }
const RECONNECT_CODES: ReadonlySet<string> = new Set(['ACCESS_DENIED', 'ACCESS_REVOKED', 'SESSION_CHANGED']);

/**
 * Sends one tool call over the current connection and reconnects once when the app has rotated its access (document
 * change or restart). A read is repeated on the new connection. A write is repeated only when the same document is
 * still open: revisions start at 0 in every document, so a change aimed at the former document could otherwise be
 * applied to the one the user opened in the meantime.
 */
export function createRequester<C extends DocumentConnection, R>(options: {
  connect(fresh: boolean): Promise<C>;
  send(connection: C, operation: AgentOperationName, input: unknown): Promise<R>;
}): (operation: AgentOperationName, input: unknown) => Promise<R> {
  // The document whose ID the agent has last seen in a result. A write goes only to that document, or to the one the
  // agent names itself; before the first result there is nothing a write could be mistaken for.
  let acknowledged: string | undefined;
  return async (operation, input) => {
    const write = AGENT_WRITE_OPERATIONS.has(operation);
    const attempt = async (fresh: boolean): Promise<R> => {
      const connection = await options.connect(fresh);
      if (write && acknowledged !== undefined && acknowledged !== connection.documentId && requestedDocument(input) !== connection.documentId) throw documentChanged(connection.documentId);
      const result = await options.send(connection, operation, input);
      acknowledged = connection.documentId;
      return result;
    };
    try { return await attempt(false); }
    catch (error) {
      if (!(error instanceof AgentAccessError) || !RECONNECT_CODES.has(error.code) || refusals.has(error)) throw error;
      return attempt(true);
    }
  };
}
const refusals = new WeakSet<AgentAccessError>();
function requestedDocument(input: unknown): unknown {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>).documentId : undefined;
}
function documentChanged(documentId: string): AgentAccessError {
  const error = new AgentAccessError('SESSION_CHANGED', `The user opened another document (${documentId}). Nothing was changed. Read it again and decide whether the change still applies; its revisions start anew.`);
  refusals.add(error);
  return error;
}
