import { createDocument, serializeDocument, type DesktopBridge, type GitBranches, type GitChange, type GitCommitSummary, type GitFileDiff, type GitPluginSettings, type GitWorkbenchResult, type GitWorkbenchSnapshot, type PluginBridge, type PluginSettingsSnapshot } from '@/domain';

/**
 * A stand-in for the desktop with a Git repository that only exists in memory, for stories of the Git dialog.
 * It answers like the plugin service: commits take the chosen files off the list, a push clears the lead.
 */
export function gitDemoBridge(options: { clean?: boolean } = {}): DesktopBridge {
  const file = { handleId: 'demo-file', name: 'checkout.sketchdraw', versionToken: 'v1' };
  let changes: GitChange[] = options.clean ? [] : [
    { path: 'diagrams/checkout.sketchdraw', status: 'modified', document: true },
    { path: 'diagrams/login.sketchdraw', status: 'modified', document: false },
    { path: 'docs/architecture.md', status: 'untracked', document: false },
    { path: 'diagrams/legacy-shop.sketchdraw', status: 'deleted', document: false },
  ];
  const git: GitPluginSettings = { installed: true, enabled: true, folderPath: '/Users/demo/shop', autoCommit: false, autoPush: false, autoPull: true, remote: 'origin', remoteUrl: 'https://example.com/shop.git', authMode: 'system', username: '', credentialStored: false, health: 'ready', message: 'Lokale Änderungen erkannt.', repositoryName: 'shop-architecture', branch: 'main', changedFiles: changes.length, ahead: 1, behind: 0 };
  const commits: GitCommitSummary[] = [
    { hash: 'a'.repeat(40), shortHash: 'a41c9e2', subject: 'Zahlungsdienst an die Bank anbinden', author: 'Mira Okafor', date: '2026-11-15T16:42:00+01:00', pushed: false },
    { hash: 'b'.repeat(40), shortHash: 'b7730d1', subject: 'Warteschlange zwischen Shop und Versand', author: 'Jonas Reuter', date: '2026-11-14T10:05:00+01:00', pushed: true },
    { hash: 'c'.repeat(40), shortHash: 'c05e8aa', subject: 'Erstes Diagramm des Checkouts', author: 'Mira Okafor', date: '2026-11-10T09:12:00+01:00', pushed: true },
  ];
  const branches: GitBranches = { current: 'main', local: ['feature/payment-provider', 'main', 'release/2026-11'], remote: ['feature/payment-provider', 'feature/shipping-queue', 'main'], remoteName: 'origin' };
  const diff = (path: string): GitFileDiff => ({ path, binary: false, truncated: false, lines: [
    { kind: 'hunk', text: '@@ -12,5 +12,6 @@ page "Checkout"' },
    { kind: 'context', text: '  rect shop "Shop" at 120,80 size 160x64', oldLine: 12, newLine: 12 },
    { kind: 'removed', text: '  rect pay "Zahlung" at 360,80 size 160x64', oldLine: 13 },
    { kind: 'added', text: '  rect pay "Zahlungsdienst" at 360,80 size 180x64', newLine: 13 },
    { kind: 'added', text: '  cylinder ledger "Buchungen" at 620,72 size 120x80', newLine: 14 },
    { kind: 'context', text: '  arrow shop -> pay "bezahlen"', oldLine: 14, newLine: 15 },
    { kind: 'context', text: '  arrow pay -> shop "Ergebnis" dashed', oldLine: 15, newLine: 16 },
  ] });
  const workbench = (): GitWorkbenchSnapshot => ({ settings: { ...git, changedFiles: changes.length }, changes: changes.map((change) => ({ ...change })), documentPath: 'diagrams/checkout.sketchdraw' });
  const done = (message: string, ok = true): GitWorkbenchResult => ({ ok, message, workbench: workbench() });
  const settings = (): PluginSettingsSnapshot => ({ available: true, projectFolder: '/Users/demo/shop', profiles: [{ id: 'default', name: 'Standard' }], activeProfileId: 'default', git: { ...git, changedFiles: changes.length }, atlassian: { installed: false, enabled: false, siteUrl: '', email: '', confluenceSpaceKey: '', jiraProjectKey: '', jiraIssueType: 'Task', jqlFilter: '', credentialStored: false, health: 'disabled', message: '' } });
  const plugins: Partial<PluginBridge> = {
    getSettings: async () => settings(),
    watchDocument: async () => ({ ok: true, message: '' }),
    afterDocumentSaved: async () => {},
    onEvent: () => () => {},
    gitWorkbench: async () => workbench(),
    gitDiff: async ({ path }) => diff(path),
    gitCommit: async ({ paths, push }) => { changes = changes.filter((change) => !paths.includes(change.path)); git.ahead = push ? 0 : (git.ahead ?? 0) + 1; return done(push ? 'Commit erstellt und gepusht.' : 'Commit erstellt.'); },
    gitPush: async () => { git.ahead = 0; return done('Commits wurden gepusht.'); },
    gitUpdate: async () => done('Das Repository ist auf dem Stand des Remotes.'),
    gitLog: async ({ documentOnly }) => documentOnly ? commits.filter((_, index) => index !== 1) : commits,
    gitBranches: async () => ({ ...branches, local: [...branches.local], remote: [...branches.remote] }),
    gitCheckout: async ({ branch }) => { if (!branches.local.includes(branch)) branches.local = [...branches.local, branch].sort(); branches.current = branch; git.branch = branch; return done(`Branch „${branch}“ ausgecheckt.`); },
    gitCreateBranch: async ({ name }) => { branches.local = [...branches.local, name].sort(); branches.current = name; git.branch = name; return done(`Branch „${name}“ erstellt und ausgecheckt.`); },
    gitMerge: async () => { git.ahead = (git.ahead ?? 0) + 1; return done('Der Branch wurde zusammengeführt.'); },
    gitDiscard: async ({ paths }) => { changes = changes.filter((change) => !paths.includes(change.path)); return done('Änderungen verworfen.'); },
    gitRestoreDocument: async () => done('Das Diagramm hat den Stand des gewählten Commits. Mit einem Commit hältst du das fest.'),
    gitAutomation: async (input) => { Object.assign(git, input); return { ...git }; },
  };
  return {
    platform: 'electron',
    openDocument: async () => ({ status: 'opened', text: serializeDocument(createDocument('Checkout')), file }),
    saveDocument: async () => ({ status: 'cancelled' }),
    exportFile: async () => ({ status: 'cancelled' }),
    openExternal: async () => {},
    onCloseRequested: () => () => {}, respondToClose: async () => {}, onMenuCommand: () => () => {},
    plugins: plugins as PluginBridge,
  };
}
