const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

class EventEmitter {
  constructor() {
    this.listeners = [];
    this.event = (listener) => this.listeners.push(listener);
  }
  fire(value) {
    for (const listener of this.listeners) {
      listener(value);
    }
  }
}

class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

const vscode = {
  EventEmitter,
  TreeItem,
  TreeItemCollapsibleState: { None: 0, Expanded: 2 },
  StatusBarAlignment: { Left: 1 },
  ThemeIcon: class ThemeIcon {},
  Uri: class Uri {
    constructor(fsPath) { this.fsPath = fsPath; }
    static file(fsPath) { return new Uri(fsPath); }
  },
  commands: {},
  workspace: { workspaceFolders: [] },
  window: { showErrorMessage: () => {} },
};

const load = Module._load;
Module._load = function (request, ...args) {
  return request === 'vscode' ? vscode : load.call(this, request, ...args);
};
const git = require('../out/git');
const originalGit = { ...git };
const { SkippedFilesService } = require('../out/skippedFilesService');
const { SkippedFilesTreeProvider, RecentlySkippedFilesTreeProvider } = require('../out/skippedFilesTree');
const { activate } = require('../out/extension');
Module._load = load;

function state() {
  let value = [];
  return {
    get: () => value,
    update: async (_key, entries) => { value = entries; },
  };
}

function entry(cwd, relativePath, workspaceFolderName) {
  return { cwd, relativePath, workspaceFolderName };
}

test('history survives reload, excludes current skips, and is scoped to workspace roots', async () => {
  const a = entry('root-a', 'config.json', 'A');
  const b = entry('root-b', 'config.json', 'B');
  const storage = state();
  vscode.workspace.workspaceFolders = [
    { uri: { fsPath: 'root-a' }, name: 'A' },
    { uri: { fsPath: 'root-b' }, name: 'B' },
  ];

  const service = new SkippedFilesService(storage);
  await service.recordSkipped([a, b], false);
  assert.deepEqual(service.listRecentlySkipped([a, b]), []);
  assert.deepEqual(service.listRecentlySkipped([b]), [a]);

  const reopened = new SkippedFilesService(storage);
  assert.deepEqual(reopened.listRecentlySkipped([]), [a, b]);
  await reopened.recordSkipped([a], true);
  assert.deepEqual(reopened.listRecentlySkipped([]), [a, b]);
  await reopened.recordSkipped([b], true);
  assert.deepEqual(reopened.listRecentlySkipped([]), [b, a]);

  vscode.workspace.workspaceFolders = [{ uri: { fsPath: 'root-a' }, name: 'Renamed' }];
  assert.deepEqual(reopened.listRecentlySkipped([]), [{ ...a, workspaceFolderName: 'Renamed' }]);
});

test('failed persistence is reported to caller and can be retried', async () => {
  const a = entry('root-a', 'config.json', 'A');
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: 'root-a' }, name: 'A' }];
  const storage = state();
  const update = storage.update;
  storage.update = async () => { throw new Error('storage failed'); };
  const service = new SkippedFilesService(storage);

  await assert.rejects(service.recordSkipped([a], true), /storage failed/);
  storage.update = update;
  await service.recordSkipped([a], false);
  assert.deepEqual(new SkippedFilesService(storage).listRecentlySkipped([]), [a]);
});

test('concurrent history updates preserve both entries', async () => {
  const a = entry('root-a', 'a.json', 'A');
  const b = entry('root-a', 'b.json', 'A');
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: 'root-a' }, name: 'A' }];
  const storage = state();
  const service = new SkippedFilesService(storage);
  await Promise.all([service.recordSkipped([a], true), service.recordSkipped([b], true)]);
  assert.deepEqual(new SkippedFilesService(storage).listRecentlySkipped([]), [b, a]);
});

test('refresh observes external skips and shows them only after unskip', async () => {
  const folder = { uri: { fsPath: 'root-a' }, name: 'A' };
  vscode.workspace.workspaceFolders = [folder];
  let skipped = ['config.json'];
  git.isInsideGitRepo = async () => true;
  git.listSkippedFiles = async () => skipped;

  const service = new SkippedFilesService(state());
  const recent = new RecentlySkippedFilesTreeProvider();
  const current = new SkippedFilesTreeProvider(service, recent);
  await current.initialize();
  assert.equal(current.getChildren().length, 1);
  assert.deepEqual(recent.getChildren(), []);

  skipped = [];
  await current.reload();
  assert.equal(current.getChildren().length, 0);
  assert.deepEqual(recent.getChildren(), [entry('root-a', 'config.json', 'A')]);
  assert.equal(recent.getTreeItem(recent.getChildren()[0]).command.command, 'skipWorktree.openSkippedFile');

  skipped = ['config.json'];
  await current.reload();
  assert.deepEqual(recent.getChildren(), []);
});

test('an externally reskipped file moves to the front of history', async () => {
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: 'root-a' }, name: 'A' }];
  let skipped = ['a.json', 'b.json'];
  git.isInsideGitRepo = async () => true;
  git.listSkippedFiles = async () => skipped;
  const service = new SkippedFilesService(state());
  const recent = new RecentlySkippedFilesTreeProvider();
  const current = new SkippedFilesTreeProvider(service, recent);

  await current.initialize();
  skipped = [];
  await current.reload();
  assert.deepEqual(recent.getChildren().map((item) => item.relativePath), ['a.json', 'b.json']);
  skipped = ['b.json'];
  await current.reload();
  skipped = [];
  await current.reload();
  assert.deepEqual(recent.getChildren().map((item) => item.relativePath), ['b.json', 'a.json']);
});

test('a slower earlier refresh cannot overwrite the latest result', async () => {
  let resolveFirst;
  let calls = 0;
  const service = {
    onDidChange: () => {},
    listAll: () => ++calls === 1
      ? new Promise((resolve) => { resolveFirst = resolve; })
      : Promise.resolve([]),
    recordSkipped: async () => {},
    listRecentlySkipped: () => [],
  };
  const recent = new RecentlySkippedFilesTreeProvider();
  const current = new SkippedFilesTreeProvider(service, recent);
  const first = current.reload();
  await current.reload();
  resolveFirst([entry('root-a', 'old.json', 'A')]);
  await first;
  assert.deepEqual(current.getChildren(), []);
});

test('real Git unskip and reskip update the recent section', async () => {
  Object.assign(git, originalGit);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'skip-worktree-test-'));
  try {
    execFileSync('git', ['init', '-q', cwd]);
    fs.writeFileSync(path.join(cwd, 'config.json'), '{}');
    execFileSync('git', ['add', '--', 'config.json'], { cwd });
    await git.runGitSkipWorktree(cwd, 'config.json', true);
    vscode.workspace.workspaceFolders = [{ uri: { fsPath: cwd }, name: 'Repo' }];
    const service = new SkippedFilesService(state());
    const recent = new RecentlySkippedFilesTreeProvider();
    const current = new SkippedFilesTreeProvider(service, recent);

    await current.initialize();
    const entries = current.getChildren();
    assert.equal(entries.length, 1);
    assert.deepEqual(recent.getChildren(), []);
    assert.equal((await service.unskip(entries)).successCount, 1);
    await current.reload();
    assert.deepEqual(recent.getChildren(), [entry(cwd, 'config.json', 'Repo')]);

    await git.runGitSkipWorktree(cwd, 'config.json', true);
    await current.reload();
    assert.deepEqual(recent.getChildren(), []);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('recent-file Skip action validates, skips, and refreshes the sidebar', async () => {
  const folder = { uri: { fsPath: 'root-a' }, name: 'A' };
  const file = entry('root-a', 'config.json', 'A');
  const storage = state();
  await storage.update('recentlySkippedFiles', [file]);
  const commands = new Map();
  const views = new Map();
  const errors = [];
  const warnings = [];
  let blocked = true;
  let skipped = false;
  vscode.workspace.workspaceFolders = [folder];
  vscode.workspace.getWorkspaceFolder = () => folder;
  vscode.workspace.onDidChangeWorkspaceFolders = () => ({});
  vscode.commands.registerCommand = (id, handler) => { commands.set(id, handler); return {}; };
  vscode.window.createStatusBarItem = () => ({ show: () => {} });
  vscode.window.registerTreeDataProvider = (id, provider) => { views.set(id, provider); return {}; };
  vscode.window.showErrorMessage = (message) => errors.push(message);
  vscode.window.showWarningMessage = (message) => warnings.push(message);
  vscode.window.showInformationMessage = () => {};
  git.isInsideGitRepo = async () => true;
  git.listSkippedFiles = async () => skipped ? ['config.json'] : [];
  git.getSkipWorktreeBlockReason = async () => blocked ? 'file is not tracked by git' : undefined;
  git.runGitSkipWorktree = async (cwd, relativePath, skip) => {
    assert.deepEqual([cwd, relativePath, skip], ['root-a', 'config.json', true]);
    skipped = true;
  };

  activate({ workspaceState: storage, subscriptions: [] });
  const recent = views.get('skipWorktree.recentlySkippedFiles');
  await new Promise((resolve) => recent.onDidChangeTreeData(resolve));
  const row = recent.getChildren()[0];
  const treeItem = recent.getTreeItem(row);
  const manifest = require('../package.json');
  assert.ok(manifest.contributes.menus['view/item/context'].some((item) =>
    item.command === 'skipWorktree.skipFromTree' &&
    item.group.startsWith('inline') &&
    item.when.includes(`viewItem == ${treeItem.contextValue}`)
  ));

  const skipFromTree = commands.get('skipWorktree.skipFromTree');
  skipFromTree();
  assert.deepEqual(warnings, ['No file selected.']);
  await skipFromTree(row);
  assert.match(errors[0], /file is not tracked by git/);
  assert.equal(skipped, false);
  assert.deepEqual(recent.getChildren(), [file]);

  blocked = false;
  const refreshed = new Promise((resolve) => recent.onDidChangeTreeData(resolve));
  await skipFromTree(treeItem);
  await refreshed;
  assert.equal(skipped, true);
  assert.deepEqual(recent.getChildren(), []);
  assert.equal(views.get('skipWorktree.skippedFiles').getChildren().length, 1);
});

test('Source Control action skips selected tracked files and reports untracked files', async () => {
  Object.assign(git, originalGit);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'skip-worktree-scm-test-'));
  try {
    execFileSync('git', ['init', '-q', cwd]);
    for (const name of ['a.json', 'b.json', 'untracked.json']) {
      fs.writeFileSync(path.join(cwd, name), '{}');
    }
    execFileSync('git', ['add', '--', 'a.json', 'b.json'], { cwd });

    const folder = { uri: { fsPath: cwd }, name: 'Repo' };
    const commands = new Map();
    const views = new Map();
    const errors = [];
    const warnings = [];
    let statusUpdated;
    vscode.workspace.workspaceFolders = [folder];
    vscode.workspace.getWorkspaceFolder = () => folder;
    vscode.workspace.onDidChangeWorkspaceFolders = () => ({});
    vscode.commands.registerCommand = (id, handler) => { commands.set(id, handler); return {}; };
    vscode.window.createStatusBarItem = () => ({
      show: () => { if (statusUpdated) { statusUpdated(); } },
    });
    vscode.window.registerTreeDataProvider = (id, provider) => { views.set(id, provider); return {}; };
    vscode.window.showErrorMessage = (message) => errors.push(message);
    vscode.window.showWarningMessage = (message) => warnings.push(message);
    vscode.window.showInformationMessage = () => {};
    const initialStatus = new Promise((resolve) => { statusUpdated = resolve; });
    activate({ workspaceState: state(), subscriptions: [] });
    const recent = views.get('skipWorktree.recentlySkippedFiles');
    await Promise.all([initialStatus, new Promise((resolve) => recent.onDidChangeTreeData(resolve))]);

    const menu = require('../package.json').contributes.menus['scm/resourceState/context'];
    assert.ok(menu.some((item) =>
      item.command === 'skipWorktree.skipFromScm' &&
      item.when === 'scmProvider == git && scmResourceGroup == workingTree' &&
      item.group.startsWith('inline')
    ));
    const skipFromScm = commands.get('skipWorktree.skipFromScm');
    skipFromScm({ resourceUri: undefined });
    assert.match(warnings[0], /valid source control files/);
    const refreshed = new Promise((resolve) => recent.onDidChangeTreeData(resolve));
    const updatedStatus = new Promise((resolve) => { statusUpdated = resolve; });
    await skipFromScm(
      { resourceUri: vscode.Uri.file(path.join(cwd, 'a.json')) },
      { resourceUri: vscode.Uri.file(path.join(cwd, 'b.json')) },
      { resourceUri: vscode.Uri.file(path.join(cwd, 'untracked.json')) }
    );
    await Promise.all([refreshed, updatedStatus]);
    assert.deepEqual(await git.listSkippedFiles(cwd), ['a.json', 'b.json']);
    assert.match(errors[0], /untracked\.json: file is not tracked by git/);
    assert.equal(views.get('skipWorktree.skippedFiles').getChildren().length, 2);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
