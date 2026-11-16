import { promises as fs } from 'node:fs';
import path from 'node:path';
import { GIT_COMMIT_MESSAGE_MAX, GIT_DIFF_LINE_LIMIT, GIT_LOG_LIMIT, type GitChange, type GitChangeStatus, type GitCommitSummary, type GitDiffLine, type GitFileDiff } from '../src/domain/git-workbench';

/**
 * The Git commands behind the Git dialog (#216). Everything here works on one repository through a `run`
 * function that calls git without a shell; the plugin service decides which repository, which document and
 * which calls may use the stored token. Values from the renderer never reach git unchecked: paths must be
 * among the current changes, commits must be hashes that git resolves to a commit.
 */
export type GitRun = (args: string[], authenticated?: boolean) => Promise<{ stdout: string; stderr: string }>;

const UNTRACKED_PREVIEW_BYTES = 400_000;
/** Pathspecs are taken literally, so a file name with `*` or `:` is that file and nothing else. */
const LITERAL = '--literal-pathspecs';

const slash = (value: string): string => value.split(path.sep).join('/');

function changeStatus(index: string, tree: string): GitChangeStatus {
  if (index === '?' && tree === '?') return 'untracked';
  if (index === 'U' || tree === 'U' || (index === 'A' && tree === 'A') || (index === 'D' && tree === 'D')) return 'conflicted';
  if (index === 'D' || tree === 'D') return 'deleted';
  if (index === 'A') return 'added';
  return 'modified';
}

/** Reads `git status --porcelain=v1 -z --no-renames`: one `XY path` entry per NUL. */
export function parseStatus(output: string, documentPath: string): GitChange[] {
  const changes = output.split('\0').filter((entry) => entry.length > 3).map((entry): GitChange => {
    const file = entry.slice(3);
    return { path: file, status: changeStatus(entry[0]!, entry[1]!), document: file === documentPath };
  });
  return changes.sort((a, b) => Number(b.document) - Number(a.document) || a.path.localeCompare(b.path));
}

/** Reads a unified diff of one file into numbered lines; headers before the first hunk are left out. */
export function parseUnifiedDiff(file: string, output: string, limit = GIT_DIFF_LINE_LIMIT): GitFileDiff {
  const lines: GitDiffLine[] = [];
  let binary = false; let truncated = false; let oldLine = 0; let newLine = 0; let inHunk = false;
  for (const raw of output.split('\n')) {
    if (!inHunk && /^Binary files .* differ$|^GIT binary patch$/.test(raw)) { binary = true; break; }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) { inHunk = true; oldLine = Number(hunk[1]); newLine = Number(hunk[2]); if (lines.length >= limit) { truncated = true; break; } lines.push({ kind: 'hunk', text: raw }); continue; }
    if (!inHunk || raw.startsWith('\\')) continue;
    if (raw.startsWith('diff --git ')) { inHunk = false; continue; }
    if (lines.length >= limit) { truncated = true; break; }
    if (raw.startsWith('+')) lines.push({ kind: 'added', text: raw.slice(1), newLine: newLine++ });
    else if (raw.startsWith('-')) lines.push({ kind: 'removed', text: raw.slice(1), oldLine: oldLine++ });
    else if (raw.startsWith(' ')) lines.push({ kind: 'context', text: raw.slice(1), oldLine: oldLine++, newLine: newLine++ });
  }
  return { path: file, binary, truncated, lines: binary ? [] : lines };
}

const FIELD = '\x1f';
const RECORD = '\x1e';
const LOG_FORMAT = `--pretty=format:%H${FIELD}%h${FIELD}%an${FIELD}%aI${FIELD}%s${RECORD}`;

export function parseLog(output: string, unpushed: ReadonlySet<string>): GitCommitSummary[] {
  return output.split(RECORD).map((record) => record.replace(/^\n/, '')).filter(Boolean).map((record) => {
    const [hash = '', shortHash = '', author = '', date = '', subject = ''] = record.split(FIELD);
    return { hash, shortHash, author, date, subject, pushed: !unpushed.has(hash) };
  }).filter((commit) => /^[0-9a-f]{40,64}$/.test(commit.hash));
}

export function commitMessage(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Commit-Nachricht fehlt.');
  const message = value.replace(/\r\n?/g, '\n').trim();
  if (!message) throw new Error('Commit-Nachricht fehlt.');
  if (message.length > GIT_COMMIT_MESSAGE_MAX || message.includes('\0')) throw new Error('Commit-Nachricht ist zu lang.');
  return message;
}

export function commitHash(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{7,64}$/.test(value)) throw new Error('Commit ist ungültig.');
  return value;
}

/** Git explains a failed command on stderr; the first meaningful line is what the user needs. */
export function gitFailure(error: unknown, fallback: string): string {
  const record = error as { stderr?: unknown; message?: unknown } | null;
  const text = typeof record?.stderr === 'string' && record.stderr.trim() ? record.stderr : typeof record?.message === 'string' ? record.message : '';
  if (/Please tell me who you are|user\.email|empty ident/i.test(text)) return 'Git kennt noch keinen Namen und keine E-Mail-Adresse für Commits. Bitte einmal mit „git config user.name“ und „git config user.email“ einrichten.';
  if (/non-fast-forward|fetch first|\[rejected\]/i.test(text)) return 'Der Remote hat neuere Commits. Bitte zuerst aktualisieren.';
  if (/Not possible to fast-forward|diverg/i.test(text)) return 'Lokale und entfernte Commits sind auseinandergelaufen. Sketchdraw führt sie nicht zusammen; bitte in einem Git-Werkzeug zusammenführen.';
  if (/would be overwritten/i.test(text)) return 'Lokale Änderungen stehen dem Aktualisieren im Weg. Bitte zuerst committen oder verwerfen.';
  if (/Authentication failed|could not read Username|Permission denied|403/i.test(text)) return 'Die Anmeldung am Remote ist fehlgeschlagen. Bitte die Git-Zugangsdaten in den Plugin-Einstellungen prüfen.';
  const line = text.split('\n').map((entry) => entry.replace(/^(fatal|error|hint):\s*/i, '').trim()).find((entry) => entry && !entry.startsWith('Command failed'));
  return line ? `${fallback} Git meldet: ${line.slice(0, 300)}` : fallback;
}

export class GitWorkbench {
  constructor(private readonly run: GitRun, private readonly root: string, private readonly documentFile: string, private readonly remote: string) {}

  /** Path of the open diagram in the repository. */
  get documentPath(): string { return slash(path.relative(this.root, this.documentFile)); }

  async changes(): Promise<GitChange[]> {
    const { stdout } = await this.run(['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all']);
    return parseStatus(stdout, this.documentPath);
  }

  /** Only paths that are changed right now pass; that keeps anything else from reaching git. */
  private async known(paths: unknown, allowed?: (change: GitChange) => boolean): Promise<GitChange[]> {
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > 2000 || paths.some((entry) => typeof entry !== 'string')) throw new Error('Keine Dateien ausgewählt.');
    const changes = new Map((await this.changes()).map((change) => [change.path, change]));
    const selected = [...new Set(paths as string[])].map((entry) => changes.get(entry));
    if (selected.some((change) => !change)) throw new Error('Die Auswahl passt nicht mehr zum Stand des Repositorys. Bitte neu laden.');
    const result = selected as GitChange[];
    if (allowed && !result.every(allowed)) throw new Error('Die Auswahl enthält Dateien, für die diese Aktion nicht möglich ist.');
    return result;
  }

  private async hasCommits(): Promise<boolean> {
    try { await this.run(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']); return true; } catch { return false; }
  }

  private async branch(): Promise<string> {
    const name = (await this.run(['branch', '--show-current'])).stdout.trim();
    if (!name) throw new Error('Es ist kein Branch ausgecheckt.');
    return name;
  }

  private async resolved(commit: unknown): Promise<string> {
    const hash = commitHash(commit);
    try { return (await this.run(['rev-parse', '--verify', '--quiet', `${hash}^{commit}`])).stdout.trim(); }
    catch { throw new Error('Commit wurde nicht gefunden.'); }
  }

  async diff(file: unknown, commit?: unknown): Promise<GitFileDiff> {
    if (typeof file !== 'string' || !file || file.length > 4096 || file.includes('\0')) throw new Error('Datei ist ungültig.');
    if (commit !== undefined) {
      const hash = await this.resolved(commit);
      // A file of a commit must be the open diagram or a file that commit touched; git answers with an empty diff otherwise.
      const { stdout } = await this.run([LITERAL, 'show', '--no-color', '--no-ext-diff', '--no-textconv', '--format=', hash, '--', file]);
      return parseUnifiedDiff(file, stdout);
    }
    const [change] = await this.known([file]);
    if (change!.status === 'untracked') return this.untracked(file);
    const base = await this.hasCommits() ? ['HEAD'] : ['--cached'];
    const { stdout } = await this.run([LITERAL, 'diff', '--no-color', '--no-ext-diff', '--no-textconv', ...base, '--', file]);
    return parseUnifiedDiff(file, stdout);
  }

  /** A file git does not know yet has no diff; its content is shown as added lines. */
  private async untracked(file: string): Promise<GitFileDiff> {
    const absolute = path.resolve(this.root, file);
    if (path.relative(this.root, absolute).startsWith('..')) throw new Error('Datei ist ungültig.');
    const stat = await fs.lstat(absolute);
    if (!stat.isFile()) return { path: file, binary: true, truncated: false, lines: [] };
    const handle = await fs.open(absolute, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(stat.size, UNTRACKED_PREVIEW_BYTES));
      await handle.read(buffer, 0, buffer.length, 0);
      if (buffer.includes(0)) return { path: file, binary: true, truncated: false, lines: [] };
      const all = buffer.toString('utf8').split('\n');
      if (all.at(-1) === '') all.pop();
      const lines = all.slice(0, GIT_DIFF_LINE_LIMIT).map((text, index): GitDiffLine => ({ kind: 'added', text: text.replace(/\r$/, ''), newLine: index + 1 }));
      return { path: file, binary: false, truncated: stat.size > buffer.length || all.length > lines.length, lines };
    } finally { await handle.close(); }
  }

  /** Commits exactly the chosen files, whatever else is staged. */
  async commit(message: unknown, paths: unknown): Promise<void> {
    const text = commitMessage(message);
    const selected = await this.known(paths, (change) => change.status !== 'conflicted');
    const files = selected.map((change) => change.path);
    await this.run([LITERAL, 'add', '--all', '--', ...files]);
    await this.run([LITERAL, 'commit', '--only', '-m', text, '--', ...files]);
  }

  /** Pushes the current branch to the branch of the same name; nothing in the configuration of the repository changes. */
  async push(): Promise<void> {
    const branch = await this.branch();
    await this.run(['push', this.remote, `HEAD:refs/heads/${branch}`], true);
  }

  /** True when new commits arrived. */
  async update(): Promise<boolean> {
    const branch = await this.branch();
    const target = `refs/remotes/${this.remote}/${branch}`;
    await this.run(['fetch', '--no-tags', '--no-recurse-submodules', this.remote, `+refs/heads/${branch}:${target}`], true);
    const before = (await this.run(['rev-parse', 'HEAD'])).stdout.trim();
    await this.run(['merge', '--ff-only', target]);
    return (await this.run(['rev-parse', 'HEAD'])).stdout.trim() !== before;
  }

  async log(documentOnly: boolean): Promise<GitCommitSummary[]> {
    if (!await this.hasCommits()) return [];
    let unpushed = new Set<string>();
    try {
      const branch = await this.branch();
      unpushed = new Set((await this.run(['rev-list', `--max-count=${GIT_LOG_LIMIT}`, 'HEAD', '--not', `refs/remotes/${this.remote}/${branch}`])).stdout.split('\n').filter(Boolean));
    } catch {
      // Without a remote branch nothing counts as pushed.
      unpushed = new Set((await this.run(['rev-list', `--max-count=${GIT_LOG_LIMIT}`, 'HEAD'])).stdout.split('\n').filter(Boolean));
    }
    const { stdout } = await this.run([LITERAL, 'log', `--max-count=${GIT_LOG_LIMIT}`, LOG_FORMAT, ...(documentOnly ? ['--', this.documentPath] : [])]);
    return parseLog(stdout, unpushed);
  }

  async discard(paths: unknown): Promise<void> {
    const selected = await this.known(paths, (change) => change.status !== 'untracked');
    // A file that was only added has no version to go back to; it is taken out of the index and stays on disk.
    const added = selected.filter((change) => change.status === 'added').map((change) => change.path);
    const tracked = selected.filter((change) => change.status !== 'added').map((change) => change.path);
    if (added.length) await this.run([LITERAL, 'rm', '--cached', '--quiet', '--', ...added]);
    if (tracked.length) await this.run([LITERAL, 'restore', '--source=HEAD', '--staged', '--worktree', '--', ...tracked]);
  }

  /** The diagram gets its content from `commit`; index and history stay as they are. */
  async restoreDocument(commit: unknown): Promise<void> {
    const hash = await this.resolved(commit);
    try { await this.run([LITERAL, 'cat-file', '-e', `${hash}:${this.documentPath}`]); }
    catch { throw new Error('Dieses Diagramm gab es in dem gewählten Commit noch nicht.'); }
    await this.run([LITERAL, 'restore', `--source=${hash}`, '--worktree', '--', this.documentPath]);
  }
}
