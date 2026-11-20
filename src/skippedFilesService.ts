import * as vscode from 'vscode';
import { isInsideGitRepo, listSkippedFiles, runGitSkipWorktree } from './git';
import { SkippedFileEntry, UnskipResult } from './types';

export class SkippedFilesService {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;
  private recentEntries: SkippedFileEntry[];
  private historyUpdate: Promise<void> = Promise.resolve();

  constructor(private readonly workspaceState: vscode.Memento) {
    this.recentEntries = workspaceState.get<SkippedFileEntry[]>('recentlySkippedFiles', []);
  }

  refresh(): void {
    this._onDidChange.fire();
  }

  async listAll(): Promise<SkippedFileEntry[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const entries: SkippedFileEntry[] = [];

    for (const folder of folders) {
      const cwd = folder.uri.fsPath;
      if (!(await isInsideGitRepo(cwd))) {
        continue;
      }

      const skipped = await listSkippedFiles(cwd);
      for (const relativePath of skipped) {
        entries.push({
          cwd,
          relativePath,
          workspaceFolderName: folder.name,
        });
      }
    }

    entries.sort((a, b) => {
      const folderCompare = a.workspaceFolderName.localeCompare(b.workspaceFolderName);
      if (folderCompare !== 0) {
        return folderCompare;
      }
      return a.relativePath.localeCompare(b.relativePath);
    });

    return entries;
  }

  recordSkipped(entries: SkippedFileEntry[], moveToFront: boolean): Promise<void> {
    const update = this.historyUpdate.then(() => this.writeSkipped(entries, moveToFront));
    this.historyUpdate = update.then(() => undefined, () => undefined);
    return update;
  }

  private async writeSkipped(entries: SkippedFileEntry[], moveToFront: boolean): Promise<void> {
    const uniqueEntries = [...new Map(entries.map((entry) => [entryKey(entry), entry])).values()];
    const existingKeys = new Set(this.recentEntries.map(entryKey));
    const newEntries = moveToFront
      ? uniqueEntries
      : uniqueEntries.filter((entry) => !existingKeys.has(entryKey(entry)));

    if (newEntries.length === 0) {
      return;
    }

    const replacedKeys = new Set(newEntries.map(entryKey));
    const updatedEntries = [
      ...newEntries,
      ...this.recentEntries.filter((entry) => !replacedKeys.has(entryKey(entry))),
    ];
    await this.workspaceState.update('recentlySkippedFiles', updatedEntries);
    this.recentEntries = updatedEntries;
  }

  listRecentlySkipped(currentEntries: SkippedFileEntry[]): SkippedFileEntry[] {
    const currentKeys = new Set(currentEntries.map(entryKey));
    const folders = new Map(
      (vscode.workspace.workspaceFolders ?? []).map((folder) => [folder.uri.fsPath, folder.name])
    );

    return this.recentEntries
      .filter((entry) => folders.has(entry.cwd) && !currentKeys.has(entryKey(entry)))
      .map((entry) => ({ ...entry, workspaceFolderName: folders.get(entry.cwd)! }));
  }

  async unskip(entries: SkippedFileEntry[]): Promise<UnskipResult> {
    const failures: string[] = [];
    let successCount = 0;

    for (const entry of entries) {
      try {
        await runGitSkipWorktree(entry.cwd, entry.relativePath, false);
        successCount += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${entry.relativePath}: ${message}`);
      }
    }

    if (successCount > 0) {
      this.refresh();
    }

    return { successCount, failures };
  }

  async confirmAndUnskipAll(entries: SkippedFileEntry[]): Promise<UnskipResult | undefined> {
    if (entries.length === 0) {
      vscode.window.showInformationMessage('No skip-worktree files found.');
      return undefined;
    }

    const answer = await vscode.window.showWarningMessage(
      `Unskip all ${entries.length} file(s)? Git will track local changes in these files again.`,
      { modal: true },
      'Unskip All'
    );

    if (answer !== 'Unskip All') {
      return undefined;
    }

    return this.unskip(entries);
  }

  reportUnskipResult(result: UnskipResult): void {
    if (result.successCount > 0) {
      const label =
        result.successCount === 1
          ? '1 file unskipped with skip-worktree'
          : `${result.successCount} files unskipped with skip-worktree`;
      vscode.window.showInformationMessage(label);
    }

    if (result.failures.length > 0) {
      vscode.window.showErrorMessage(
        `Failed to unskip ${result.failures.length} file(s):\n${result.failures.join('\n')}`
      );
    }
  }
}

export function entryKey(entry: SkippedFileEntry): string {
  return JSON.stringify([entry.cwd, entry.relativePath]);
}

export function entryUri(entry: SkippedFileEntry): vscode.Uri {
  return vscode.Uri.file(`${entry.cwd}/${entry.relativePath}`);
}

export function isMultiRootWorkspace(): boolean {
  return (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
}

export function formatEntryLabel(entry: SkippedFileEntry): string {
  return entry.relativePath;
}

export function formatEntryDescription(entry: SkippedFileEntry): string | undefined {
  return isMultiRootWorkspace() ? entry.workspaceFolderName : undefined;
}
