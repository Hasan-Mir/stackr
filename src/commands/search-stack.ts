import * as vscode from 'vscode'

import { StackTreeItem, StagedFile } from '../models'
import { IgnoreManager, StackProvider, TrackManager } from '../providers'
import { attachPickerToggle, ErrorHandler, scoreFuzzyMatch } from '../utils'
import { Command, CommandDependencies } from './types'

interface SearchFileQuickPickItem extends vscode.QuickPickItem {
  uri: vscode.Uri
  relPath: string
  inStack: boolean
  file?: StagedFile
}

interface SearchActionButtons {
  readonly openInEditor: vscode.QuickInputButton
  readonly removeFromStack: vscode.QuickInputButton
  readonly addToStack: vscode.QuickInputButton
  readonly includeWorkspace: vscode.QuickInputButton
  readonly stackOnly: vscode.QuickInputButton
}

const PATH_OR_MULTI_TERM_REGEX = /[\\/\s]/

export function getSearchStackCommands(deps: CommandDependencies): Command[] {
  const { stackProvider, trackManager, ignoreManager } = deps.services
  const { filesView } = deps.views

  return [
    {
      id: 'aiContextStacker.searchStack',
      execute: ErrorHandler.safeExecute('Search Files in Stack', () =>
        handleSearchStack(stackProvider, trackManager, ignoreManager, filesView),
      ),
    },
  ]
}

export function splitRelativePath(relativePath: string): { fileName: string; dirPath: string; relPath: string } {
  const lastSep = Math.max(relativePath.lastIndexOf('/'), relativePath.lastIndexOf('\\'))
  if (lastSep === -1) {
    return { fileName: relativePath, dirPath: '', relPath: relativePath }
  }

  return {
    fileName: relativePath.slice(lastSep + 1),
    dirPath: relativePath.slice(0, lastSep),
    relPath: relativePath,
  }
}

async function handleSearchStack(
  stackProvider: StackProvider,
  trackManager: TrackManager,
  ignoreManager: IgnoreManager,
  filesView: vscode.TreeView<StackTreeItem>,
): Promise<void> {
  const buttons = createActionButtons()
  const picker = vscode.window.createQuickPick<SearchFileQuickPickItem>()
  const toggleDisposable = attachPickerToggle(picker)

  picker.canSelectMany = false
  picker.matchOnDescription = true
  picker.matchOnDetail = false

  const activeTrack = trackManager.getActiveTrack()
  let includeWorkspace = activeTrack.files.length === 0
  let workspaceUrisCache: vscode.Uri[] | undefined
  let baseItems: SearchFileQuickPickItem[] = []
  let hasCustomAlwaysShow = false
  let isDisposed = false

  const loadWorkspaceUris = async (): Promise<vscode.Uri[]> => {
    if (workspaceUrisCache) {
      return workspaceUrisCache
    }
    const excludePatterns = await ignoreManager.getExcludePatterns()
    workspaceUrisCache = await vscode.workspace.findFiles('**/*', excludePatterns)
    return workspaceUrisCache
  }

  const refreshItems = async (): Promise<void> => {
    const currentTrack = trackManager.getActiveTrack()
    const stagedFiles = currentTrack.files

    picker.buttons = [includeWorkspace ? buttons.stackOnly : buttons.includeWorkspace]

    if (!includeWorkspace) {
      picker.title = `Search Files in Stack — ${currentTrack.name} (${stagedFiles.length} ${stagedFiles.length === 1 ? 'file' : 'files'})`
      picker.placeholder = 'Search files in stack by name (fuzzy match)...'
      baseItems = buildStagedItems(stagedFiles, stackProvider.hasActiveFilters, false, buttons)
    } else {
      picker.title = `Search All Files — ${currentTrack.name} (${stagedFiles.length} in stack)`
      picker.placeholder =
        stagedFiles.length === 0
          ? 'Stack is empty — search workspace files to check or press Enter to add'
          : 'Search workspace files (In Stack / Not in Stack)'
      picker.busy = true
      try {
        const workspaceUris = await loadWorkspaceUris()
        if (isDisposed) return
        baseItems = buildWorkspaceCombinedItems(stagedFiles, workspaceUris, stackProvider.hasActiveFilters, buttons)
      } finally {
        if (!isDisposed) {
          picker.busy = false
        }
      }
    }

    if (isDisposed) return
    applyQueryFilter(picker.value)
  }

  const applyQueryFilter = (value: string): void => {
    if (PATH_OR_MULTI_TERM_REGEX.test(value)) {
      hasCustomAlwaysShow = true
      const scored = baseItems
        .map((item) => ({ item, score: scoreFuzzyMatch(value, item.relPath) }))
        .sort((a, b) => {
          const aMatched = a.score !== undefined ? 1 : 0
          const bMatched = b.score !== undefined ? 1 : 0
          if (aMatched !== bMatched) return bMatched - aMatched
          if (a.score !== undefined && b.score !== undefined && a.score !== b.score) {
            return b.score - a.score
          }
          if (a.item.inStack !== b.item.inStack) return a.item.inStack ? -1 : 1
          return 0
        })

      picker.items = scored.map(({ item, score }) => ({
        ...item,
        alwaysShow: score !== undefined,
      }))
      return
    }

    if (hasCustomAlwaysShow) {
      hasCustomAlwaysShow = false
      picker.items = baseItems.map((item) => (item.alwaysShow ? { ...item, alwaysShow: false } : item))
      return
    }

    picker.items = baseItems
  }

  const disposables: vscode.Disposable[] = [
    toggleDisposable,
    picker.onDidChangeValue((value) => {
      applyQueryFilter(value)
    }),
    picker.onDidTriggerButton(async (button) => {
      if (button === buttons.includeWorkspace || button === buttons.stackOnly) {
        includeWorkspace = !includeWorkspace
        await refreshItems()
      }
    }),
    picker.onDidTriggerItemButton(async ({ item, button }) => {
      if (button === buttons.openInEditor) {
        picker.hide()
        await vscode.window.showTextDocument(item.uri)
        return
      }

      if (button === buttons.removeFromStack && item.file) {
        await stackProvider.removeFiles([item.file])
        vscode.window.setStatusBarMessage(`Removed ${item.label} from stack.`, 2500)
        await refreshItems()
        return
      }

      if (button === buttons.addToStack && !item.inStack) {
        const added = await stackProvider.addFile(item.uri)
        if (added) {
          vscode.window.setStatusBarMessage(`Added ${item.label} to stack.`, 2500)
        }
        await refreshItems()
      }
    }),
    picker.onDidAccept(async () => {
      const selected = picker.selectedItems[0] ?? picker.activeItems[0]
      if (!selected) {
        return
      }

      picker.hide()
      await handleItemSelected(selected, stackProvider, filesView)
    }),
    picker.onDidHide(() => {
      isDisposed = true
      disposables.forEach((d) => d.dispose())
      picker.dispose()
    }),
  ]

  picker.show()
  await refreshItems()
}

async function handleItemSelected(
  selected: SearchFileQuickPickItem,
  stackProvider: StackProvider,
  filesView: vscode.TreeView<StackTreeItem>,
): Promise<void> {
  if (!selected.inStack) {
    const added = await stackProvider.addFile(selected.uri)
    if (added) {
      vscode.window.setStatusBarMessage(`Added ${selected.label} to stack.`, 2500)
    }
    return
  }

  if (stackProvider.hasActiveFilters && !selected.file?.isPinned) {
    const action = await vscode.window.showWarningMessage(
      `"${selected.label}" is in the stack, but hidden by the "Pinned Only" filter.`,
      'Disable Filter & Reveal',
      'Open File',
    )

    if (action === 'Disable Filter & Reveal') {
      stackProvider.togglePinnedOnly()
      await revealInFilesView(selected.uri, stackProvider, filesView)
    } else if (action === 'Open File') {
      await vscode.window.showTextDocument(selected.uri)
    }
    return
  }

  await revealInFilesView(selected.uri, stackProvider, filesView)
}

async function revealInFilesView(
  uri: vscode.Uri,
  stackProvider: StackProvider,
  filesView: vscode.TreeView<StackTreeItem>,
): Promise<void> {
  if (!stackProvider.getStackItem(uri)) {
    await stackProvider.getChildren()
  }

  const treeItem = stackProvider.getStackItem(uri)
  if (treeItem) {
    await filesView.reveal(treeItem, {
      select: true,
      focus: true,
      expand: 3,
    })
  } else {
    await vscode.window.showTextDocument(uri)
  }
}

function buildStagedItems(
  stagedFiles: StagedFile[],
  hasPinnedFilter: boolean,
  showInStackBadge: boolean,
  buttons: SearchActionButtons,
): SearchFileQuickPickItem[] {
  const isMultiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

  const sorted = [...stagedFiles].sort((a, b) => collator.compare(a.label, b.label))

  return sorted.map((file) => {
    const rawRelPath = vscode.workspace.asRelativePath(file.uri, isMultiRoot)
    const { fileName, dirPath, relPath } = splitRelativePath(rawRelPath)
    const descParts: string[] = []

    if (dirPath) {
      descParts.push(dirPath)
    }
    if (file.isPinned) {
      descParts.push('$(pin)')
    }
    if (hasPinnedFilter && !file.isPinned) {
      descParts.push('Hidden by Pinned Only')
    }
    if (showInStackBadge) {
      descParts.push('$(check) In Stack')
    }

    return {
      label: fileName,
      description: descParts.join(' • '),
      iconPath: file.isPinned ? new vscode.ThemeIcon('pin') : vscode.ThemeIcon.File,
      buttons: [buttons.openInEditor, buttons.removeFromStack],
      uri: file.uri,
      relPath,
      inStack: true,
      file,
    }
  })
}

function buildWorkspaceCombinedItems(
  stagedFiles: StagedFile[],
  workspaceUris: vscode.Uri[],
  hasPinnedFilter: boolean,
  buttons: SearchActionButtons,
): SearchFileQuickPickItem[] {
  const isMultiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

  const stagedItems = buildStagedItems(stagedFiles, hasPinnedFilter, true, buttons)
  const stagedKeys = new Set(stagedFiles.map((f) => f.uri.toString()))

  const unstagedItems: SearchFileQuickPickItem[] = workspaceUris
    .filter((uri) => !stagedKeys.has(uri.toString()))
    .map((uri) => {
      const rawRelPath = vscode.workspace.asRelativePath(uri, isMultiRoot)
      const { fileName, dirPath, relPath } = splitRelativePath(rawRelPath)
      const description = dirPath ? `${dirPath} • Not in Stack` : 'Not in Stack'

      return {
        label: fileName,
        description,
        iconPath: vscode.ThemeIcon.File,
        buttons: [buttons.addToStack, buttons.openInEditor],
        uri,
        relPath,
        inStack: false,
      }
    })
    .sort((a, b) => collator.compare(a.label, b.label))

  return [...stagedItems, ...unstagedItems]
}

function createActionButtons(): SearchActionButtons {
  return {
    openInEditor: {
      iconPath: new vscode.ThemeIcon('go-to-file'),
      tooltip: 'Open File in Editor',
    },
    removeFromStack: {
      iconPath: new vscode.ThemeIcon('trash'),
      tooltip: 'Remove from Stack',
    },
    addToStack: {
      iconPath: new vscode.ThemeIcon('add'),
      tooltip: 'Add to Stack',
    },
    includeWorkspace: {
      iconPath: new vscode.ThemeIcon('globe'),
      tooltip: 'Include Workspace Files (Check In Stack / Not in Stack)',
    },
    stackOnly: {
      iconPath: new vscode.ThemeIcon('layers'),
      tooltip: 'Show Files in Stack Only',
    },
  }
}
