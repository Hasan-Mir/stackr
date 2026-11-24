# Stackr

[![Current Version](https://vsmarketplacebadges.dev/version/erclx.ai-context-stacker.svg)](https://marketplace.visualstudio.com/items?itemName=erclx.ai-context-stacker)
[![VS Code Marketplace Installs](https://vsmarketplacebadges.dev/installs/erclx.ai-context-stacker.svg)](https://marketplace.visualstudio.com/items?itemName=erclx.ai-context-stacker)
[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/erclx/ai-context-stacker.svg?label=openvsx&cacheSeconds=3600)](https://open-vsx.org/extension/erclx/ai-context-stacker)

Prepare file context and directory maps for models like ChatGPT, Claude, or Gemini within VS Code. Drag files into organized tracks to copy project context in one action.

<p align="center">
  <img src="https://github.com/erclx/stackr/raw/main/demos/hero.gif" alt="Drag and Drop Demo" width="800" />
</p>

## Quick start

1. **Install** the extension from the VS Code Marketplace.
2. **Open** the Stackr view in the Activity Bar.
3. **Stage files** by dragging them into the Staged Files panel, or right-click any file in the Explorer to add it directly.
4. **Quick add** files with <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>A</kbd> / <kbd>Cmd</kbd>+<kbd>Opt</kbd>+<kbd>A</kbd>. Use <kbd>Ctrl</kbd>+<kbd>A</kbd> to select all or <kbd>Ctrl</kbd>+<kbd>Space</kbd> to toggle individual items in the picker.
5. **Preview** the context with <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> / <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd>.
6. **Copy** with <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> / <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> when focused on the Staged Files view.
7. **Paste** into the model.

Press <kbd>F1</kbd> and type "Stackr" to see all available commands.

## Features

### File staging

- **Multiple ways to stage:** drag and drop files or folders, use the file/folder pickers, or add from Explorer, Git SCM, and editor tabs (including multi-selected tabs)
- **Open editors:** add all open files, exclude pinned tabs, add only the active editor group, or pick specific open tabs
- **Git and Problems:** stage all Git changed files, Git staged files, files changed vs a branch, or files with diagnostics
- **Fuzzy search:** search staged files by name (VS Code Quick Open style) to check if a file is in the stack, or toggle workspace results to check and add unstaged files
- **Token counting:** live counts as you type, with large files analyzed in the background, or disable estimation when you only need a Context Map
- **Auto-reveal:** automatically reveals and selects the active editor file in the Staged Files view
- **Persistence and portability:** stores tracks in VS Code `workspaceState` or `.vscode/stackr.json` (`storageMode`), plus JSON export/import across devices
- **Folder syncing:** rescan all staged folders or sync individual folders from their context menu
- **Auto-sync:** renames and deletes reflect automatically as the project structure changes
- **Multi-root support:** works with GitHub Codespaces, WSL2, and SSH Remote sessions

### Context tracks

Create separate tracks for different tasks, for example "Bug Fix #123" or "Refactor Auth." Each track maintains its own staged file list.

- Switch tracks with <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>S</kbd> / <kbd>Cmd</kbd>+<kbd>Opt</kbd>+<kbd>S</kbd>
- Rename inline with <kbd>F2</kbd>
- Reorder by dragging or with <kbd>Alt</kbd>+<kbd>↑↓</kbd> / <kbd>Option</kbd>+<kbd>↑↓</kbd>
- Clear unpinned files from any track using the inline **Clear Stack** icon or track context menu
- Copy or move staged files between tracks via context menu or by dragging items onto a track
- Open all files in a track as editor tabs at once

### Pinning, sorting, and filtering

- Pin files to keep them through a **Clear Stack**
- **Show Pinned Only** filters the view, and copy commands respect that filter
- Sort staged files by name or by token count (highest first) while keeping pinned items at the top
- Press <kbd>Space</kbd> to toggle pin on selected files

### Context map and export

Copied output optionally includes an ASCII directory tree:

```plaintext
# Context Map

├── components
│   ├── Header.tsx
│   └── Footer.tsx
└── utils
    └── api.ts
```

- **Copy Context Map Only:** copy just the ASCII tree without reading file contents
- **Export Stack as Zip:** package all staged files into a `.zip` archive mirroring their workspace paths

### Token warnings

- **Amber** above 5,000 tokens
- **Red** above 10,000 tokens

Both thresholds are configurable in settings.

## Commands

The most common commands and their default keybindings. Press <kbd>F1</kbd> and type "Stackr" to see the full list.

| Command                   | Description                                        | Keybinding                                                                                   |
| :------------------------ | :------------------------------------------------- | :------------------------------------------------------------------------------------------- |
| `Copy Stack`              | Copy all staged content respecting active filters. | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> / <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> |
| `Copy and Clear Stack`    | Copy context then clear unpinned files.            | <kbd>Ctrl</kbd>+<kbd>X</kbd> / <kbd>Cmd</kbd>+<kbd>X</kbd> (when focused)                    |
| `Preview Context`         | Open a Markdown preview of the current stack.      | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> / <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> |
| `Add Files...`            | Open the file picker.                              | <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>A</kbd> / <kbd>Cmd</kbd>+<kbd>Opt</kbd>+<kbd>A</kbd>     |
| `Add Folder...`           | Open the folder picker.                            | <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd> / <kbd>Cmd</kbd>+<kbd>Opt</kbd>+<kbd>F</kbd>     |
| `New Track...`            | Create a new context track.                        | <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>K</kbd> / <kbd>Cmd</kbd>+<kbd>Opt</kbd>+<kbd>K</kbd>     |
| `Switch Track...`         | Switch the active track.                           | <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>S</kbd> / <kbd>Cmd</kbd>+<kbd>Opt</kbd>+<kbd>S</kbd>     |
| `Sync All Staged Folders` | Rescan staged folders for new files.               | <kbd>Ctrl</kbd>+<kbd>R</kbd> / <kbd>Cmd</kbd>+<kbd>R</kbd> (when focused)                    |
| `Clear Stack`             | Remove all unpinned files from the active stack.   | <kbd>Shift</kbd>+<kbd>Delete</kbd> / <kbd>Shift</kbd>+<kbd>Cmd</kbd>+<kbd>Backspace</kbd>    |

Additional commands available from the Command Palette (`Stackr: ...`) and view menus:

- **Staging:** `Add All Open Files`, `Add All Open Files (Exclude Pinned Tabs)`, `Add All Open Files in Active Group`, `Add Open Tabs to Stackr...`, `Add All Git Changed Files`, `Add Git Staged Files`, `Add Git Files Changed vs Branch...`, `Add Files with Problems...`
- **Search and sorting:** `Search Files in Stack...`, `Sort by Token Count`, `Sort by Name`, `Show Pinned Files Only`, `Show All Files`
- **Tracks:** `Clear Stack` (per track), `Open All Files in Track`, `Copy to Track...`, `Move to Track...`
- **Output and portability:** `Copy Context Map Only`, `Toggle Token Estimation`, `Export Stack as Zip...`, `Export Stackr Data...`, `Import Stackr Data...`

## Settings

All settings are prefixed with `aiContextStacker` in `settings.json`.

| Setting                                   | Default           | Description                                                                    |
| :---------------------------------------- | :---------------- | :----------------------------------------------------------------------------- |
| `aiContextStacker.autoReveal`             | `true`            | Automatically reveal and select the active editor file in Staged Files.        |
| `aiContextStacker.enableTokenEstimation`  | `true`            | Estimate token counts for staged files. Disable to skip reading contents.      |
| `aiContextStacker.storageMode`            | `workspaceState`  | Persist tracks in `workspaceState` or `.vscode/stackr.json` (`workspaceFile`). |
| `aiContextStacker.sortOrder`              | `name`            | Sort staged items by `name` or `tokensDesc` (pinned items stay first).         |
| `aiContextStacker.excludes`               | `[]`              | Glob patterns to exclude from file operations.                                 |
| `aiContextStacker.defaultExcludes`        | Built-in globs    | Base exclude patterns (`node_modules`, `.git`, `dist`, lock files, etc.).      |
| `aiContextStacker.largeFileThreshold`     | `5000`            | Token count for the amber warning. Red at 2x this value.                       |
| `aiContextStacker.showTreeMap`            | `true`            | Include the ASCII directory tree in copied output.                             |
| `aiContextStacker.showTreeMapHeader`      | `true`            | Show the header above the tree map.                                            |
| `aiContextStacker.treeMapText`            | `# Context Map`   | Custom header text for the tree map.                                           |
| `aiContextStacker.includeFileContents`    | `true`            | Include file contents in copied output.                                        |
| `aiContextStacker.showFileContentsHeader` | `true`            | Show the header above file contents.                                           |
| `aiContextStacker.fileContentsText`       | `# File Contents` | Custom header text for file contents.                                          |
| `aiContextStacker.logLevel`               | `INFO`            | Output channel verbosity. Options: `DEBUG`, `INFO`, `WARN`, `ERROR`.           |

## Known limitations

- Output is capped at 100MB
- Files over 5MB are excluded from context
- Token counts are approximate and may differ from model-specific tokenizers
- Binary files are skipped automatically

## Support

- **Issues:** [GitHub Issues](https://github.com/erclx/stackr/issues)
- **Changelog:** [CHANGELOG.md](CHANGELOG.md)

## License

[MIT](LICENSE)
