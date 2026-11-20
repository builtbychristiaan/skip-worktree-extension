import * as path from 'node:path';
import * as vscode from 'vscode';
import { getSkipWorktreeBlockReason, runGitSkipWorktree } from './git';
import { SkippedFileEntry } from './types';
import { entryUri, SkippedFilesService } from './skippedFilesService';
import {
  RecentlySkippedFilesTreeProvider,
  SkippedFilesTreeProvider,
  getEntryFromArgument,
} from './skippedFilesTree';
import {
  SkippedFilesStatusBar,
  openSkippedFile,
  showSkippedFilesQuickPick,
  unskipFromTree,
} from './skippedFilesUi';

function getRelativePath(uri: vscode.Uri): {
  cwd: string;
  relativePath: string;
  workspaceFolderName: string;
} | undefined {
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
    workspaceFolderName: workspaceFolder.name,
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
  const service = new SkippedFilesService(context.workspaceState);
  const recentTree = new RecentlySkippedFilesTreeProvider();
  const treeProvider = new SkippedFilesTreeProvider(service, recentTree);
  const statusBar = new SkippedFilesStatusBar(service);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('skipWorktree.skippedFiles', treeProvider),
    vscode.window.registerTreeDataProvider('skipWorktree.recentlySkippedFiles', recentTree)
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
    const skippedEntries: SkippedFileEntry[] = [];
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
        if (skip) {
          skippedEntries.push(resolved);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${resolved.relativePath}: ${message}`);
      }
    }

    const action = skip ? 'skipped' : 'unskipped';

    if (successCount > 0) {
      if (skippedEntries.length > 0) {
        try {
          await service.recordSkipped(skippedEntries, true);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          void vscode.window.showErrorMessage(`Failed to save recently skipped files: ${message}`);
        }
      }
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
    vscode.commands.registerCommand(
      'skipWorktree.skipFromTree',
      (arg?: vscode.TreeItem | SkippedFileEntry) => {
        const entry = arg ? getEntryFromArgument(arg) : undefined;
        if (!entry) {
          void vscode.window.showWarningMessage('No file selected.');
          return;
        }
        return updateSkipWorktree([entryUri(entry)], true);
      }
    ),
    vscode.workspace.onDidChangeWorkspaceFolders(refreshAll)
  );

  void treeProvider.initialize();
}

export function deactivate(): void {}
