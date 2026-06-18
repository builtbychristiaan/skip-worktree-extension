import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  entryUri,
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

  constructor(private readonly service: SkippedFilesService) {
    service.onDidChange(() => {
      void this.reload();
    });
  }

  async initialize(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    this.entries = await this.service.listAll();
    this._onDidChangeTreeData.fire(undefined);
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
