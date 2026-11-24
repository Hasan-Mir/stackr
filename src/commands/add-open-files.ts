import * as vscode from 'vscode'

import { StackProvider } from '../providers'
import { Logger } from '../utils'
import { Command, CommandDependencies } from './types'

export interface CollectOpenTabOptions {
  excludePinned?: boolean
  activeGroupOnly?: boolean
}

export interface TabGroupsLike {
  all: readonly vscode.TabGroup[]
  activeTabGroup?: vscode.TabGroup
}

export function getAddOpenFilesCommands(deps: CommandDependencies): Command[] {
  const { stackProvider } = deps.services

  return [
    {
      id: 'aiContextStacker.addOpenFiles',
      execute: () => addOpenFilesWithOptions(stackProvider, {}),
    },
    {
      id: 'aiContextStacker.addOpenFilesExcludePinned',
      execute: () => addOpenFilesWithOptions(stackProvider, { excludePinned: true }),
    },
    {
      id: 'aiContextStacker.addOpenFilesInActiveGroup',
      execute: () => addOpenFilesWithOptions(stackProvider, { activeGroupOnly: true }),
    },
  ]
}

export function collectOpenTabUris(tabGroups: TabGroupsLike, options: CollectOpenTabOptions = {}): vscode.Uri[] {
  const groups = options.activeGroupOnly ? (tabGroups.activeTabGroup ? [tabGroups.activeTabGroup] : []) : tabGroups.all

  const seen = new Set<string>()
  const uris: vscode.Uri[] = []

  for (const group of groups) {
    for (const tab of group.tabs) {
      if (options.excludePinned && tab.isPinned) {
        continue
      }

      if (tab.input instanceof vscode.TabInputText) {
        const key = tab.input.uri.toString()
        if (!seen.has(key)) {
          seen.add(key)
          uris.push(tab.input.uri)
        }
      }
    }
  }

  return uris
}

async function addOpenFilesWithOptions(stackProvider: StackProvider, options: CollectOpenTabOptions): Promise<void> {
  const candidateUris = collectOpenTabUris(vscode.window.tabGroups, options)

  if (candidateUris.length === 0) {
    void vscode.window.showInformationMessage(getEmptyOpenTabsMessage(options))
    return
  }

  const unstagedUris = candidateUris.filter((uri) => !stackProvider.hasTrackedPath(uri))

  if (unstagedUris.length === 0) {
    void vscode.window.showInformationMessage(getAlreadyStagedMessage(options))
    return
  }

  const success = await stackProvider.addFiles(unstagedUris)

  if (success) {
    Logger.info(`Added ${unstagedUris.length} open files to stack.`)
    void vscode.window.showInformationMessage(`Added ${unstagedUris.length} file(s) to stack`)
  }
}

function getEmptyOpenTabsMessage(options: CollectOpenTabOptions): string {
  if (options.activeGroupOnly) {
    return 'No open files found in the active editor group.'
  }
  if (options.excludePinned) {
    return 'No unpinned open files found.'
  }
  return 'All open files are already in the stack.'
}

function getAlreadyStagedMessage(options: CollectOpenTabOptions): string {
  if (options.activeGroupOnly) {
    return 'All open files in the active group are already in the stack.'
  }
  if (options.excludePinned) {
    return 'All unpinned open files are already in the stack.'
  }
  return 'All open files are already in the stack.'
}
