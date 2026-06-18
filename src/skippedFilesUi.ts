import * as vscode from 'vscode';
import {
  entryUri,
  formatEntryDescription,
  formatEntryLabel,
  SkippedFilesService,
} from './skippedFilesService';
import { SkippedFileEntry } from './types';

interface SkippedQuickPickItem extends vscode.QuickPickItem {
  entry?: SkippedFileEntry;
  unskipAll?: boolean;
}

export class SkippedFilesStatusBar {
  private readonly item: vscode.StatusBarItem;
  private readonly service: SkippedFilesService;

  constructor(service: SkippedFilesService) {
    this.service = service;
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this.item.command = 'skipWorktree.showSkippedFiles';
    service.onDidChange(() => {
      void this.update();
    });
  }

  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(this.item);
    void this.update();
  }

  async update(): Promise<void> {
    const entries = await this.service.listAll();
    const count = entries.length;

    if (count === 0) {
      this.item.text = '$(eye-closed) No skipped files';
      this.item.tooltip = 'Show skip-worktree files';
    } else {
      this.item.text =
        count === 1 ? '$(eye-closed) 1 skipped file' : `$(eye-closed) ${count} skipped files`;
      this.item.tooltip = 'Show skip-worktree files — click to manage';
    }

    this.item.show();
  }
}

export async function showSkippedFilesQuickPick(
  service: SkippedFilesService
): Promise<void> {
  const entries = await service.listAll();

  if (entries.length === 0) {
    vscode.window.showInformationMessage('No skip-worktree files found.');
    return;
  }

  const quickPick = vscode.window.createQuickPick<SkippedQuickPickItem>();
  quickPick.title = 'Skipped Files (skip-worktree)';
  quickPick.placeholder = 'Select file(s) to unskip, or use the toolbar buttons';
  quickPick.canSelectMany = true;
  quickPick.matchOnDescription = true;

  const unskipAllItem: SkippedQuickPickItem = {
    label: `$(close) Unskip all (${entries.length} file${entries.length === 1 ? '' : 's'})`,
    description: 'Requires confirmation',
    alwaysShow: true,
    unskipAll: true,
  };

  quickPick.items = [
    unskipAllItem,
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    ...entries.map(
      (entry): SkippedQuickPickItem => ({
        label: formatEntryLabel(entry),
        description: formatEntryDescription(entry),
        entry,
      })
    ),
  ];

  quickPick.buttons = [
    {
      iconPath: new vscode.ThemeIcon('close'),
      tooltip: 'Unskip selected',
    },
    {
      iconPath: new vscode.ThemeIcon('go-to-file'),
      tooltip: 'Open selected file',
    },
  ];

  quickPick.onDidChangeSelection((selection) => {
    const selectedAll = selection.some((item) => item.unskipAll);
    if (selectedAll && selection.length > 1) {
      quickPick.selectedItems = selection.filter((item) => item.unskipAll);
    }
  });

  const handleUnskip = async (selected: readonly SkippedQuickPickItem[]): Promise<void> => {
    if (selected.some((item) => item.unskipAll)) {
      const result = await service.confirmAndUnskipAll(entries);
      if (result) {
        service.reportUnskipResult(result);
      }
      quickPick.hide();
      return;
    }

    const toUnskip = selected
      .map((item) => item.entry)
      .filter((entry): entry is SkippedFileEntry => entry !== undefined);

    if (toUnskip.length === 0) {
      vscode.window.showWarningMessage('Select at least one file to unskip.');
      return;
    }

    const result = await service.unskip(toUnskip);
    service.reportUnskipResult(result);
    quickPick.hide();
  };

  const handleOpen = (selected: readonly SkippedQuickPickItem[]): void => {
    const fileItems = selected.filter((item) => item.entry);
    if (fileItems.length !== 1) {
      vscode.window.showWarningMessage('Select exactly one file to open.');
      return;
    }

    void vscode.window.showTextDocument(entryUri(fileItems[0].entry!));
  };

  quickPick.onDidTriggerButton(async (button) => {
    if (button.tooltip === 'Unskip selected') {
      await handleUnskip(quickPick.selectedItems);
    } else if (button.tooltip === 'Open selected file') {
      handleOpen(quickPick.selectedItems);
    }
  });

  quickPick.onDidAccept(async () => {
    await handleUnskip(quickPick.selectedItems);
  });

  quickPick.show();
}

export async function openSkippedFile(entry: SkippedFileEntry): Promise<void> {
  await vscode.window.showTextDocument(entryUri(entry));
}

export async function unskipFromTree(
  service: SkippedFilesService,
  entry: SkippedFileEntry
): Promise<void> {
  const result = await service.unskip([entry]);
  service.reportUnskipResult(result);
}
