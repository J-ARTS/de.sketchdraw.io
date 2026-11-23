import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

/** Test-only, loopback-only HTTP fixture. No application service or IPC is replaced. */
export const syntheticSite = 'https://confluence-native.example.invalid';
export const syntheticEmail = 'native-test@example.invalid';
export const syntheticToken = 'not-a-real-token-native-210';
export const remotePageId = '210001';
export const foreignStorage = '<p>Foreign <strong>content</strong> with <a href="https://example.invalid/reference">a link</a>.</p><table><tbody><tr><td>Keep me</td></tr></tbody></table>';
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

type Attachment = { id: string; name: string; version: number; comment: string; bytes: Buffer };
export type UploadEvidence = { id: string; name: string; version: number; sha256: string; bytes: number; width: number; height: number; path: string; method: string };
export type RequestEvidence = { path: string; method: string };
export type ReadGate = { entered: Promise<void>; release(): void };

export async function startConfluenceFixture(options: { v2Comments?: boolean } = {}) {
  const attachments = new Map<string, Attachment>();
  const uploads: UploadEvidence[] = [];
  const requests: RequestEvidence[] = [];
  const bodyWrites: string[] = [];
  const failures: string[] = [];
  let pageBody = foreignStorage;
  let pageVersion = 1;
  let nextId = 1;
  let pendingGate: { entered(): void; waiting: Promise<void> } | undefined;
  const gates: Array<() => void> = [];
  const pageJson = () => ({ id: remotePageId, status: 'current', subtype: 'live', title: 'Native Architektur', version: { number: pageVersion }, body: { storage: { value: pageBody, representation: 'storage' } }, _links: { webui: `/pages/${remotePageId}` } });
  const attachmentJson = (a: Attachment) => ({ id: a.id, pageId: remotePageId, status: 'current', title: a.name, mediaType: 'image/png', fileSize: a.bytes.length, ...(options.v2Comments === false ? {} : { comment: a.comment }), version: { number: a.version, ...(options.v2Comments === false ? {} : { message: a.comment }) }, _links: { download: `/fixture/download/${a.id}` } });
  // V1 fallback describes the same stored attachment/version, not an independently invented confirmation.
  const attachmentV1Json = (a: Attachment) => ({ id: a.id, type: 'attachment', status: 'current', title: a.name, container: { id: remotePageId, type: 'page' }, version: { number: a.version, message: a.comment, minorEdit: true }, metadata: { comment: a.comment }, extensions: { comment: a.comment, mediaType: 'image/png', fileSize: a.bytes.length }, _links: { download: `/fixture/download/${a.id}` } });
  const json = (response: ServerResponse, value: unknown, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
  const bytes = async (request: IncomingMessage) => {
    const chunks: Buffer[] = []; let length = 0;
    for await (const chunk of request) { const part = Buffer.from(chunk); length += part.length; if (length > 12 * 1024 * 1024) throw new Error('Fixture request exceeds its bounded upload size.'); chunks.push(part); }
    return Buffer.concat(chunks);
  };
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const pathname = url.pathname; const method = request.method ?? 'GET';
      requests.push({ path: pathname, method }); // Never record authorization headers.
      const expected = `Basic ${Buffer.from(`${syntheticEmail}:${syntheticToken}`).toString('base64')}`;
      if (request.headers.authorization !== expected) throw new Error('Synthetic account was not used.');
      if (method === 'GET' && pathname === '/rest/api/3/myself') return json(response, { accountId: 'synthetic-account' });
      if (pathname === '/rest/api/3/search/jql') return json(response, { issues: [], isLast: true });
      if (method === 'GET' && pathname === '/wiki/api/v2/spaces') return json(response, { results: [{ id: '210-space', key: 'NATIVE' }] });
      // The title search of the site answers with nothing here; the service then lists the pages, as this fixture always did.
      if (method === 'GET' && pathname === '/wiki/rest/api/content/search') return json(response, { results: [] });
      if (method === 'GET' && pathname === '/wiki/api/v2/pages') return json(response, { results: [pageJson()] });
      if (method === 'GET' && pathname === `/wiki/api/v2/pages/${remotePageId}`) return json(response, pageJson());
      if (method === 'GET' && pathname === `/wiki/api/v2/pages/${remotePageId}/attachments`) {
        const gate = pendingGate; pendingGate = undefined;
        if (gate) { gate.entered(); await gate.waiting; }
        const wanted = url.searchParams.get('filename');
        return json(response, { results: [...attachments.values()].filter(a => !wanted || a.name === wanted).map(attachmentJson) });
      }
      if (method === 'GET' && pathname.startsWith('/wiki/api/v2/attachments/')) {
        const found = attachments.get(pathname.slice('/wiki/api/v2/attachments/'.length));
        return json(response, found ? attachmentJson(found) : {}, found ? 200 : 404);
      }
      if (method === 'GET' && pathname.startsWith('/fixture/download/')) {
        const found = attachments.get(pathname.slice('/fixture/download/'.length));
        if (!found) return json(response, {}, 404);
        response.writeHead(200, { 'Content-Type': 'image/png' }); response.end(found.bytes); return;
      }
      if (method === 'PUT' && pathname === `/wiki/api/v2/pages/${remotePageId}`) {
        const input = JSON.parse((await bytes(request)).toString('utf8')) as { id: string; status: string; title: string; version: { number: number }; body: { representation: string; value: string } };
        if (input.version.number !== pageVersion + 1) return json(response, { error: 'version conflict' }, 409);
        if (input.id !== remotePageId || input.status !== 'current' || input.body.representation !== 'storage') throw new Error('Unexpected page update contract.');
        if (!input.body.value.startsWith(foreignStorage)) throw new Error('Foreign storage body was not preserved.');
        pageBody = input.body.value; pageVersion = input.version.number; bodyWrites.push(pageBody);
        return json(response, pageJson());
      }
      const collectionPath = `/wiki/rest/api/content/${remotePageId}/child/attachment`;
      if (method === 'GET' && pathname === collectionPath) {
        const filename = url.searchParams.get('filename');
        if (!filename || !url.searchParams.get('expand')?.split(',').includes('version')) throw new Error('V1 metadata fallback needs filename and expanded version.');
        const results = [...attachments.values()].filter(a => a.name === filename).map(attachmentV1Json);
        return json(response, { results, start: 0, limit: 25, size: results.length });
      }
      const dataPath = new RegExp(`^${collectionPath}/([^/]+)/data$`).exec(pathname);
      if (((method === 'POST' || method === 'PUT') && pathname === collectionPath) || (method === 'POST' && dataPath)) {
        if (request.headers['x-atlassian-token'] !== 'nocheck') throw new Error('Missing upload CSRF header.');
        const contentType = request.headers['content-type'];
        if (!contentType?.startsWith('multipart/form-data; boundary=')) throw new Error('Multipart boundary was lost.');
        const raw = await bytes(request);
        const form = await new Request('http://127.0.0.1/upload', { method: 'POST', headers: { 'content-type': contentType }, body: new Uint8Array(raw) }).formData();
        const file = form.get('file');
        if (!file || typeof file === 'string' || file.type !== 'image/png' || form.get('minorEdit') !== 'true') throw new Error('Upload is not a PNG minor edit.');
        const png = Buffer.from(await file.arrayBuffer());
        if (png.length < 33 || !png.subarray(0, 8).equals(signature) || png.toString('ascii', 12, 16) !== 'IHDR') throw new Error('PNG signature/IHDR did not survive real IPC and multipart.');
        const byName = [...attachments.values()].find(a => a.name === file.name);
        const previous = dataPath ? attachments.get(decodeURIComponent(dataPath[1]!)) : byName;
        if (dataPath && !previous) return json(response, {}, 404);
        if (previous && previous.name !== file.name) throw new Error('Attachment ID does not match the uploaded name.');
        // POST collection creates; PUT collection is Confluence's documented create-or-update operation.
        if (method === 'POST' && !dataPath && byName) return json(response, { error: 'attachment already exists' }, 400);
        const item: Attachment = { id: previous?.id ?? `att${211000 + nextId++}`, name: file.name, version: (previous?.version ?? 0) + 1, comment: String(form.get('comment') ?? ''), bytes: png };
        attachments.set(item.id, item);
        uploads.push({ id: item.id, name: item.name, version: item.version, sha256: digest(png), bytes: png.length, width: png.readUInt32BE(16), height: png.readUInt32BE(20), path: pathname, method });
        return json(response, dataPath ? attachmentV1Json(item) : { results: [attachmentV1Json(item)] });
      }
      throw new Error(`Unhandled synthetic endpoint: ${method} ${pathname}`);
    })().catch(error => { failures.push(error instanceof Error ? error.message : String(error)); if (!response.headersSent) json(response, { error: 'fixture rejected request' }, 500); else response.end(); });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture did not bind to loopback TCP.');
  return {
    origin: `http://127.0.0.1:${address.port}`, uploads, requests, bodyWrites, failures,
    get body() { return pageBody; },
    png(id: string) { const attachment = attachments.get(id); if (!attachment) throw new Error('Missing attachment'); return attachment.bytes; },
    holdNextAttachmentRead(): ReadGate {
      if (pendingGate) throw new Error('An attachment read is already held.');
      let entered!: () => void; let release!: () => void;
      const entry = new Promise<void>(resolve => { entered = resolve; });
      const waiting = new Promise<void>(resolve => { release = resolve; });
      pendingGate = { entered, waiting }; gates.push(release);
      return { entered: entry, release };
    },
    async close() { for (const release of gates) release(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
  };
}

/** Main-process bootstrap only; called before the copied real main.cjs is loaded. */
export function isolatedEntrySource(origin: string): string {
  return `
const {app,ipcMain,net,safeStorage,nativeImage}=require('electron');
const path=require('node:path');
const {createHash}=require('node:crypto');
const expectedRuntime=path.resolve(__dirname,'agent-runtime','active-v1.json');
if(process.env.SKETCHDRAW_MCP_RUNTIME_FILE!==expectedRuntime)throw Error('Native test requires its own absolute MCP runtime path');
app.setPath('userData',path.join(__dirname,'profile'));
app.setPath('sessionData',path.join(__dirname,'session'));
const control=globalThis.__nativeConfluenceProbe={published:[],afterSaves:{started:0,completed:0,rejected:0},actions:[],blockedFetches:[]};
// This synthetic codec never reads/writes the OS keychain and exists only in the owned test process.
safeStorage.isEncryptionAvailable=()=>true;
safeStorage.encryptString=value=>Buffer.from('synthetic-only:'+value,'utf8');
safeStorage.decryptString=value=>{const text=Buffer.from(value).toString('utf8');if(!text.startsWith('synthetic-only:'))throw Error('Refusing non-test credential');return text.slice(15);};
const fetchOriginal=globalThis.fetch.bind(globalThis);
globalThis.fetch=(input,init)=>{
  const source=new URL(input instanceof Request?input.url:String(input));
  if(source.origin!==${JSON.stringify(syntheticSite)}){control.blockedFetches.push(source.origin);throw Error('Test forbids non-fixture main fetch');}
  const target=${JSON.stringify(origin)}+source.pathname+source.search;
  return fetchOriginal(target,input instanceof Request?new Request(input,init):init);
};
// The plugin service reaches its sites through Electron's network stack; here that way leads to the same guard.
net.fetch=(input,init)=>globalThis.fetch(input,init);
// Observe the real IPC boundary; invoke the unmodified handler, including its sender/security validation.
const register=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,handler)=>register(channel,async(event,...args)=>{
  if(channel!=='sketchdraw:plugins:invoke')return handler(event,...args);
  const raw=args[0];control.actions.push(raw&&raw.action);
  const afterSave=raw&&raw.action==='after-document-saved';
  if(afterSave)control.afterSaves.started++;
  let observation;
  if(raw&&raw.action==='publish-confluence-live'){
    observation={images:(raw.payload.images||[]).map(image=>({pageId:image.pageId,pngSha256:createHash('sha256').update(image.png).digest('hex'),uint8Array:image.png instanceof Uint8Array,bytes:image.png.byteLength,decoded:nativeImage.createFromBuffer(Buffer.from(image.png)).getSize()})),done:false};
    control.published.push(observation);
  }
  try{const result=await handler(event,...args);if(observation){observation.done=true;observation.status=result&&result.status;}return result;}
  catch(error){if(observation){observation.done=true;observation.rejected=true;}if(afterSave)control.afterSaves.rejected++;throw error;}
  finally{if(afterSave)control.afterSaves.completed++;}
});
require('./dist-electron/main.cjs');
`;
}
