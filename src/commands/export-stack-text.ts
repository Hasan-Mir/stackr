import * as path from 'path'
import * as vscode from 'vscode'

import { StackProvider } from '../providers'
import {
  buildPartFileName,
  ContentFormatter,
  DEFAULT_MAX_CHUNK_BYTES,
  ErrorHandler,
  ExportPreset,
  LARGE_EXPORT_WARNING_BYTES,
  TokenEstimator,
} from '../utils'
import { Command, CommandDependencies } from './types'

interface ExportPresetPickItem extends vscode.QuickPickItem {
  preset: ExportPreset
}

export function getExportStackTextCommands(deps: CommandDependencies): Command[] {
  return [
    {
      id: 'aiContextStacker.exportStackText',
      execute: ErrorHandler.safeExecute('Export Stack as Text', async (initialPreset?: ExportPreset) => {
        await handleExportStackText(deps.services.stackProvider, initialPreset)
      }),
    },
  ]
}

async function handleExportStackText(provider: StackProvider, initialPreset?: ExportPreset): Promise<void> {
  const files = provider.getFiles()

  if (files.length === 0) {
    void vscode.window.showInformationMessage('Context stack is empty.')
    return
  }

  const preset = initialPreset ?? (await pickExportPreset())
  if (!preset) {
    return
  }

  const trackName = provider.getActiveTrackName()
  const safeName = sanitizeFileName(trackName) || 'stackr-context'
  const defaultDir = vscode.workspace.workspaceFolders?.[0]?.uri
  const defaultUri = defaultDir
    ? vscode.Uri.joinPath(defaultDir, `${safeName}.txt`)
    : vscode.Uri.file(`${safeName}.txt`)

  const saveUri = await vscode.window.showSaveDialog({
    defaultUri,
    filters: { 'Text Files': ['txt', 'md'] },
    saveLabel: 'Export Context',
    title: `Export "${trackName}" as Text`,
  })

  if (!saveUri) {
    return
  }

  await runTextExport(provider, saveUri, preset)
}

async function pickExportPreset(): Promise<ExportPreset | undefined> {
  const cfg = vscode.workspace.getConfiguration('aiContextStacker')
  const configuredChunkBytes = cfg.get<number>('export.maxChunkBytes', DEFAULT_MAX_CHUNK_BYTES)
  const chunkKB = Math.round((configuredChunkBytes > 0 ? configuredChunkBytes : DEFAULT_MAX_CHUNK_BYTES) / 1024)

  const items: ExportPresetPickItem[] = [
    {
      label: `$(files) Split into LLM-Safe Chunks (~${chunkKB} KB each)`,
      description: 'Recommended for large workspaces',
      detail: 'Writes sequential part files on whole-file boundaries with priority ordering and closed code fences.',
      preset: 'splitChunks',
    },
    {
      label: '$(code) Source Only (exclude tests & docs)',
      description: 'Highest signal-to-noise ratio',
      detail: 'Includes manifests, configs, and production source directories while excluding tests, docs, and lockfiles.',
      preset: 'sourceOnly',
    },
    {
      label: '$(file-text) All Tracked Files (Single File)',
      description: 'Priority-ordered single .txt file',
      detail: 'Writes all non-binary, non-lockfile files into one file with manifests and core source first.',
      preset: 'all',
    },
  ]

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Choose a text export preset',
    title: 'Export Stack as Text',
  })

  return picked?.preset
}

async function runTextExport(provider: StackProvider, saveUri: vscode.Uri, preset: ExportPreset): Promise<void> {
  const files = provider.getFiles()
  const trackName = provider.getActiveTrackName()
  const cfg = vscode.workspace.getConfiguration('aiContextStacker')
  const configuredMaxChunkBytes = cfg.get<number>('export.maxChunkBytes', DEFAULT_MAX_CHUNK_BYTES)

  const maxChunkBytes =
    preset === 'splitChunks'
      ? configuredMaxChunkBytes > 0
        ? configuredMaxChunkBytes
        : DEFAULT_MAX_CHUNK_BYTES
      : 0

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Exporting "${trackName}" as Text...`,
      cancellable: true,
    },
    async (_, token) => {
      const result = await ContentFormatter.formatChunks(files, {
        token,
        preset,
        maxChunkBytes,
      })

      if (token.isCancellationRequested) {
        return
      }

      if (result.chunks.length === 0) {
        void vscode.window.showWarningMessage('No files matched the selected export preset.')
        return
      }

      const encoder = new TextEncoder()
      const dirUri = vscode.Uri.file(path.dirname(saveUri.fsPath))
      const baseName = path.basename(saveUri.fsPath)
      const writtenNames: string[] = []
      const oversizedFiles: string[] = []

      for (const chunk of result.chunks) {
        const fileName = buildPartFileName(baseName, chunk.partNumber, chunk.totalParts)
        const targetUri = result.chunks.length === 1 ? saveUri : vscode.Uri.joinPath(dirUri, fileName)
        await vscode.workspace.fs.writeFile(targetUri, encoder.encode(chunk.content))
        writtenNames.push(fileName)
        oversizedFiles.push(...chunk.oversizedFiles)
      }

      if (result.chunks.length > 1) {
        const totalKB = (result.chunks.reduce((sum, c) => sum + c.byteLength, 0) / 1024).toFixed(1)
        const oversizedNote =
          oversizedFiles.length > 0
            ? ` Warning: ${oversizedFiles.length} single file(s) exceeded chunk limit and were kept intact (${oversizedFiles.join(', ')}).`
            : ''
        void vscode.window.showInformationMessage(
          `Exported ${result.totalIncludedFiles} file(s) across ${result.chunks.length} parts (${totalKB} KB total): ${writtenNames[0]} ... ${writtenNames[writtenNames.length - 1]}.${oversizedNote}`,
        )
        return
      }

      const singleChunk = result.chunks[0]
      const sizeKB = (singleChunk.byteLength / 1024).toFixed(1)
      const stats = TokenEstimator.measure(singleChunk.content)
      const tokensLabel = TokenEstimator.format(stats)

      if (singleChunk.byteLength > LARGE_EXPORT_WARNING_BYTES) {
        const splitAction = 'Re-export as Split Chunks'
        const sourceOnlyAction = 'Re-export Source Only'
        const buttons = preset === 'sourceOnly' ? [splitAction] : [splitAction, sourceOnlyAction]

        void vscode.window
          .showWarningMessage(
            `Exported ${baseName} is ${sizeKB} KB (${tokensLabel}), which may exceed LLM single-file attachment limits (~150 KB).`,
            ...buttons,
          )
          .then((selection) => {
            if (selection === splitAction) {
              void runTextExport(provider, saveUri, 'splitChunks')
            } else if (selection === sourceOnlyAction) {
              void runTextExport(provider, saveUri, 'sourceOnly')
            }
          })
      } else {
        void vscode.window.showInformationMessage(
          `Exported ${result.totalIncludedFiles} file(s) to ${baseName} (${sizeKB} KB, ${tokensLabel}).`,
        )
      }
    },
  )
}

function sanitizeFileName(name: string): string {
  return name
    .trim()
    .replace(/[<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}
