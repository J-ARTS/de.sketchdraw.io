import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { validateExportFileRequest } from '../../../electron/ipc-contract';
import { DocumentPersistenceService, sanitizeSuggestedFileName } from '../../../electron/persistence';
import { createBrowserDesktopBridge, sanitizeDownloadFileName } from '../../../src/platform/browser-bridge';

const source = 'flowchart LR\n  a["Start"] --> b["Ziel"]\n';

it('accepts Mermaid at the IPC boundary and writes the selected file atomically with a .mmd suggestion', async () => {
  expect(validateExportFileRequest({ contents: source, suggestedName: 'Diagramm.mmd', format: 'mermaid' }).ok).toBe(true);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-mermaid-export-'));
  const destination = path.join(directory, 'actual.mmd');
  let request: unknown;
  try {
    const service = new DocumentPersistenceService({ dialogs: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showSaveDialog: async options => { request = options; return { canceled: false, filePath: destination }; },
    } });
    expect(await service.exportFile({ contents: source, suggestedName: '../Flow.MMD', format: 'mermaid' })).toEqual({ status: 'exported', name: 'actual.mmd' });
    expect(request).toMatchObject({ defaultPath: 'Flow.mmd', filters: [{ name: 'Mermaid Flowchart', extensions: ['mmd', 'mermaid'] }] });
    expect(await readFile(destination, 'utf8')).toBe(source);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('downloads Mermaid as plain text, preserves its bytes and retains export size limits', async () => {
  let blob: Blob | undefined; let clicked = 0;
  const anchor = { href: '', download: '', rel: '', style: { display: '' }, click: () => { clicked++; }, remove: () => {} };
  const bridge = createBrowserDesktopBridge({ maxExportBytes: 64, dom: {
    createDownloadAnchor: () => anchor,
    createObjectUrl: value => { blob = value; return 'blob:mermaid'; },
    revokeObjectUrl: () => {}, scheduleRevoke: () => {},
  } });
  expect(await bridge.exportFile(source, '../Diagramm.mmd', 'mermaid')).toMatchObject({ status: 'download-initiated', name: 'Diagramm.mmd' });
  expect(anchor.download).toBe('Diagramm.mmd');
  expect(blob?.type).toBe('text/plain;charset=utf-8');
  expect(await blob!.text()).toBe(source);
  expect(await bridge.exportFile('ä'.repeat(33), 'large', 'mermaid')).toMatchObject({ status: 'error', code: 'EXPORT_TOO_LARGE' });
  expect(clicked).toBe(1);
  expect(sanitizeDownloadFileName('flow', 'mermaid')).toBe('flow.mmd');
  expect(sanitizeSuggestedFileName('flow', 'mermaid')).toBe('flow.mmd');
});
