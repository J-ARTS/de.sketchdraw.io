import type { GitPluginSettings } from './plugins';

/**
 * The Git workbench (#216): what the Git dialog shows and does in the repository of the open diagram. Paths
 * are relative to the repository root and use forward slashes.
 */
export type GitChangeStatus = 'modified' | 'added' | 'deleted' | 'untracked' | 'conflicted';

export interface GitChange {
  path: string;
  status: GitChangeStatus;
  /** The file of the open diagram. */
  document: boolean;
}

export interface GitWorkbenchSnapshot {
  settings: GitPluginSettings;
  /** Changed files of the whole repository, the open diagram first. */
  changes: GitChange[];
  /** Path of the open diagram in the repository. */
  documentPath: string;
}

export type GitDiffLineKind = 'context' | 'added' | 'removed' | 'hunk';

export interface GitDiffLine {
  kind: GitDiffLineKind;
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface GitFileDiff {
  path: string;
  /** Binary files are named, not shown. */
  binary: boolean;
  /** The diff was longer than what is shown. */
  truncated: boolean;
  lines: GitDiffLine[];
}

export interface GitCommitSummary {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  /** ISO 8601 with offset. */
  date: string;
  /** Already on the configured remote branch. */
  pushed: boolean;
}

/** The branches the Git dialog offers. Names are short: `main`, `feature/login`; those of the remote come without its name. */
export interface GitBranches {
  /** The branch that is checked out; empty when HEAD is detached. */
  current: string;
  local: string[];
  /** Branches of the configured remote, as far as they were fetched. */
  remote: string[];
  /** Name of the configured remote, for example `origin`. */
  remoteName: string;
}

/** One branch of the list: a local one, or one of the configured remote. */
export interface GitBranchInput {
  handleId: string;
  branch: string;
  remote: boolean;
}

export interface GitCommitInput {
  handleId: string;
  message: string;
  /** The files to commit; every path must be one of the current changes. */
  paths: string[];
  /** Push to the configured remote after the commit. */
  push: boolean;
}

export interface GitWorkbenchResult {
  ok: boolean;
  message: string;
  workbench: GitWorkbenchSnapshot;
}

export const GIT_COMMIT_MESSAGE_MAX = 2000;
export const GIT_LOG_LIMIT = 100;
export const GIT_DIFF_LINE_LIMIT = 3000;

/** The Git operations of the dialog. Every call names the document it works for. */
export interface GitWorkbenchBridge {
  gitWorkbench(handleId: string): Promise<GitWorkbenchSnapshot>;
  /** The changes of one file: in the working tree, or in `commit` when given. */
  gitDiff(input: { handleId: string; path: string; commit?: string }): Promise<GitFileDiff>;
  gitCommit(input: GitCommitInput): Promise<GitWorkbenchResult>;
  gitPush(handleId: string): Promise<GitWorkbenchResult>;
  /** Fetches the remote branch and fast-forwards to it; never merges or rebases. */
  gitUpdate(handleId: string): Promise<GitWorkbenchResult>;
  gitLog(input: { handleId: string; documentOnly: boolean }): Promise<GitCommitSummary[]>;
  /** Lists the branches; `fetch` asks the remote for its branches first. */
  gitBranches(input: { handleId: string; fetch: boolean }): Promise<GitBranches>;
  /** Switches to a branch. A branch of the remote gets a local branch of its name that follows it. */
  gitCheckout(input: GitBranchInput): Promise<GitWorkbenchResult>;
  /** Creates a branch at the current commit and switches to it. */
  gitCreateBranch(input: { handleId: string; name: string }): Promise<GitWorkbenchResult>;
  /** Merges a branch into the current one. A merge with conflicts is taken back. */
  gitMerge(input: GitBranchInput): Promise<GitWorkbenchResult>;
  /** Puts versioned files back to the last commit. Untracked files stay. */
  gitDiscard(input: { handleId: string; paths: string[] }): Promise<GitWorkbenchResult>;
  /** Gives the file of the open diagram the content it had in `commit`, as an ordinary change. */
  gitRestoreDocument(input: { handleId: string; commit: string }): Promise<GitWorkbenchResult>;
  /** Switches the automatic steps without touching the connection settings. */
  gitAutomation(input: { autoCommit: boolean; autoPush: boolean; autoPull: boolean }): Promise<GitPluginSettings>;
}
