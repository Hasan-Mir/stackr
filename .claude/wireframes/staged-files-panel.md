---
title: Staged Files panel
description: Bottom panel in the Stackr activity bar, shows files staged in the active track
---

# Staged Files panel

The bottom panel in the Stackr activity bar container. Shows the files staged in the active track, grouped by folder when two or more files share a parent directory.

## Populated state

```plaintext
STAGED FILES                [+][📁][⊞][📋][👁][↺][✕]
─────────────────────────────────────────────────────
  📌 middleware.ts                          800  ← pinned, at top
  📌 auth.ts                               650
  📁 src/services/
       persistence-service.ts             1.2k
       hydration-service.ts                 900
  routes.ts                                350  ← heavy threshold approaching
─────────────────────────────────────────────────────
  Total: 3.9k tokens
```

## Empty state

```plaintext
STAGED FILES                [+][📁][⊞]
─────────────────────────────────────
  Add files to your stack →           ← placeholder, non-interactive
```

## Pinned-only filter active, no matching files

```plaintext
STAGED FILES  [filter active]
─────────────────────────────
  No files match your filter  ← shown when filter is on but no files are pinned
```

## Behavior

- `[+]` opens the file picker to add files
- `[🔍]` opens the fuzzy file search (`Search Files in Stack...`), with a toggle to also inspect unstaged workspace files (`In Stack` / `Not in Stack`)
- `[📁]` opens the folder picker to add all files in a folder (respects ignore patterns)
- Open editor commands in the overflow menu add all open files, unpinned open files only, active editor group files only, or selected open tabs via picker
- Git and diagnostics commands in the overflow menu add changed files, staged files, branch diff files, and files with Problems
- `[📋]` copies the full stack to the clipboard. Overflow actions also support `Copy Context Map Only` and `Export Stack as Zip...`
- `[👁]` opens the preview webview
- `[↺]` re-scans all staged folders for new files
- `[✕]` clears all unpinned files. Pinned files stay
- Pinned files sort to the top of the list. Remaining items sort by name or by token count descending (`Sort by Token Count` / `Sort by Name`)
- Token count renders as a placeholder while analysis runs, then updates in place (or hides when token estimation is toggled off)
- Files above the large-file threshold (default 5000 tokens) show a warning decoration. Files above 2x the threshold show an error decoration
- Right-clicking a file or folder opens a context menu with: Copy Content, Sync Folder (folders), Toggle Pin, Copy to Track..., Move to Track..., Reveal in Explorer, Remove from Stack
- Dragging items onto a track in the Context Tracks panel moves those files to the target track. Auto-reveal highlights the active editor file in the tree when enabled
