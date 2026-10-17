import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDocument, serializeDocument } from '../../src/domain/index';
import {
  DocumentPersistenceService,
  type PersistenceFsAdapter,
} from '../../electron/persistence';
import { createBrowserDesktopBridge, type BrowserFileInputLike } from '../../src/platform/browser-bridge';

const directories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sketchdraw-desktop-review-'));
  directories.push(directory);
  return directory;
}

const serialize = (title: string) => serializeDocument({ ...createDocument(title), id: 'review-document' });

function dialogsFor(filePath: string) {
  return {
    showOpenDialog: async () => ({ canceled: false, filePaths: [filePath] }),
    showSaveDialog: async () => ({ canceled: false, filePath }),
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('Independent desktop persistence review', () => {
  it('preserves external edits during ordinary handle-based save as a control case', async () => {
    const directory = await temporaryDirectory();
    const target = path.join(directory, 'document.sketchdraw');
    await fs.writeFile(target, serialize('original'));
    const external = serialize('new external work');
    const persistence = new DocumentPersistenceService({
      dialogs: dialogsFor(target),
      onBeforePreRenameCheck: async () => { await fs.writeFile(target, external); },
    });
    const opened = await persistence.openDocument();
    if (opened.status !== 'opened') throw new Error('open failed');
    const result = await persistence.saveDocument({
      mode: 'save', text: serialize('local work'), suggestedName: 'document.sketchdraw',
      handleId: opened.file.handleId, expectedVersionToken: opened.file.versionToken,
    });
    expect(result.status).toBe('conflict');
    expect(await fs.readFile(target, 'utf8')).toBe(external);
    expect(await fs.readdir(directory)).toEqual(['document.sketchdraw']);
  });
  it('preserves an externally updated save-as target after the overwrite dialog has returned', async () => {
    const directory = await temporaryDirectory();
    const target = path.join(directory, 'document.sketchdraw');
    await fs.writeFile(target, serialize('dialog-selected version'));
    const external = serialize('new external work');
    const persistence = new DocumentPersistenceService({
      dialogs: dialogsFor(target),
      onBeforePreRenameCheck: async () => { await fs.writeFile(target, external); },
    });

    const result = await persistence.saveDocument({
      mode: 'save-as',
      text: serialize('local work'),
      suggestedName: 'document.sketchdraw',
    });

    expect(await fs.readFile(target, 'utf8')).toBe(external);
    expect(result.status).toBe('conflict');
  });

  it('preserves a file created externally while a new export is being prepared', async () => {
    const directory = await temporaryDirectory();
    const target = path.join(directory, 'diagram.svg');
    const external = '<svg><title>new external work</title></svg>';
    const persistence = new DocumentPersistenceService({
      dialogs: dialogsFor(target),
      onBeforePreRenameCheck: async () => { await fs.writeFile(target, external); },
    });

    const result = await persistence.exportFile({
      contents: '<svg><title>local work</title></svg>',
      suggestedName: 'diagram.svg',
      format: 'svg',
    });

    expect(await fs.readFile(target, 'utf8')).toBe(external);
    expect(result).toMatchObject({ status: 'error', code: 'EXPORT_CONFLICT' });
  });

  it.skipIf(process.platform === 'win32')('serializes saves to the same real file through directory aliases', async () => {
    const directory = await temporaryDirectory();
    const originalDirectory = path.join(directory, 'original');
    const aliasDirectory = path.join(directory, 'alias');
    await fs.mkdir(originalDirectory);
    await fs.symlink(originalDirectory, aliasDirectory, 'dir');
    const original = path.join(originalDirectory, 'document.sketchdraw');
    const alias = path.join(aliasDirectory, 'document.sketchdraw');
    await fs.writeFile(original, serialize('original work'));
    let selected = original;
    let renameCount = 0;
    let release!: () => void;
    const bothRenamesReached = new Promise<void>((resolve) => { release = resolve; });
    const fsAdapter: PersistenceFsAdapter = {
      stat: (filePath) => fs.stat(filePath),
      readFile: (filePath) => fs.readFile(filePath),
      open: (filePath, flags, mode) => fs.open(filePath, flags, mode),
      unlink: (filePath) => fs.unlink(filePath),
      rename: async (source, target) => {
        renameCount++;
        if (renameCount === 2) release();
        // A correct shared lock permits only one rename; avoid deadlocking that implementation.
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            bothRenamesReached,
            new Promise<void>((resolve) => { timer = setTimeout(resolve, 50); }),
          ]);
        } finally {
          clearTimeout(timer);
        }
        await fs.rename(source, target);
      },
    };
    const persistence = new DocumentPersistenceService({
      fsAdapter,
      dialogs: {
        ...dialogsFor(original),
        showOpenDialog: async () => ({ canceled: false, filePaths: [selected] }),
      },
    });
    const first = await persistence.openDocument();
    selected = alias;
    const second = await persistence.openDocument();
    expect(first.status).toBe('opened');
    expect(second.status).toBe('opened');
    if (first.status !== 'opened' || second.status !== 'opened') throw new Error('open failed');

    const results = await Promise.all([first, second].map((opened, index) => persistence.saveDocument({
      mode: 'save',
      text: serialize(`writer ${index}`),
      suggestedName: 'document.sketchdraw',
      handleId: opened.file.handleId,
      expectedVersionToken: opened.file.versionToken,
    })));

    expect(results.filter((result) => result.status === 'saved')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'conflict')).toHaveLength(1);
  });

  it.skipIf(process.platform === 'win32')('a successful save through a selected file symlink updates its real target without replacing the link', async () => {
    const directory = await temporaryDirectory();
    const original = path.join(directory, 'original.sketchdraw');
    const alias = path.join(directory, 'alias.sketchdraw');
    await fs.writeFile(original, serialize('original'));
    await fs.symlink(original, alias, 'file');
    const persistence = new DocumentPersistenceService({ dialogs: dialogsFor(alias) });
    const opened = await persistence.openDocument();
    expect(opened.status).toBe('opened');
    if (opened.status !== 'opened') throw new Error('open failed');
    const changed = serialize('modified');
    const saved = await persistence.saveDocument({
      mode: 'save', text: changed, suggestedName: 'alias.sketchdraw',
      handleId: opened.file.handleId, expectedVersionToken: opened.file.versionToken,
    });
    expect(saved.status).toBe('saved');
    expect(await fs.readFile(original, 'utf8')).toBe(changed);
    expect((await fs.lstat(alias)).isSymbolicLink()).toBe(true);
  });
});

describe('Independent browser adapter review', () => {
  it('returns cancellation and cleans up the browser file input', async () => {
    const listeners = new Map<string, () => void>();
    let removed = false;
    const input: BrowserFileInputLike = {
      type: 'file', accept: '', style: { display: 'none' }, files: null,
      addEventListener: (type, callback) => { listeners.set(type, callback); },
      removeEventListener: (type) => { listeners.delete(type); },
      click: () => { listeners.get('cancel')?.(); },
      remove: () => { removed = true; },
    };
    const bridge = createBrowserDesktopBridge({ dom: { createFileInput: () => input } });
    await expect(bridge.openDocument()).resolves.toEqual({ status: 'cancelled' });
    expect(removed).toBe(true);
    expect(listeners.size).toBe(0);
  });

  it('reports a failed export and revokes its object URL when download initiation throws', async () => {
    const revoked: string[] = [];
    let removed = false;
    const bridge = createBrowserDesktopBridge({ dom: {
      createObjectUrl: () => 'blob:review-download',
      revokeObjectUrl: (url) => { revoked.push(url); },
      createDownloadAnchor: () => ({
        href: '', download: '', rel: '', style: { display: 'none' },
        click: () => { throw new Error('download failed'); },
        remove: () => { removed = true; },
      }),
    } });
    await expect(bridge.exportFile('<svg/>', 'diagram', 'svg')).resolves.toMatchObject({ status: 'error', code: 'DOWNLOAD_FAILED' });
    expect(revoked).toEqual(['blob:review-download']);
    expect(removed).toBe(true);
  });
});
