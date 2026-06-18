import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function runGit(
  cwd: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', args, { cwd });
}

export async function isInsideGitRepo(cwd: string): Promise<boolean> {
  try {
    const { stdout } = await runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

export async function isFileTracked(cwd: string, relativePath: string): Promise<boolean> {
  try {
    await runGit(cwd, ['ls-files', '--error-unmatch', '--', relativePath]);
    return true;
  } catch {
    return false;
  }
}

export async function isFileIgnored(cwd: string, relativePath: string): Promise<boolean> {
  try {
    await runGit(cwd, ['check-ignore', '-q', '--', relativePath]);
    return true;
  } catch {
    return false;
  }
}

export async function getSkipWorktreeBlockReason(
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

export async function runGitSkipWorktree(
  cwd: string,
  relativePath: string,
  skip: boolean
): Promise<void> {
  const flag = skip ? '--skip-worktree' : '--no-skip-worktree';
  await runGit(cwd, ['update-index', flag, relativePath]);
}

export async function listSkippedFiles(cwd: string): Promise<string[]> {
  const { stdout } = await runGit(cwd, ['ls-files', '-v']);
  return stdout
    .split('\n')
    .filter((line) => line.startsWith('S '))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}
