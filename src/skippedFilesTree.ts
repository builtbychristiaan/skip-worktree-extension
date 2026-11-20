import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  entryUri,
  entryKey,
  formatEntryDescription,
  formatEntryLabel,
  isMultiRootWorkspace,
  SkippedFilesService,
} from './skippedFilesService';
import { SkippedFileEntry } from './types';

type SkippedTreeElement = SkippedFileEntry | WorkspaceFolderGroup;

interface WorkspaceFolderGroup {
  kind: 'workspaceFolder';
  name: string;
  entries: SkippedFileEntry[];
}

function isWorkspaceFolderGroup(element: SkippedTreeElement): element is WorkspaceFolderGroup {
  return 'kind' in element && element.kind === 'workspaceFolder';
}

export class SkippedFilesTreeProvider
  implements vscode.TreeDataProvider<SkippedTreeElement>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    SkippedTreeElement | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private entries: SkippedFileEntry[] = [];
  private reloadVersion = 0;

  constructor(
    private readonly service: SkippedFilesService,
    private readonly recentTree: RecentlySkippedFilesTreeProvider
  ) {
    service.onDidChange(() => {
      void this.reload();
    });
  }

  async initialize(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    const version = ++this.reloadVersion;
    try {
      const entries = await this.service.listAll();
      if (version !== this.reloadVersion) {
        return;
      }
      try {
        const previousKeys = new Set(this.entries.map(entryKey));
        const newlySkipped = entries.filter(
          (entry) => !previousKeys.has(entryKey(entry))
        );
        await this.service.recordSkipped(newlySkipped, true);
        await this.service.recordSkipped(entries, false);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Failed to save recently skipped files: ${message}`);
      }
      if (version !== this.reloadVersion) {
        return;
      }
      this.entries = entries;
      this.recentTree.setEntries(this.service.listRecentlySkipped(entries));
      this._onDidChangeTreeData.fire(undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Failed to refresh skipped files: ${message}`);
    }
  }

  getTreeItem(element: SkippedTreeElement): vscode.TreeItem {
    if (isWorkspaceFolderGroup(element)) {
      const item = new vscode.TreeItem(
        element.name,
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.contextValue = 'skippedFolder';
      item.iconPath = new vscode.ThemeIcon('folder');
      item.description = `${element.entries.length} skipped`;
      return item;
    }

    const item = new vscode.TreeItem(
      formatEntryLabel(element),
      vscode.TreeItemCollapsibleState.None
    );
    item.resourceUri = entryUri(element);
    item.description = formatEntryDescription(element);
    item.contextValue = 'skippedFile';
    item.iconPath = new vscode.ThemeIcon('file');
    item.tooltip = element.relativePath;
    item.command = {
      command: 'skipWorktree.openSkippedFile',
      title: 'Open File',
      arguments: [element],
    };
    return item;
  }

  getChildren(element?: SkippedTreeElement): SkippedTreeElement[] {
    if (element) {
      if (isWorkspaceFolderGroup(element)) {
        return element.entries;
      }
      return [];
    }

    if (this.entries.length === 0) {
      return [];
    }

    if (isMultiRootWorkspace()) {
      const groups = new Map<string, SkippedFileEntry[]>();
      for (const entry of this.entries) {
        const existing = groups.get(entry.workspaceFolderName) ?? [];
        existing.push(entry);
        groups.set(entry.workspaceFolderName, existing);
      }

      return [...groups.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, entries]) => ({
          kind: 'workspaceFolder' as const,
          name,
          entries,
        }));
    }

    return this.entries;
  }

  getEntryFromTreeItem(element: SkippedTreeElement): SkippedFileEntry | undefined {
    if (isWorkspaceFolderGroup(element)) {
      return undefined;
    }
    return element;
  }
}

export class RecentlySkippedFilesTreeProvider
  implements vscode.TreeDataProvider<SkippedFileEntry>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private entries: SkippedFileEntry[] = [];

  setEntries(entries: SkippedFileEntry[]): void {
    this.entries = entries;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(entry: SkippedFileEntry): vscode.TreeItem {
    const item = new vscode.TreeItem(formatEntryLabel(entry), vscode.TreeItemCollapsibleState.None);
    item.resourceUri = entryUri(entry);
    item.description = formatEntryDescription(entry);
    item.contextValue = 'recentlySkippedFile';
    item.iconPath = new vscode.ThemeIcon('file');
    item.tooltip = entry.relativePath;
    item.command = {
      command: 'skipWorktree.openSkippedFile',
      title: 'Open File',
      arguments: [entry],
    };
    return item;
  }

  getChildren(): SkippedFileEntry[] {
    return this.entries;
  }
}

export function getEntryFromArgument(
  arg: SkippedFileEntry | vscode.TreeItem
): SkippedFileEntry | undefined {
  if ('relativePath' in arg && 'cwd' in arg) {
    return arg;
  }

  if (arg instanceof vscode.TreeItem && arg.resourceUri) {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(arg.resourceUri);
    if (!workspaceFolder) {
      return undefined;
    }

    const relativePath = path
      .relative(workspaceFolder.uri.fsPath, arg.resourceUri.fsPath)
      .split(path.sep)
      .join('/');

    return {
      cwd: workspaceFolder.uri.fsPath,
      relativePath,
      workspaceFolderName: workspaceFolder.name,
    };
  }

  return undefined;
}
