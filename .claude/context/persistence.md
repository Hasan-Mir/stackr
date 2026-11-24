---
title: Persistence
description: workspaceState serialization, fingerprinting, and the 100KB cap behavior
---

# Persistence

## Overview

How `PersistenceService` writes track state to `workspaceState`, how fingerprinting skips redundant writes, and what happens at the 100KB cap.

## Layout

- `src/services/` owns serialization, debouncing, fingerprint comparison, and the save-trigger call on every mutation

## Decisions

- `src/services/persistence-service.ts` owns serialization, debouncing, and fingerprint comparison.
- `src/providers/track-manager.ts` calls `requestSave()` on every mutation and handles portable JSON export/import (`exportTracksData`, `importTracksData`).
- Storage backend is controlled by `aiContextStacker.storageMode`: `workspaceState` (default, 100KB cap) or `workspaceFile` (`.vscode/stackr.json`, no 100KB cap).
- The fingerprint hashes track order, track IDs, track names, file URIs, pin/folder metadata, and the active track ID. Mutations that produce the same fingerprint are skipped.
- Hydration is deferred 10ms via `setTimeout`. This lets the extension activate and register views before the first storage read. Missing files are silently dropped during hydration. No error surfaces to the user.
- `saveImmediate()` exists as an explicit flush for moments where the debounce is unsafe (track switch, track deletion, deactivation, storage mode switch). Normal mutations call `requestSave()` and rely on the 500ms debounce.

## Hidden contracts

- The `workspaceState` storage key is `aiContextStacker.tracks.v1`. The `v1` suffix is a forward-compatibility marker. Schema migrations must bump the key, not transform in place.
- In `workspaceState` mode, save is aborted, not truncated, when serialized JSON exceeds 100KB. A warning message shows, and switching to `workspaceFile` or exporting JSON avoids the limit.
- Debounce is 500ms. Multiple `requestSave()` calls within the window coalesce to a single write. The fingerprint check then decides if that write actually runs.

## Gotchas

- `workspaceState` is per-workspace and per-machine. Use `workspaceFile` (`.vscode/stackr.json`) or `Export Stackr Data...` / `Import Stackr Data...` when sharing tracks across devices.
- Hydration drops missing files silently. A user who renames a file outside VS Code and reopens the workspace will see the file gone from the track, with no notification.
