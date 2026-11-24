# Requirements

Describe what the product does and why. How it works lives in ARCHITECTURE.md. Update this doc when scope changes, goals shift, or a non-goal is promoted to a feature.

What belongs:

- The problem being solved and for whom
- User-facing goals stated as outcomes, not implementation
- Explicit non-goals: scope boundaries that prevent feature creep. Mark deferred items "(deferred)" to signal they are not permanently excluded.
- MVP features as a numbered list of feature names with one-line descriptions, no implementation detail
- Tech stack as a plain list of tools, with rationale in ARCHITECTURE.md
- Hard constraints that shape all decisions

What does not belong:

- Implementation details, API names, or internal component references
- Rationale for tech choices, which lives in ARCHITECTURE.md
- Anything that describes how a feature is built rather than what it does

## Problem

Developers using AI assistants need to assemble relevant file contents into a single block of text. Copy-pasting files manually is repetitive and loses context across sessions. There is no native VS Code mechanism to stage a named group of files and copy their combined content.

## Goals

- Stage files into named tracks and switch between them without losing context
- Copy the combined content of the active stack to the clipboard with one action
- State persists per workspace across VS Code sessions
- Minimize friction: adding a file, switching a track, or copying context each take one step

## Non-goals

- Making AI API calls or integrating with any external AI service
- Editing file contents from within the extension
- Inline diff views (deferred)

## MVP features

1. Stage files: add files individually, by folder, from open editors (all, unpinned, active group, or picker), from Git changes/diffs, or from Problems diagnostics
2. Remove and clear: remove staged files individually or by folder, or clear unpinned files from the active stack or any track
3. Search stack: fuzzy search staged files by name (and optionally check workspace files for stack membership)
4. Named tracks: create, rename, delete, clear, and switch between named tracks, or open all files in a track
5. Track ordering and transfer: reorder tracks via drag-and-drop or move-up/move-down, and copy or move staged files across tracks
6. Copy and export: copy combined content or Context Map only to clipboard, copy and clear in one action, or export staged files as a ZIP archive
7. Pin files: pinned files survive clear operations and remain until explicitly removed
8. Token counts: per-file and total estimates (optional toggle), with heavy and critical files flagged by threshold
9. Status bar: show the active track name and total token count
10. Preview: render the combined context in a webview panel before copying
11. File lifecycle: auto-update or remove staged files when they are renamed or deleted on disk
12. Folder sync and auto-reveal: re-scan staged folders for new files, and reveal the active editor file in the Staged Files view
13. Filter and sort: toggle a pinned-only view, and sort by name or token count
14. Portability: persist to `workspaceState` or `.vscode/stackr.json`, and export/import tracks as JSON

## Tech stack

- VS Code extension API
- TypeScript
- esbuild (bundler)
- `@vscode/test-cli` (test runner)
- sinon (stubs in tests)

## Constraints

- `workspaceState` storage cap: 100KB hard limit per workspace (bypassed when `storageMode` is set to `workspaceFile`)
- Must work fully offline with no network access
- No new runtime dependencies without strong justification, preferring VS Code native APIs and Node built-ins
- Must not affect VS Code startup time, so activation is event-driven
