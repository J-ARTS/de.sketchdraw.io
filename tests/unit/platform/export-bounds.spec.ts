import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { DocumentPersistenceService } from '../../../electron/persistence';
import { createBrowserDesktopBridge } from '../../../src/platform/browser-bridge';

it('exports adapters with a separate byte budget while preserving the native document bound', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-export-bounds-'));
  try {
    const destination = path.join(directory, 'drawing.svg');
    const service = new DocumentPersistenceService({ maxDocumentBytes: 8, maxExportBytes: 64, dialogs: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: false, filePath: destination }) } });
    const contents = '<svg>ä</svg>';
    expect(await service.exportFile({ contents, suggestedName: 'drawing', format: 'svg' })).toMatchObject({ status: 'exported' });
    expect(await readFile(destination, 'utf8')).toBe(contents);
    expect(await service.exportFile({ contents, suggestedName: 'drawing', format: 'sketchdraw' })).toMatchObject({ status: 'error', code: 'EXPORT_TOO_LARGE' });
    expect(await service.exportFile({ contents: 'ä'.repeat(33), suggestedName: 'drawing', format: 'drawio' })).toMatchObject({ status: 'error', code: 'EXPORT_TOO_LARGE' });
    expect(await readFile(destination, 'utf8')).toBe(contents);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
it('uses the same independent adapter/native budgets for browser downloads', async () => {
  let downloads = 0;
  const bridge = createBrowserDesktopBridge({ maxDocumentBytes: 8, maxExportBytes: 64, dom: {
    createDownloadAnchor: () => ({ href: '', download: '', rel: '', style: { display: '' }, click: () => { downloads++; }, remove: () => {} }),
    createObjectUrl: () => 'blob:fixture', revokeObjectUrl: () => {}, scheduleRevoke: () => {},
  } });
  expect(await bridge.exportFile('<svg>ä</svg>', 'drawing', 'svg')).toMatchObject({ status: 'download-initiated' });
  expect(await bridge.exportFile('<svg>ä</svg>', 'drawing', 'sketchdraw')).toMatchObject({ status: 'error', code: 'EXPORT_TOO_LARGE' });
  expect(await bridge.exportFile('ä'.repeat(33), 'drawing', 'drawio')).toMatchObject({ status: 'error', code: 'EXPORT_TOO_LARGE' });
  expect(downloads).toBe(1);
});
