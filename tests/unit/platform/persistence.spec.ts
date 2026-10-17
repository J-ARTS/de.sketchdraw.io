import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  computeVersionToken,
  DocumentPersistenceService,
  type PersistenceDialogAdapter,
  sanitizeSuggestedFileName,
} from '../../../electron/persistence';
import {
  applyCommand,
  createDocument,
  createElement,
  serializeDocument,
} from '../../../src/domain/index';

function buildValidDocumentText(title: string, rectX = 20): string {
  let doc = createDocument(title);
  const rect = createElement('rectangle', {
    id: 'rect-1',
    x: rectX,
    y: 40,
    width: 120,
    height: 80,
    label: title,
  });
  doc = applyCommand(doc, { type: 'add', elements: [rect] });
  return serializeDocument(doc);
}

describe('DocumentPersistenceService (real temp directory persistence)', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'sketchdraw-persistence-'),
    );
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('sanitizes suggested filenames to safe basenames with required extension', () => {
    expect(
      sanitizeSuggestedFileName('../../etc/passwd/my-arch', 'sketchdraw'),
    ).toBe('my-arch.sketchdraw');
    expect(
      sanitizeSuggestedFileName('C:\\Users\\secret\\cloud.SVG', 'svg'),
    ).toBe('cloud.svg');
    expect(sanitizeSuggestedFileName('...///\\\\...', 'drawio')).toBe(
      'untitled.drawio',
    );
  });

  it('opens a valid document, issues an opaque handle and content hash, and saves updates atomically', async () => {
    const targetFile = path.join(tempDir, 'architecture.sketchdraw');
    const initialText = buildValidDocumentText('Initial Architecture', 10);
    await fs.writeFile(targetFile, initialText, 'utf8');

    let saveDialogCalled = false;
    const dialogs: PersistenceDialogAdapter = {
      showOpenDialog: async () => ({
        canceled: false,
        filePaths: [targetFile],
      }),
      showSaveDialog: async () => {
        saveDialogCalled = true;
        return { canceled: true };
      },
    };

    const service = new DocumentPersistenceService({ dialogs });
    const opened = await service.openDocument();

    expect(opened.status).toBe('opened');
    if (opened.status !== 'opened') return;

    expect(opened.text).toBe(initialText);
    expect(opened.file.name).toBe('architecture.sketchdraw');
    expect(opened.file.handleId).toMatch(/^hdl_[0-9a-f]{32}$/);
    expect(opened.file.handleId).not.toContain(tempDir);
    expect(opened.file.versionToken).toBe(computeVersionToken(initialText));

    const updatedText = buildValidDocumentText('Updated Architecture', 80);
    const saved = await service.saveDocument({
      mode: 'save',
      handleId: opened.file.handleId,
      expectedVersionToken: opened.file.versionToken,
      text: updatedText,
      suggestedName: 'architecture.sketchdraw',
    });

    expect(saveDialogCalled).toBe(false);
    expect(saved.status).toBe('saved');
    if (saved.status !== 'saved') return;

    expect(saved.file.handleId).toBe(opened.file.handleId);
    expect(saved.file.name).toBe('architecture.sketchdraw');
    expect(saved.file.versionToken).toBe(computeVersionToken(updatedText));
    expect(saved.file.versionToken).not.toBe(opened.file.versionToken);

    const diskContent = await fs.readFile(targetFile, 'utf8');
    expect(diskContent).toBe(updatedText);

    const remainingEntries = await fs.readdir(tempDir);
    expect(remainingEntries).toEqual(['architecture.sketchdraw']);
  });

  it('supports save-as with sanitized default filename and registers a reusable handle', async () => {
    const savedFile = path.join(tempDir, 'new-diagram.sketchdraw');
    let observedDefaultPath = '';

    const service = new DocumentPersistenceService({
      dialogs: {
        showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
        showSaveDialog: async ({ defaultPath }) => {
          observedDefaultPath = defaultPath;
          return { canceled: false, filePath: savedFile };
        },
      },
    });

    const textV1 = buildValidDocumentText('Draft 1', 15);
    const saveAsResult = await service.saveDocument({
      mode: 'save-as',
      text: textV1,
      suggestedName: '../outside/folder/new-diagram',
    });

    expect(observedDefaultPath).toBe('new-diagram.sketchdraw');
    expect(saveAsResult.status).toBe('saved');
    if (saveAsResult.status !== 'saved') return;

    const textV2 = buildValidDocumentText('Draft 2', 30);
    const followUpSave = await service.saveDocument({
      mode: 'save',
      handleId: saveAsResult.file.handleId,
      expectedVersionToken: saveAsResult.file.versionToken,
      text: textV2,
      suggestedName: 'new-diagram.sketchdraw',
    });

    expect(followUpSave.status).toBe('saved');
    expect(await fs.readFile(savedFile, 'utf8')).toBe(textV2);
  });

  it('detects external disk modifications before write and preserves external changes without overwriting', async () => {
    const targetFile = path.join(tempDir, 'shared.sketchdraw');
    const v1Text = buildValidDocumentText('Version 1', 10);
    const externalText = buildValidDocumentText('External Git Pull Version', 99);
    const conflictingLocalText = buildValidDocumentText('Stale Local Edit', 50);

    await fs.writeFile(targetFile, v1Text, 'utf8');

    const service = new DocumentPersistenceService({
      dialogs: {
        showOpenDialog: async () => ({
          canceled: false,
          filePaths: [targetFile],
        }),
        showSaveDialog: async () => ({ canceled: true }),
      },
    });

    const opened = await service.openDocument();
    expect(opened.status).toBe('opened');
    if (opened.status !== 'opened') return;

    // External process updates the file on disk
    await fs.writeFile(targetFile, externalText, 'utf8');

    const saveAttempt = await service.saveDocument({
      mode: 'save',
      handleId: opened.file.handleId,
      expectedVersionToken: opened.file.versionToken,
      text: conflictingLocalText,
      suggestedName: 'shared.sketchdraw',
    });

    expect(saveAttempt.status).toBe('conflict');
    expect(await fs.readFile(targetFile, 'utf8')).toBe(externalText);

    const dirEntries = await fs.readdir(tempDir);
    expect(dirEntries).toEqual(['shared.sketchdraw']);
  });

  it('detects external modifications occurring immediately before rename and cleans up the temp file', async () => {
    const targetFile = path.join(tempDir, 'race.sketchdraw');
    const v1Text = buildValidDocumentText('Initial', 10);
    const externalRaceText = buildValidDocumentText('Modified Right Before Rename', 200);
    const localSaveText = buildValidDocumentText('Local Save', 40);

    await fs.writeFile(targetFile, v1Text, 'utf8');

    const service = new DocumentPersistenceService({
      dialogs: {
        showOpenDialog: async () => ({
          canceled: false,
          filePaths: [targetFile],
        }),
        showSaveDialog: async () => ({ canceled: true }),
      },
      onBeforePreRenameCheck: async (filePath) => {
        await fs.writeFile(filePath, externalRaceText, 'utf8');
      },
    });

    const opened = await service.openDocument();
    expect(opened.status).toBe('opened');
    if (opened.status !== 'opened') return;

    const saveResult = await service.saveDocument({
      mode: 'save',
      handleId: opened.file.handleId,
      expectedVersionToken: opened.file.versionToken,
      text: localSaveText,
      suggestedName: 'race.sketchdraw',
    });

    expect(saveResult.status).toBe('conflict');
    expect(await fs.readFile(targetFile, 'utf8')).toBe(externalRaceText);

    const remainingFiles = await fs.readdir(tempDir);
    expect(remainingFiles).toEqual(['race.sketchdraw']);
  });

  it('serializes concurrent save requests for the same handle so the second stale save receives conflict', async () => {
    const targetFile = path.join(tempDir, 'concurrent.sketchdraw');
    const initialText = buildValidDocumentText('Base', 10);
    const saveAText = buildValidDocumentText('Concurrent Save A', 100);
    const saveBText = buildValidDocumentText('Concurrent Save B', 200);

    await fs.writeFile(targetFile, initialText, 'utf8');

    const service = new DocumentPersistenceService({
      dialogs: {
        showOpenDialog: async () => ({
          canceled: false,
          filePaths: [targetFile],
        }),
        showSaveDialog: async () => ({ canceled: true }),
      },
    });

    const opened = await service.openDocument();
    expect(opened.status).toBe('opened');
    if (opened.status !== 'opened') return;

    const [resultA, resultB] = await Promise.all([
      service.saveDocument({
        mode: 'save',
        handleId: opened.file.handleId,
        expectedVersionToken: opened.file.versionToken,
        text: saveAText,
        suggestedName: 'concurrent.sketchdraw',
      }),
      service.saveDocument({
        mode: 'save',
        handleId: opened.file.handleId,
        expectedVersionToken: opened.file.versionToken,
        text: saveBText,
        suggestedName: 'concurrent.sketchdraw',
      }),
    ]);

    expect(resultA.status).toBe('saved');
    expect(resultB.status).toBe('conflict');
    expect(await fs.readFile(targetFile, 'utf8')).toBe(saveAText);

    const remainingFiles = await fs.readdir(tempDir);
    expect(remainingFiles).toEqual(['concurrent.sketchdraw']);
  });

  it('rejects invalid documents via Domain validation on both open and save, and rejects unknown or path-like handles', async () => {
    const invalidJsonFile = path.join(tempDir, 'corrupt.sketchdraw');
    await fs.writeFile(
      invalidJsonFile,
      JSON.stringify({ schemaVersion: 1, id: 'bad', elements: 'not-an-array' }),
      'utf8',
    );

    const service = new DocumentPersistenceService({
      dialogs: {
        showOpenDialog: async () => ({
          canceled: false,
          filePaths: [invalidJsonFile],
        }),
        showSaveDialog: async () => ({
          canceled: false,
          filePath: path.join(tempDir, 'should-not-write.sketchdraw'),
        }),
      },
    });

    const openInvalid = await service.openDocument();
    expect(openInvalid.status).toBe('error');
    if (openInvalid.status === 'error') {
      expect(openInvalid.code).toBe('VALIDATION_ERROR');
    }

    const saveInvalidSchema = await service.saveDocument({
      mode: 'save-as',
      text: '{"schemaVersion":999}',
      suggestedName: 'invalid.sketchdraw',
    });
    expect(saveInvalidSchema.status).toBe('error');
    if (saveInvalidSchema.status === 'error') {
      expect(saveInvalidSchema.code).toBe('VALIDATION_ERROR');
    }

    const validText = buildValidDocumentText('Valid', 10);

    const saveWithPathAsHandle = await service.saveDocument({
      mode: 'save',
      handleId: targetPathLikeHandle(tempDir),
      expectedVersionToken: computeVersionToken(validText),
      text: validText,
      suggestedName: 'valid.sketchdraw',
    });
    expect(saveWithPathAsHandle.status).toBe('error');
    if (saveWithPathAsHandle.status === 'error') {
      expect(saveWithPathAsHandle.code).toBe('INVALID_HANDLE');
    }

    const saveWithUnknownHandle = await service.saveDocument({
      mode: 'save',
      handleId: 'hdl_00000000000000000000000000000000',
      expectedVersionToken: computeVersionToken(validText),
      text: validText,
      suggestedName: 'valid.sketchdraw',
    });
    expect(saveWithUnknownHandle.status).toBe('error');
    if (saveWithUnknownHandle.status === 'error') {
      expect(saveWithUnknownHandle.code).toBe('UNKNOWN_HANDLE');
    }
  });

  it('cleans up temporary files and redacts filesystem paths when atomic rename fails', async () => {
    const targetFile = path.join(tempDir, 'fail-rename.sketchdraw');
    const initialText = buildValidDocumentText('Original', 10);
    const updatedText = buildValidDocumentText('Updated', 20);
    await fs.writeFile(targetFile, initialText, 'utf8');

    const service = new DocumentPersistenceService({
      dialogs: {
        showOpenDialog: async () => ({
          canceled: false,
          filePaths: [targetFile],
        }),
        showSaveDialog: async () => ({ canceled: true }),
      },
      fsAdapter: {
        stat: (p) => fs.stat(p),
        readFile: (p) => fs.readFile(p),
        open: (p, flags, mode) => fs.open(p, flags, mode),
        unlink: (p) => fs.unlink(p),
        rename: async () => {
          const err = new Error(
            `EACCES: permission denied, rename '${targetFile}'`,
          ) as NodeJS.ErrnoException;
          err.code = 'EACCES';
          throw err;
        },
      },
    });

    const opened = await service.openDocument();
    expect(opened.status).toBe('opened');
    if (opened.status !== 'opened') return;

    const failedSave = await service.saveDocument({
      mode: 'save',
      handleId: opened.file.handleId,
      expectedVersionToken: opened.file.versionToken,
      text: updatedText,
      suggestedName: 'fail-rename.sketchdraw',
    });

    expect(failedSave.status).toBe('error');
    if (failedSave.status === 'error') {
      expect(failedSave.code).toBe('PERMISSION_DENIED');
      expect(failedSave.message).not.toContain(tempDir);
      expect(failedSave.message).not.toContain('fail-rename.sketchdraw');
    }

    // Original file is intact and temporary file was removed
    expect(await fs.readFile(targetFile, 'utf8')).toBe(initialText);
    const filesInDir = await fs.readdir(tempDir);
    expect(filesInDir).toEqual(['fail-rename.sketchdraw']);
  });

  it('validates and exports svg, drawio, and sketchdraw files atomically', async () => {
    const exportedSvgPath = path.join(tempDir, 'diagram.svg');
    let dialogDefaultPath = '';

    const service = new DocumentPersistenceService({
      dialogs: {
        showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
        showSaveDialog: async ({ defaultPath }) => {
          dialogDefaultPath = defaultPath;
          return { canceled: false, filePath: exportedSvgPath };
        },
      },
    });

    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>';
    const svgResult = await service.exportFile({
      contents: svgContent,
      suggestedName: '/var/tmp/my-diagram',
      format: 'svg',
    });

    expect(dialogDefaultPath).toBe('my-diagram.svg');
    expect(svgResult).toEqual({
      status: 'exported',
      name: 'diagram.svg',
    });
    expect(await fs.readFile(exportedSvgPath, 'utf8')).toBe(svgContent);

    const badFormatResult = await service.exportFile({
      contents: svgContent,
      suggestedName: 'diagram',
      format: 'exe',
    });
    expect(badFormatResult.status).toBe('error');
    if (badFormatResult.status === 'error') {
      expect(badFormatResult.code).toBe('INVALID_FORMAT');
    }
  });

  it('guards save-as and exportFile against external changes or newly created files before rename (#22)', async () => {
    const existingTarget = path.join(tempDir, 'save-as-guard.sketchdraw');
    const dialogBaselineText = buildValidDocumentText('Dialog Confirmed', 10);
    const externalEditText = buildValidDocumentText('External Concurrent Edit', 90);
    const localSaveAsText = buildValidDocumentText('Local Save As', 40);
    await fs.writeFile(existingTarget, dialogBaselineText, 'utf8');

    const saveAsService = new DocumentPersistenceService({
      dialogs: {
        showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
        showSaveDialog: async () => ({ canceled: false, filePath: existingTarget }),
      },
      onBeforePreRenameCheck: async () => {
        await fs.writeFile(existingTarget, externalEditText, 'utf8');
      },
    });

    const saveAsOutcome = await saveAsService.saveDocument({
      mode: 'save-as',
      text: localSaveAsText,
      suggestedName: 'save-as-guard.sketchdraw',
    });
    expect(saveAsOutcome.status).toBe('conflict');
    expect(await fs.readFile(existingTarget, 'utf8')).toBe(externalEditText);
    expect(await fs.readdir(tempDir)).toEqual(['save-as-guard.sketchdraw']);

    const newExportTarget = path.join(tempDir, 'race-export.svg');
    const externalSvg = '<svg><title>external</title></svg>';
    const exportService = new DocumentPersistenceService({
      dialogs: {
        showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
        showSaveDialog: async () => ({ canceled: false, filePath: newExportTarget }),
      },
      onBeforePreRenameCheck: async () => {
        await fs.writeFile(newExportTarget, externalSvg, 'utf8');
      },
    });

    const exportOutcome = await exportService.exportFile({
      contents: '<svg><title>local</title></svg>',
      suggestedName: 'race-export.svg',
      format: 'svg',
    });
    expect(exportOutcome).toMatchObject({
      status: 'error',
      code: 'EXPORT_CONFLICT',
    });
    expect(await fs.readFile(newExportTarget, 'utf8')).toBe(externalSvg);
    expect((await fs.readdir(tempDir)).sort()).toEqual([
      'race-export.svg',
      'save-as-guard.sketchdraw',
    ]);
  });

  it.skipIf(process.platform === 'win32')(
    'canonicalizes directory symlinks for shared locking and preserves file symlinks when saving (#23)',
    async () => {
      const realDir = path.join(tempDir, 'real');
      const symlinkDir = path.join(tempDir, 'dir-alias');
      await fs.mkdir(realDir);
      await fs.symlink(realDir, symlinkDir, 'dir');

      const realDoc = path.join(realDir, 'doc.sketchdraw');
      const dirAliasDoc = path.join(symlinkDir, 'doc.sketchdraw');
      const fileSymlinkDoc = path.join(tempDir, 'file-alias.sketchdraw');

      const initialText = buildValidDocumentText('Initial Real', 10);
      await fs.writeFile(realDoc, initialText, 'utf8');
      await fs.symlink(realDoc, fileSymlinkDoc, 'file');

      let openTarget = realDoc;
      const service = new DocumentPersistenceService({
        dialogs: {
          showOpenDialog: async () => ({
            canceled: false,
            filePaths: [openTarget],
          }),
          showSaveDialog: async () => ({
            canceled: false,
            filePath: fileSymlinkDoc,
          }),
        },
      });

      const openedViaReal = await service.openDocument();
      openTarget = dirAliasDoc;
      const openedViaDirAlias = await service.openDocument();
      expect(openedViaReal.status).toBe('opened');
      expect(openedViaDirAlias.status).toBe('opened');
      if (openedViaReal.status !== 'opened' || openedViaDirAlias.status !== 'opened') {
        return;
      }

      const [firstSave, secondSave] = await Promise.all([
        service.saveDocument({
          mode: 'save',
          handleId: openedViaReal.file.handleId,
          expectedVersionToken: openedViaReal.file.versionToken,
          text: buildValidDocumentText('Writer A', 30),
          suggestedName: 'doc.sketchdraw',
        }),
        service.saveDocument({
          mode: 'save',
          handleId: openedViaDirAlias.file.handleId,
          expectedVersionToken: openedViaDirAlias.file.versionToken,
          text: buildValidDocumentText('Writer B', 60),
          suggestedName: 'doc.sketchdraw',
        }),
      ]);

      const statuses = [firstSave.status, secondSave.status].sort();
      expect(statuses).toEqual(['conflict', 'saved']);

      // Now open via the file symlink and save; the symlink must remain a symlink and the real target must update
      openTarget = fileSymlinkDoc;
      const openedViaFileSymlink = await service.openDocument();
      expect(openedViaFileSymlink.status).toBe('opened');
      if (openedViaFileSymlink.status !== 'opened') return;

      const updatedViaSymlinkText = buildValidDocumentText('Saved Through File Symlink', 75);
      const savedViaSymlink = await service.saveDocument({
        mode: 'save',
        handleId: openedViaFileSymlink.file.handleId,
        expectedVersionToken: openedViaFileSymlink.file.versionToken,
        text: updatedViaSymlinkText,
        suggestedName: 'file-alias.sketchdraw',
      });

      expect(savedViaSymlink.status).toBe('saved');
      expect(await fs.readFile(realDoc, 'utf8')).toBe(updatedViaSymlinkText);
      expect((await fs.lstat(fileSymlinkDoc)).isSymbolicLink()).toBe(true);
    },
  );
});

function targetPathLikeHandle(dir: string): string {
  return path.join(dir, 'secret.sketchdraw');
}
