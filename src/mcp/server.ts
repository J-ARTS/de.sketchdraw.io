import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { mcpOperationSchemas, operations, parseMcpOperationInput } from '../agent-access/schema';
import { AGENT_ACCESS_LIMITS as L, AGENT_WRITE_OPERATIONS } from '../agent-access/types';
import { mapDomainErrorToPayload } from '../agent-access/errors';
import { AgentClient, connectAgent, loadAgentClientConfig } from './client';
import { SERVER_INSTRUCTIONS, TOOL_DESCRIPTIONS } from './guide';
import { createLimiter, createRequester, toolFailure, toolSuccess } from './tooling';

/** Replaced with the app version by scripts/build-mcp.mjs. */
declare const __SKETCHDRAW_VERSION__: string | undefined;
const VERSION = typeof __SKETCHDRAW_VERSION__ === 'string' ? __SKETCHDRAW_VERSION__ : '0.0.0';
/** Calls waiting for one of the two request slots of the app connection. */
const MAX_WAITING_CALLS = 64;

async function main(): Promise<void> {
  // Discovery can run before the desktop app opens a document; tool calls remain fail-closed.
  let connection: Promise<AgentClient> | undefined;
  let closed = false;
  const getClient = (preferRuntime = false) => {
    if (preferRuntime && connection) {
      void connection.then(client => client.close()).catch(() => {});
      connection = undefined;
    }
    if (!connection) {
      const attempt = loadAgentClientConfig(process.env, preferRuntime).then(connectAgent);
      connection = attempt;
      void attempt.catch(() => { if (connection === attempt) connection = undefined; });
    }
    return connection;
  };
  const limit = createLimiter(L.MAX_CLIENT_CONCURRENT_REQUESTS, MAX_WAITING_CALLS);
  const send = createRequester({
    connect: fresh => getClient(fresh),
    send: (client: AgentClient, operation, input) => client.request(operation, parseMcpOperationInput(operation, input, client.documentId)),
  });
  const request = (operation: (typeof operations)[number], input: unknown) => limit(() => send(operation, input));
  const transport = new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: L.POST_AUTH_FRAME_BYTES });
  const handle = serveStdio(() => {
    const server = new McpServer({ name: 'sketchdraw', version: VERSION }, { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS });
    for (const operation of operations) {
      server.registerTool(operation, {
        description: TOOL_DESCRIPTIONS[operation],
        inputSchema: mcpOperationSchemas[operation],
        annotations: { readOnlyHint: !AGENT_WRITE_OPERATIONS.has(operation), destructiveHint: AGENT_WRITE_OPERATIONS.has(operation), idempotentHint: true, openWorldHint: false },
      }, async (input: unknown) => {
        try { return toolSuccess(operation, await request(operation, input)); }
        catch (error) { return toolFailure(mapDomainErrorToPayload(error)); }
      });
    }
    return server;
  }, { transport, maxSubscriptions: 0, onerror: () => { /* SDK writes protocol errors; no secrets on stderr. */ } });
  const close = () => {
    if (closed) return; closed = true;
    void connection?.then(client => client.close()).catch(() => {});
    void handle.close();
  };
  process.stdin.once('end', close);
  process.stdin.once('close', close);
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
}
void main().catch(() => { process.stderr.write('Sketchdraw MCP could not start.\n'); process.exitCode = 1; });
