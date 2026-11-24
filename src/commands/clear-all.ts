import * as vscode from 'vscode'

import { StagedFile } from '../models'
import { StackProvider } from '../providers'
import { ErrorHandler } from '../utils'
import { Command, CommandDependencies } from './types'

export type ClearAction =
  | { type: 'empty'; message: string }
  | { type: 'allPinned'; message: string }
  | { type: 'confirm'; message: string }

export function getClearAllCommands(deps: CommandDependencies): Command[] {
  return [
    {
      id: 'aiContextStacker.clearAll',
      execute: ErrorHandler.safeExecute('Clear All', async () => {
        await handleClearAll(deps.services.stackProvider)
      }),
    },
  ]
}

async function handleClearAll(provider: StackProvider): Promise<void> {
  const files = provider.getFiles()
  const action = determineClearAction(files)

  if (action.type === 'empty' || action.type === 'allPinned') {
    vscode.window.showInformationMessage(action.message)
    return
  }

  const answer = await vscode.window.showWarningMessage(action.message, { modal: true }, 'Confirm')

  if (answer === 'Confirm') {
    provider.clear()
    vscode.window.showInformationMessage('Context stack cleared')
  }
}

export function determineClearAction(files: StagedFile[], trackName?: string): ClearAction {
  if (files.length === 0) {
    return {
      type: 'empty',
      message: trackName ? `Track "${trackName}" is already empty.` : 'Context stack is already empty',
    }
  }

  const unpinnedCount = files.filter((f) => !f.isPinned).length
  const pinnedCount = files.length - unpinnedCount

  if (unpinnedCount === 0) {
    return {
      type: 'allPinned',
      message: trackName
        ? `All files in track "${trackName}" are pinned. Unpin them to clear.`
        : 'All files are pinned. Unpin them to clear.',
    }
  }

  const scope = trackName ? `track "${trackName}"` : 'context stack'
  const message =
    pinnedCount > 0
      ? `Clear ${unpinnedCount} unpinned file(s) from ${scope}? (${pinnedCount} pinned files will remain)`
      : `Clear all ${files.length} file(s) from ${scope}?`

  return { type: 'confirm', message }
}
