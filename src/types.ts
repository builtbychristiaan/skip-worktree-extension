export interface SkippedFileEntry {
  cwd: string;
  relativePath: string;
  workspaceFolderName: string;
}

export interface UnskipResult {
  successCount: number;
  failures: string[];
}
