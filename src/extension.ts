import * as path from 'node:path';
import * as vscode from 'vscode';
import { getSkipWorktreeBlockReason, runGitSkipWorktree } from './git';
import { SkippedFileEntry } from './types';
import { SkippedFilesService } from './skippedFilesService';
import { SkippedFilesTreeProvider, getEntryFromArgument } from './skippedFilesTree';
import {
  SkippedFilesStatusBar,
  openSkippedFile,
  showSkippedFilesQuickPick,
  unskipFromTree,
} from './skippedFilesUi';

function getRelativePath(uri: vscode.Uri): { cwd: string; relativePath: string } | undefined {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (!workspaceFolder) {
    return undefined;
  }

  const relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return undefined;
  }

  return {
    cwd: workspaceFolder.uri.fsPath,
    relativePath: relativePath.split(path.sep).join('/'),
  };
}

function getSelectedResources(
  uri: vscode.Uri | undefined,
  uris: vscode.Uri[] | undefined
): vscode.Uri[] {
  if (uris && uris.length > 0) {
    return uris;
  }
  return uri ? [uri] : [];
}

export function activate(context: vscode.ExtensionContext): void {
  const service = new SkippedFilesService();
  const treeProvider = new SkippedFilesTreeProvider(service);
  const statusBar = new SkippedFilesStatusBar(service);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('skipWorktree.skippedFiles', treeProvider)
  );

  statusBar.register(context);

  const refreshAll = (): void => {
    service.refresh();
  };

  async function updateSkipWorktree(
    resources: vscode.Uri[],
    skip: boolean
  ): Promise<void> {
    if (resources.length === 0) {
      vscode.window.showWarningMessage('No file selected.');
      return;
    }

    const failures: string[] = [];
    let successCount = 0;

    for (const resource of resources) {
      const resolved = getRelativePath(resource);
      if (!resolved) {
        failures.push(`${path.basename(resource.fsPath)}: file is outside the workspace`);
        continue;
      }

      const blockReason = await getSkipWorktreeBlockReason(
        resolved.cwd,
        resolved.relativePath
      );
      if (blockReason) {
        failures.push(`${resolved.relativePath}: ${blockReason}`);
        continue;
      }

      try {
        await runGitSkipWorktree(resolved.cwd, resolved.relativePath, skip);
        successCount += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${resolved.relativePath}: ${message}`);
      }
    }

    const action = skip ? 'skipped' : 'unskipped';

    if (successCount > 0) {
      service.refresh();
      const label =
        successCount === 1
          ? `1 file ${action} with skip-worktree`
          : `${successCount} files ${action} with skip-worktree`;
      vscode.window.showInformationMessage(label);
    }

    if (failures.length > 0) {
      vscode.window.showErrorMessage(
        `Failed to update skip-worktree for ${failures.length} file(s):\n${failures.join('\n')}`
      );
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'skipWorktree.skipFile',
      (uri: vscode.Uri, uris?: vscode.Uri[]) =>
        updateSkipWorktree(getSelectedResources(uri, uris), true)
    ),
    vscode.commands.registerCommand(
      'skipWorktree.unskipFile',
      (uri: vscode.Uri, uris?: vscode.Uri[]) =>
        updateSkipWorktree(getSelectedResources(uri, uris), false)
    ),
    vscode.commands.registerCommand('skipWorktree.showSkippedFiles', () =>
      showSkippedFilesQuickPick(service)
    ),
    vscode.commands.registerCommand('skipWorktree.unskipAll', async () => {
      const entries = await service.listAll();
      const result = await service.confirmAndUnskipAll(entries);
      if (result) {
        service.reportUnskipResult(result);
      }
    }),
    vscode.commands.registerCommand('skipWorktree.refresh', refreshAll),
    vscode.commands.registerCommand(
      'skipWorktree.openSkippedFile',
      (arg: vscode.TreeItem | SkippedFileEntry) => {
        const entry = getEntryFromArgument(arg);
        if (entry) {
          return openSkippedFile(entry);
        }
      }
    ),
    vscode.commands.registerCommand(
      'skipWorktree.unskipFromTree',
      (arg: vscode.TreeItem | SkippedFileEntry) => {
        const entry = getEntryFromArgument(arg);
        if (entry) {
          return unskipFromTree(service, entry);
        }
      }
    ),
    vscode.workspace.onDidChangeWorkspaceFolders(refreshAll)
  );

  void treeProvider.initialize();
}

export function deactivate(): void {}
