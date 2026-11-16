import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commitHash, commitMessage, gitFailure, parseLog, parseStatus, parseUnifiedDiff } from '../../electron/git-workbench';
import { PluginService } from '../../electron/plugin-service';
import type { DocumentPersistenceService } from '../../electron/persistence';
import type { PluginExternalEvent } from '../../src/domain';

const execFile = promisify(execFileCallback);
const cleanup: string[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

describe('git workbench: reading git output (#216)', () => {
  it('reads the status list with the open diagram first', () => {
    const output = ['?? notes.txt', ' M docs/readme.md', 'A  new.txt', ' D old.txt', 'UU both.txt', ' M board.sketchdraw.json', '?? name with -> arrow.txt', ''].join('\0');
    expect(parseStatus(output, 'board.sketchdraw.json')).toEqual([
      { path: 'board.sketchdraw.json', status: 'modified', document: true },
      { path: 'both.txt', status: 'conflicted', document: false },
      { path: 'docs/readme.md', status: 'modified', document: false },
      { path: 'name with -> arrow.txt', status: 'untracked', document: false },
      { path: 'new.txt', status: 'added', document: false },
      { path: 'notes.txt', status: 'untracked', document: false },
      { path: 'old.txt', status: 'deleted', document: false },
    ]);
    expect(parseStatus('', 'board.sketchdraw.json')).toEqual([]);
  });

  it('numbers the lines of a unified diff and leaves the file headers out', () => {
    const diff = ['diff --git a/a.txt b/a.txt', 'index 1..2 100644', '--- a/a.txt', '+++ b/a.txt', '@@ -2,3 +2,4 @@ heading', ' keep', '-old', '+new', '+more', ' tail', '\\ No newline at end of file'].join('\n');
    expect(parseUnifiedDiff('a.txt', diff)).toEqual({ path: 'a.txt', binary: false, truncated: false, lines: [
      { kind: 'hunk', text: '@@ -2,3 +2,4 @@ heading' },
      { kind: 'context', text: 'keep', oldLine: 2, newLine: 2 },
      { kind: 'removed', text: 'old', oldLine: 3 },
      { kind: 'added', text: 'new', newLine: 3 },
      { kind: 'added', text: 'more', newLine: 4 },
      { kind: 'context', text: 'tail', oldLine: 4, newLine: 5 },
    ] });
    // A removed line that starts with dashes is content, not a header.
    expect(parseUnifiedDiff('a.txt', '@@ -1 +1 @@\n--- title\n+++ title').lines.slice(1)).toEqual([{ kind: 'removed', text: '-- title', oldLine: 1 }, { kind: 'added', text: '++ title', newLine: 1 }]);
    expect(parseUnifiedDiff('p.png', 'diff --git a/p.png b/p.png\nBinary files a/p.png and b/p.png differ\n')).toEqual({ path: 'p.png', binary: true, truncated: false, lines: [] });
    const long = ['@@ -1,0 +1,10 @@', ...Array.from({ length: 10 }, (_, index) => `+line ${index}`)].join('\n');
    expect(parseUnifiedDiff('a.txt', long, 4)).toMatchObject({ truncated: true, lines: { length: 4 } });
  });

  it('reads the log and marks what is not on the remote yet', () => {
    const a = 'a'.repeat(40); const b = 'b'.repeat(40);
    const output = `${a}\x1faaaaaaa\x1fMira\x1f2026-11-16T08:00:00+01:00\x1fAdd queue\x1e\n${b}\x1fbbbbbbb\x1fJonas\x1f2026-11-15T10:00:00+01:00\x1fSubject | with \x1f nothing\x1e`;
    expect(parseLog(output, new Set([a]))).toEqual([
      { hash: a, shortHash: 'aaaaaaa', author: 'Mira', date: '2026-11-16T08:00:00+01:00', subject: 'Add queue', pushed: false },
      { hash: b, shortHash: 'bbbbbbb', author: 'Jonas', date: '2026-11-15T10:00:00+01:00', subject: 'Subject | with ', pushed: true },
    ]);
    expect(parseLog('', new Set())).toEqual([]);
  });

  it('accepts only real commit messages and commit hashes', () => {
    expect(commitMessage('  Add queue\r\n\r\nDetails  ')).toBe('Add queue\n\nDetails');
    for (const bad of ['', '   ', 'x'.repeat(2001), 5, null]) expect(() => commitMessage(bad)).toThrow();
    expect(commitHash('abc1234')).toBe('abc1234');
    for (const bad of ['HEAD', '--all', 'abc', 'ABC1234', 'abc1234; rm -rf', 'main', undefined]) expect(() => commitHash(bad)).toThrow();
  });

  it('turns the usual git failures into a sentence that says what to do', () => {
    expect(gitFailure({ stderr: 'Author identity unknown\n*** Please tell me who you are.' }, 'x')).toContain('user.name');
    expect(gitFailure({ stderr: ' ! [rejected] main -> main (fetch first)' }, 'x')).toContain('zuerst aktualisieren');
    expect(gitFailure({ stderr: 'fatal: Not possible to fast-forward, aborting.' }, 'x')).toContain('auseinandergelaufen');
    expect(gitFailure({ stderr: 'error: Your local changes to the following files would be overwritten by merge' }, 'x')).toContain('committen oder verwerfen');
    expect(gitFailure({ stderr: 'fatal: Authentication failed for https://example.com/' }, 'x')).toContain('Zugangsdaten');
    expect(gitFailure({ stderr: 'fatal: something else happened\n' }, 'Fehlgeschlagen.')).toBe('Fehlgeschlagen. something else happened');
    expect(gitFailure(new Error('Command failed: git push'), 'Fehlgeschlagen.')).toBe('Fehlgeschlagen.');
  });
});

/** A project with one commit, pushed to a bare remote, and a service whose Git plugin is switched on for it. */
async function project(options: { remote?: boolean } = {}) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-git-dialog-'))); cleanup.push(root);
  const dir = path.join(root, 'project'); const remote = path.join(root, 'remote.git');
  await mkdir(dir);
  const git = async (args: string[], cwd = dir): Promise<string> => (await execFile('git', args, { cwd })).stdout;
  await git(['init', '-b', 'main']);
  await git(['config', 'user.email', 'test@example.com']); await git(['config', 'user.name', 'Sketchdraw Test']); await git(['config', 'commit.gpgsign', 'false']);
  const documentPath = path.join(dir, 'board.sketchdraw.json');
  await writeFile(documentPath, '{"version":1}\n'); await writeFile(path.join(dir, 'readme.md'), 'first\n');
  await git(['add', '.']); await git(['commit', '-m', 'Initial diagram']);
  if (options.remote !== false) { await execFile('git', ['init', '--bare', '-b', 'main', remote]); await git(['remote', 'add', 'origin', remote]); await git(['push', '-u', 'origin', 'main']); }
  const events: PluginExternalEvent[] = [];
  let version = 0;
  const persistence = {
    getHandleLocation: (handleId: string) => handleId === 'project' ? { selectedPath: documentPath, canonicalPath: documentPath, versionToken: `v${version}` } : null,
    reloadDocument: vi.fn(async () => { version += 1; return { status: 'opened', text: await readFile(documentPath, 'utf8'), file: { handleId: 'project', name: 'board.sketchdraw.json', versionToken: `v${version}` } }; }),
  } as unknown as DocumentPersistenceService;
  const configDir = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-profiles-')); cleanup.push(configDir);
  const service = new PluginService({ configPath: path.join(configDir, 'plugins.json'), persistence, credentials: { available: () => true, encrypt: (value) => value, decrypt: (value) => value }, emitEvent: (event) => { events.push(event); } });
  await service.getSettings('project');
  await service.configureGit({ enabled: true, autoCommit: false, autoPush: false, autoPull: false, remote: 'origin', remoteUrl: '', authMode: 'system', username: '' });
  return { root, dir, remote, documentPath, git, service, events, dispose: () => service.dispose() };
}

describe('git workbench: against a real repository (#216)', () => {
  it('lists the changes of the repository, the open diagram first, and shows what changed in a file', async () => {
    const p = await project();
    try {
      expect((await p.service.gitWorkbench('project')).changes).toEqual([]);
      await writeFile(p.documentPath, '{"version":2}\n'); await writeFile(path.join(p.dir, 'readme.md'), 'first\nsecond\n'); await writeFile(path.join(p.dir, 'notes.txt'), 'a note\nwith two lines\n');
      const workbench = await p.service.gitWorkbench('project');
      expect(workbench.documentPath).toBe('board.sketchdraw.json');
      expect(workbench.changes).toEqual([
        { path: 'board.sketchdraw.json', status: 'modified', document: true },
        { path: 'notes.txt', status: 'untracked', document: false },
        { path: 'readme.md', status: 'modified', document: false },
      ]);
      expect(workbench.settings).toMatchObject({ branch: 'main', changedFiles: 3, ahead: 0, behind: 0, repositoryName: 'project' });
      expect((await p.service.gitDiff({ handleId: 'project', path: 'board.sketchdraw.json' })).lines).toEqual([
        { kind: 'hunk', text: '@@ -1 +1 @@' },
        { kind: 'removed', text: '{"version":1}', oldLine: 1 },
        { kind: 'added', text: '{"version":2}', newLine: 1 },
      ]);
      expect((await p.service.gitDiff({ handleId: 'project', path: 'notes.txt' })).lines).toEqual([{ kind: 'added', text: 'a note', newLine: 1 }, { kind: 'added', text: 'with two lines', newLine: 2 }]);
      await writeFile(path.join(p.dir, 'picture.bin'), Buffer.from([1, 0, 2, 0]));
      expect(await p.service.gitDiff({ handleId: 'project', path: 'picture.bin' })).toMatchObject({ binary: true, lines: [] });
    } finally { p.dispose(); }
  });

  it('refuses paths and commits that are not what the repository shows', async () => {
    const p = await project();
    try {
      await writeFile(p.documentPath, '{"version":2}\n');
      await expect(p.service.gitDiff({ handleId: 'project', path: 'readme.md' })).rejects.toThrow('passt nicht mehr');
      await expect(p.service.gitDiff({ handleId: 'project', path: '../outside.txt' })).rejects.toThrow('passt nicht mehr');
      await expect(p.service.gitDiff({ handleId: 'project', path: 'board.sketchdraw.json', commit: '--output=/tmp/x' })).rejects.toThrow('Commit ist ungültig');
      await expect(p.service.gitDiff({ handleId: 'project', path: 'board.sketchdraw.json', commit: 'deadbeef' })).rejects.toThrow('nicht gefunden');
      const refused = await p.service.gitCommit({ handleId: 'project', message: 'x', paths: ['--all'], push: false });
      expect(refused).toMatchObject({ ok: false }); expect(refused.message).toContain('passt nicht mehr');
      expect((await p.service.gitCommit({ handleId: 'project', message: '  ', paths: ['board.sketchdraw.json'], push: false })).message).toBe('Commit-Nachricht fehlt.');
      expect((await p.service.gitRestoreDocument({ handleId: 'project', commit: 'HEAD~1' })).message).toBe('Commit ist ungültig.');
      await expect(p.service.gitWorkbench('other')).rejects.toThrow();
      expect(await p.git(['log', '--oneline'])).toMatch(/^\w+ Initial diagram\n$/);
    } finally { p.dispose(); }
  });

  it('commits exactly the chosen files, also new and deleted ones, and leaves the rest alone', async () => {
    const p = await project();
    try {
      await writeFile(p.documentPath, '{"version":2}\n'); await writeFile(path.join(p.dir, 'notes.txt'), 'note\n'); await writeFile(path.join(p.dir, 'staged.txt'), 'staged\n');
      await p.git(['add', 'staged.txt']); await rm(path.join(p.dir, 'readme.md'));
      const result = await p.service.gitCommit({ handleId: 'project', message: 'Update the diagram\n\nwith a note', paths: ['board.sketchdraw.json', 'notes.txt', 'readme.md'], push: false });
      expect(result).toMatchObject({ ok: true, message: 'Commit erstellt.' });
      expect(result.workbench.changes).toEqual([{ path: 'staged.txt', status: 'added', document: false }]);
      expect(result.workbench.settings).toMatchObject({ ahead: 1, changedFiles: 1 });
      expect((await p.git(['show', '--name-status', '--format=%B', 'HEAD'])).split('\n').filter(Boolean)).toEqual(['Update the diagram', 'with a note', 'M\tboard.sketchdraw.json', 'A\tnotes.txt', 'D\treadme.md']);
      // Nothing reached the remote without a push.
      expect((await execFile('git', ['log', '--oneline', 'main'], { cwd: p.remote })).stdout.trim().split('\n')).toHaveLength(1);
    } finally { p.dispose(); }
  });

  it('pushes with the commit when asked, and on its own', async () => {
    const p = await project();
    try {
      await writeFile(p.documentPath, '{"version":2}\n');
      const committed = await p.service.gitCommit({ handleId: 'project', message: 'Second version', paths: ['board.sketchdraw.json'], push: true });
      expect(committed).toMatchObject({ ok: true, message: 'Commit erstellt und gepusht.', workbench: { changes: [], settings: { ahead: 0, behind: 0, health: 'ready' } } });
      expect((await execFile('git', ['log', '-1', '--pretty=%s', 'main'], { cwd: p.remote })).stdout.trim()).toBe('Second version');
      await writeFile(p.documentPath, '{"version":3}\n');
      await p.service.gitCommit({ handleId: 'project', message: 'Third version', paths: ['board.sketchdraw.json'], push: false });
      expect((await p.service.gitWorkbench('project')).settings.ahead).toBe(1);
      expect(await p.service.gitPush('project')).toMatchObject({ ok: true, message: 'Commits wurden gepusht.', workbench: { settings: { ahead: 0 } } });
      expect((await execFile('git', ['log', '-1', '--pretty=%s', 'main'], { cwd: p.remote })).stdout.trim()).toBe('Third version');
    } finally { p.dispose(); }
  });

  it('updates by fast-forward, reloads the diagram, and says so when the histories have parted', async () => {
    const p = await project();
    try {
      const other = path.join(p.root, 'other');
      await execFile('git', ['clone', '--branch', 'main', p.remote, other]);
      const git = async (args: string[]): Promise<string> => (await execFile('git', args, { cwd: other })).stdout;
      await git(['config', 'user.email', 'other@example.com']); await git(['config', 'user.name', 'Other']);
      await writeFile(path.join(other, 'board.sketchdraw.json'), '{"version":"remote"}\n'); await git(['commit', '-am', 'Remote edit']); await git(['push', 'origin', 'main']);

      expect(await p.service.gitUpdate('project')).toMatchObject({ ok: true, message: 'Neue Commits vom Remote übernommen.', workbench: { settings: { behind: 0, ahead: 0 } } });
      expect(await readFile(p.documentPath, 'utf8')).toBe('{"version":"remote"}\n');
      expect(p.events).toEqual([{ type: 'document-changed', text: '{"version":"remote"}\n', file: expect.objectContaining({ handleId: 'project' }) }]);
      expect(await p.service.gitUpdate('project')).toMatchObject({ ok: true, message: 'Das Repository ist auf dem Stand des Remotes.' });
      expect(p.events).toHaveLength(1);

      await writeFile(path.join(other, 'board.sketchdraw.json'), '{"version":"remote 2"}\n'); await git(['commit', '-am', 'Remote edit 2']); await git(['push', 'origin', 'main']);
      await writeFile(p.documentPath, '{"version":"local"}\n');
      await p.service.gitCommit({ handleId: 'project', message: 'Local edit', paths: ['board.sketchdraw.json'], push: false });
      const parted = await p.service.gitUpdate('project');
      expect(parted.ok).toBe(false); expect(parted.message).toContain('auseinandergelaufen');
      expect(await readFile(p.documentPath, 'utf8')).toBe('{"version":"local"}\n');
      const rejected = await p.service.gitPush('project');
      expect(rejected.ok).toBe(false); expect(rejected.message).toContain('zuerst aktualisieren');
    } finally { p.dispose(); }
  });

  it('lists the history, for the whole repository or for the diagram, and marks unpushed commits', async () => {
    const p = await project();
    try {
      await writeFile(path.join(p.dir, 'readme.md'), 'second\n');
      await p.service.gitCommit({ handleId: 'project', message: 'Readme only', paths: ['readme.md'], push: true });
      await writeFile(p.documentPath, '{"version":2}\n');
      await p.service.gitCommit({ handleId: 'project', message: 'Diagram again', paths: ['board.sketchdraw.json'], push: false });
      const all = await p.service.gitLog({ handleId: 'project', documentOnly: false });
      expect(all.map(({ subject, pushed, author }) => ({ subject, pushed, author }))).toEqual([
        { subject: 'Diagram again', pushed: false, author: 'Sketchdraw Test' },
        { subject: 'Readme only', pushed: true, author: 'Sketchdraw Test' },
        { subject: 'Initial diagram', pushed: true, author: 'Sketchdraw Test' },
      ]);
      expect(all[0]!.hash).toMatch(/^[0-9a-f]{40}$/); expect(Number.isNaN(Date.parse(all[0]!.date))).toBe(false);
      expect((await p.service.gitLog({ handleId: 'project', documentOnly: true })).map((commit) => commit.subject)).toEqual(['Diagram again', 'Initial diagram']);
      // What a commit changed in the diagram.
      expect((await p.service.gitDiff({ handleId: 'project', path: 'board.sketchdraw.json', commit: all[0]!.hash })).lines.filter((line) => line.kind !== 'hunk')).toEqual([{ kind: 'removed', text: '{"version":1}', oldLine: 1 }, { kind: 'added', text: '{"version":2}', newLine: 1 }]);
    } finally { p.dispose(); }
  });

  it('discards chosen changes back to the last commit and keeps untracked files', async () => {
    const p = await project();
    try {
      await writeFile(p.documentPath, '{"version":2}\n'); await writeFile(path.join(p.dir, 'readme.md'), 'changed\n'); await writeFile(path.join(p.dir, 'notes.txt'), 'note\n'); await writeFile(path.join(p.dir, 'staged.txt'), 'staged\n'); await p.git(['add', 'staged.txt']);
      const untracked = await p.service.gitDiscard({ handleId: 'project', paths: ['notes.txt'] });
      expect(untracked.ok).toBe(false); expect(await readFile(path.join(p.dir, 'notes.txt'), 'utf8')).toBe('note\n');
      const result = await p.service.gitDiscard({ handleId: 'project', paths: ['board.sketchdraw.json', 'staged.txt'] });
      expect(result).toMatchObject({ ok: true, message: 'Änderungen verworfen.' });
      expect(await readFile(p.documentPath, 'utf8')).toBe('{"version":1}\n');
      expect(result.workbench.changes.map(({ path: file, status }) => `${status} ${file}`)).toEqual(['untracked notes.txt', 'modified readme.md', 'untracked staged.txt']);
      // The open diagram changed on disk, so the editor is told to reload it.
      expect(p.events.map((event) => event.type)).toEqual(['document-changed']);
    } finally { p.dispose(); }
  });

  it('gives the diagram the content of an old commit as an ordinary change', async () => {
    const p = await project();
    try {
      const first = (await p.git(['rev-parse', 'HEAD'])).trim();
      await writeFile(p.documentPath, '{"version":2}\n'); await writeFile(path.join(p.dir, 'readme.md'), 'second\n');
      await p.service.gitCommit({ handleId: 'project', message: 'Second version', paths: ['board.sketchdraw.json', 'readme.md'], push: false });
      const head = (await p.git(['rev-parse', 'HEAD'])).trim();
      const result = await p.service.gitRestoreDocument({ handleId: 'project', commit: first });
      expect(result.ok).toBe(true);
      expect(await readFile(p.documentPath, 'utf8')).toBe('{"version":1}\n');
      // Only the diagram went back; the history and the other file stay.
      expect(await readFile(path.join(p.dir, 'readme.md'), 'utf8')).toBe('second\n');
      expect((await p.git(['rev-parse', 'HEAD'])).trim()).toBe(head);
      expect(result.workbench.changes).toEqual([{ path: 'board.sketchdraw.json', status: 'modified', document: true }]);
      expect(p.events).toHaveLength(1);
      // A commit from before the diagram existed cannot be restored.
      await p.git(['commit', '--allow-empty', '-m', 'empty']);
      const orphan = (await p.git(['commit-tree', '-m', 'no files', '4b825dc642cb6eb9a060e54bf8d69288fbee4904'])).trim();
      expect((await p.service.gitRestoreDocument({ handleId: 'project', commit: orphan })).message).toBe('Dieses Diagramm gab es in dem gewählten Commit noch nicht.');
    } finally { p.dispose(); }
  });

  it('switches the automatic steps without touching the connection', async () => {
    const p = await project();
    try {
      await p.service.configureGit({ enabled: true, autoCommit: false, autoPush: false, autoPull: false, remote: 'origin', remoteUrl: '', authMode: 'system', username: 'mira' });
      const settings = await p.service.gitAutomation({ autoCommit: true, autoPush: true, autoPull: false });
      expect(settings).toMatchObject({ enabled: true, autoCommit: true, autoPush: true, autoPull: false, remote: 'origin', username: 'mira', branch: 'main' });
      expect((await p.service.getSettings()).git).toMatchObject({ autoCommit: true, autoPush: true, autoPull: false, username: 'mira' });
      // Saving now commits and pushes the diagram on its own.
      await writeFile(p.documentPath, '{"version":2}\n');
      await p.service.afterDocumentSaved('project');
      expect((await execFile('git', ['log', '-1', '--pretty=%s', 'main'], { cwd: p.remote })).stdout.trim()).toBe('Update board.sketchdraw.json via Sketchdraw');
      await p.service.configureGit({ enabled: false, autoCommit: true, autoPush: true, autoPull: false, remote: 'origin', remoteUrl: '', authMode: 'system', username: 'mira' });
      await expect(p.service.gitAutomation({ autoCommit: false, autoPush: false, autoPull: false })).rejects.toThrow('deaktiviert');
    } finally { p.dispose(); }
  });

  it('works in a repository without a remote and before the first commit', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-git-fresh-'))); cleanup.push(root);
    const documentPath = path.join(root, 'board.sketchdraw.json'); await writeFile(documentPath, '{"version":1}\n');
    const persistence = { getHandleLocation: (handleId: string) => handleId === 'project' ? { selectedPath: documentPath, canonicalPath: documentPath, versionToken: 'v0' } : null, reloadDocument: vi.fn() } as unknown as DocumentPersistenceService;
    const service = new PluginService({ persistence, credentials: { available: () => true, encrypt: (value) => value, decrypt: (value) => value }, emitEvent: vi.fn() });
    try {
      await service.getSettings('project');
      await service.configureGit({ enabled: true, autoCommit: false, autoPush: false, autoPull: false, remote: 'origin', remoteUrl: '', authMode: 'system', username: '' });
      await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: root }); await execFile('git', ['config', 'user.name', 'Sketchdraw Test'], { cwd: root });
      expect((await service.gitWorkbench('project')).changes).toEqual([{ path: 'board.sketchdraw.json', status: 'untracked', document: true }]);
      expect(await service.gitLog({ handleId: 'project', documentOnly: false })).toEqual([]);
      expect(await service.gitCommit({ handleId: 'project', message: 'First commit', paths: ['board.sketchdraw.json'], push: false })).toMatchObject({ ok: true, workbench: { changes: [] } });
      expect((await service.gitLog({ handleId: 'project', documentOnly: false })).map(({ subject, pushed }) => ({ subject, pushed }))).toEqual([{ subject: 'First commit', pushed: false }]);
      const push = await service.gitPush('project');
      expect(push.ok).toBe(false); expect(push.message).toContain('Der Push ist fehlgeschlagen.');
    } finally { service.dispose(); }
  });
});
