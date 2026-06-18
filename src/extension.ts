import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';
import * as vscode from 'vscode';

const execFileAsync = promisify(execFile);

async function runGit(
  cwd: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', args, { cwd });
}

async function isInsideGitRepo(cwd: string): Promise<boolean> {
  try {
    const { stdout } = await runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

async function isFileTracked(cwd: string, relativePath: string): Promise<boolean> {
  try {
    await runGit(cwd, ['ls-files', '--error-unmatch', '--', relativePath]);
    return true;
  } catch {
    return false;
  }
}

async function isFileIgnored(cwd: string, relativePath: string): Promise<boolean> {
  try {
    await runGit(cwd, ['check-ignore', '-q', '--', relativePath]);
    return true;
  } catch {
    return false;
  }
}

async function getSkipWorktreeBlockReason(
  cwd: string,
  relativePath: string
): Promise<string | undefined> {
  if (!(await isInsideGitRepo(cwd))) {
    return 'not inside a git repository';
  }

  if (await isFileTracked(cwd, relativePath)) {
    return undefined;
  }

  if (await isFileIgnored(cwd, relativePath)) {
    return 'file is gitignored and not tracked; skip-worktree only applies to tracked files';
  }

  return 'file is not tracked by git; skip-worktree only applies to tracked files';
}

async function runGitSkipWorktree(
  cwd: string,
  relativePath: string,
  skip: boolean
): Promise<void> {
  const flag = skip ? '--skip-worktree' : '--no-skip-worktree';
  await runGit(cwd, ['update-index', flag, relativePath]);
}

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
    )
  );
}

export function deactivate(): void {}
