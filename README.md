# Skip Worktree

**Manage Git skip-worktree flags without leaving VS Code.**

Skip Worktree wraps `git update-index --skip-worktree` in a familiar UI: Explorer context menus, a dedicated sidebar, a status bar indicator, and a command palette quick pick. Keep local edits to tracked config files without them showing up in `git status`—and see every skipped file in one place when you need to undo it.

---

## Why skip-worktree?

Some tracked files need local changes that should never be committed—environment configs, machine-specific settings, or personal overrides of shared files. Adding them to `.gitignore` does not help once Git already tracks them.

`git update-index --skip-worktree <file>` tells Git to ignore local modifications to a tracked file. Your working copy keeps your changes; Git stops reporting them as dirty.

Skip Worktree makes that workflow discoverable and reversible.

| Approach | Good for |
| --- | --- |
| `.gitignore` | Untracked files you never want in the repo |
| `skip-worktree` | Tracked files where you need a permanent local override |
| `assume-unchanged` | Performance hint; not designed for long-term local edits |

> **Note:** Skip-worktree only applies to **tracked** files. Gitignored, untracked, or files outside a repository are rejected with a clear message.

---

## Features

- **Skip / unskip from Explorer** — Right-click any tracked file and choose **Skip File** or **Unskip File**. Multi-select is supported.
- **Skipped Files sidebar** — Activity bar view lists every skip-worktree file in the workspace. Open, unskip inline, refresh, or unskip all from the toolbar.
- **Recently Skipped Files** — The sidebar remembers files observed while skipped and shows them after they are unskipped. Use the inline **Skip** button to skip one again. History is saved per workspace; refresh to pick up Git changes made outside the extension.
- **Status bar** — Shows `No skipped files` or a live count. Click to open the quick pick manager.
- **Command palette quick pick** — Search skipped files, open one, unskip selected, or unskip all with confirmation.
- **Multi-root workspaces** — Files are grouped by workspace folder when you have more than one root open.
- **Safe unskip** — Bulk unskip asks for confirmation so Git starts tracking local changes again only when you mean it.

---

## Installation

### From the Marketplace

Search for **Skip Worktree** in the VS Code Extensions view, or install from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=christiaan-du-preez.skip-worktree).

### From a VSIX (local build)

```bash
npm install
npm run package
code --install-extension skip-worktree-0.1.1.vsix
```

### From source (development)

1. Clone this repository and open it in VS Code.
2. Run **Terminal → Run Task → npm: watch** (or `npm run watch`).
3. Press **F5** to launch an Extension Development Host.

---

## Usage

### Skip a file

1. Right-click a tracked file in the **Explorer**.
2. Choose **Skip File** (category: *Git Skip Worktree*).

Git marks the file with skip-worktree. Local edits stay on disk but no longer appear in source control.
Previously skipped files can also be skipped again using the **Skip** button in the sidebar's **Recently Skipped Files** section.

### Manage skipped files

| Where | What you can do |
| --- | --- |
| **Activity bar → Skip Worktree** | Browse all skipped files; click to open; inline **Unskip**; toolbar refresh / list / unskip all |
| **Status bar** (`eye-closed` icon) | Click to open the quick pick |
| **Command palette** | Run **Git Skip Worktree: Show Skipped Files** |

### Unskip a file

- **Explorer:** Right-click → **Unskip File**
- **Sidebar:** Click the **Unskip** icon on a row, or use the context menu
- **Quick pick:** Select one or more files → accept or click **Unskip selected**
- **Unskip all:** Sidebar toolbar or quick pick → confirm in the modal dialog

---

## Commands

| Command | Description |
| --- | --- |
| `Git Skip Worktree: Skip File` | Mark selected file(s) with skip-worktree |
| `Git Skip Worktree: Unskip File` | Remove skip-worktree from selected file(s) |
| `Git Skip Worktree: Show Skipped Files` | Open quick pick to browse and manage skipped files |
| `Git Skip Worktree: Unskip All Skipped Files` | Remove skip-worktree from every skipped file (with confirmation) |
| `Git Skip Worktree: Refresh` | Reload the skipped-files list |
| `Git Skip Worktree: Open File` | Open a skipped file from the sidebar |
| `Git Skip Worktree: Unskip` | Unskip a single file from the sidebar |
| `Git Skip Worktree: Skip` | Skip a recently skipped file from the sidebar |

---

## Requirements

- [VS Code](https://code.visualstudio.com/) `^1.85.0`
- [Git](https://git-scm.com/) available on your `PATH`
- An open folder that is inside a Git work tree

---

## Development

```bash
npm install          # install dependencies
npm run compile      # one-off TypeScript build
npm run watch        # rebuild on save
npm run package      # create .vsix for distribution
```

### Publishing to the Marketplace

1. [Create a publisher](https://marketplace.visualstudio.com/managecreatepublisher) named `christiaan-du-preez` (must match `publisher` in `package.json`).
2. [Create a Personal Access Token](https://dev.azure.com/) with **Marketplace → Manage** scope.
3. Log in once: `npx vsce login christiaan-du-preez`
4. Publish: `npm run publish`

Update `version` in `package.json` and add an entry to `CHANGELOG.md` before each release.

Project layout:

```
src/
  extension.ts          # activation, commands, skip/unskip orchestration
  git.ts                # git CLI helpers
  skippedFilesService.ts # list, unskip, and refresh logic
  skippedFilesTree.ts   # sidebar tree data provider
  skippedFilesUi.ts     # status bar and quick pick
  types.ts              # shared types
```

---

## License

[MIT](LICENSE.md)
