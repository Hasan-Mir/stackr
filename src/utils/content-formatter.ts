import { TextDecoder } from 'util'
import * as vscode from 'vscode'

import { StagedFile } from '../models'
import {
  ChunkPlanOptions,
  DEFAULT_MAX_CHUNK_BYTES,
  ExcludedFileEntry,
  ExportFileItem,
  ExportPreset,
  formatCodeFileBlock,
  isBinaryExtensionPath,
  isLockfilePath,
  isSourceOnlyExcluded,
  matchesAnyExcludePattern,
  normalizeRelPath,
  planExportChunks,
  PlannedChunk,
  renderAsciiTreeFromPaths,
  sortByPriority,
} from './export-planner'
import { Logger } from './logger'

export interface FormatOptions {
  token?: vscode.CancellationToken
  maxTotalBytes?: number
  skipTree?: boolean
  forceTree?: boolean
  skipContents?: boolean
  priorityOrdering?: boolean
  skipLockfiles?: boolean
  excludePatterns?: string[]
  preset?: ExportPreset
  maxChunkBytes?: number
}

export interface ChunkedFormatResult {
  chunks: PlannedChunk[]
  excludedFiles: ExcludedFileEntry[]
  totalIncludedFiles: number
}

interface FormatterConfig {
  showTreeMap: boolean
  showTreeMapHeader: boolean
  treeMapText: string
  includeFileContents: boolean
  showFileContentsHeader: boolean
  fileContentsText: string
  maxSizeBytes: number
  priorityOrdering: boolean
  skipLockfiles: boolean
  excludePatterns: string[]
  maxChunkBytes: number
  preset: ExportPreset
}

export class ContentFormatter {
  private static readonly DEFAULT_MAX_BYTES = 100 * 1024 * 1024
  private static readonly MAX_FILE_SIZE = 5 * 1024 * 1024

  public static async *formatStream(
    files: StagedFile[],
    opts: FormatOptions = {},
  ): AsyncGenerator<string, void, unknown> {
    if (files.length === 0 || opts.token?.isCancellationRequested) return

    const config = this.getConfig(opts)
    const { includedFiles, excludedFiles } = this.prepareFileList(files, config)
    let currentTotalBytes = 0

    if (config.showTreeMap) {
      for (const line of this.generateTreeBlock(includedFiles, excludedFiles, config)) {
        currentTotalBytes += Buffer.byteLength(line, 'utf8')
        yield line
      }
    }

    if (config.includeFileContents) {
      if (config.showFileContentsHeader) {
        const header = this.renderHeader(config.fileContentsText)
        currentTotalBytes += Buffer.byteLength(header, 'utf8')
        yield header
      }
      yield* this.streamFileContent(includedFiles, config, currentTotalBytes, opts.token)
    }
  }

  public static async format(files: StagedFile[], opts: FormatOptions = {}): Promise<string> {
    const parts: string[] = []

    for await (const chunk of this.formatStream(files, opts)) {
      parts.push(chunk)
    }
    return parts.join('')
  }

  public static async formatChunks(files: StagedFile[], opts: FormatOptions = {}): Promise<ChunkedFormatResult> {
    if (files.length === 0 || opts.token?.isCancellationRequested) {
      return { chunks: [], excludedFiles: [], totalIncludedFiles: 0 }
    }

    const config = this.getConfig(opts)
    const { includedFiles, excludedFiles } = this.prepareFileList(files, config)
    const items: ExportFileItem[] = []

    for (const file of includedFiles) {
      if (opts.token?.isCancellationRequested) {
        return { chunks: [], excludedFiles, totalIncludedFiles: 0 }
      }

      const relPath = normalizeRelPath(this.getDisplayPath(file.uri))
      const processed = await this.processFile(file)
      if (processed) {
        items.push({
          relPath,
          block: processed.block,
          byteLength: Buffer.byteLength(processed.block, 'utf8'),
          isSkipped: processed.isSkipped,
          skipReason: processed.skipReason,
        })
      }
    }

    const effectiveMaxChunkBytes =
      opts.maxChunkBytes !== undefined
        ? opts.maxChunkBytes
        : config.preset === 'splitChunks'
          ? config.maxChunkBytes > 0
            ? config.maxChunkBytes
            : DEFAULT_MAX_CHUNK_BYTES
          : config.preset === 'all'
            ? 0
            : config.maxChunkBytes

    const planOpts: ChunkPlanOptions = {
      maxChunkBytes: effectiveMaxChunkBytes,
      showTreeMap: config.showTreeMap,
      showTreeMapHeader: config.showTreeMapHeader,
      treeMapText: config.treeMapText,
      includeFileContents: config.includeFileContents,
      showFileContentsHeader: config.showFileContentsHeader,
      fileContentsText: config.fileContentsText,
      excludedFiles,
    }

    const chunks = planExportChunks(items, planOpts)
    return {
      chunks,
      excludedFiles,
      totalIncludedFiles: items.length,
    }
  }

  public static *generateAsciiTree(files: StagedFile[]): Generator<string> {
    const paths = files.map((f) => this.getDisplayPath(f.uri))
    const rendered = renderAsciiTreeFromPaths(paths)
    if (rendered) {
      yield rendered
    }
  }

  private static getConfig(opts: FormatOptions): FormatterConfig {
    const cfg = vscode.workspace.getConfiguration('aiContextStacker')
    const userTreeMap = cfg.get<boolean>('showTreeMap', true)
    const userIncludeContents = cfg.get<boolean>('includeFileContents', true)
    const userExcludePatterns = cfg.get<string[]>('export.excludePatterns', [])
    const mergedExcludes = [...userExcludePatterns, ...(opts.excludePatterns ?? [])]

    return {
      showTreeMap: opts.skipTree ? false : opts.forceTree ? true : userTreeMap,
      showTreeMapHeader: cfg.get<boolean>('showTreeMapHeader', true),
      treeMapText: cfg.get<string>('treeMapText', '# Context Map'),
      includeFileContents: opts.skipContents ? false : userIncludeContents,
      showFileContentsHeader: cfg.get<boolean>('showFileContentsHeader', true),
      fileContentsText: cfg.get<string>('fileContentsText', '# File Contents'),
      maxSizeBytes: opts.maxTotalBytes ?? this.DEFAULT_MAX_BYTES,
      priorityOrdering: opts.priorityOrdering ?? cfg.get<boolean>('export.priorityOrdering', true),
      skipLockfiles: opts.skipLockfiles ?? cfg.get<boolean>('export.skipLockfiles', true),
      excludePatterns: mergedExcludes,
      maxChunkBytes: opts.maxChunkBytes ?? cfg.get<number>('export.maxChunkBytes', DEFAULT_MAX_CHUNK_BYTES),
      preset: opts.preset ?? 'all',
    }
  }

  private static prepareFileList(
    files: StagedFile[],
    config: FormatterConfig,
  ): { includedFiles: StagedFile[]; excludedFiles: ExcludedFileEntry[] } {
    const includedFiles: StagedFile[] = []
    const excludedFiles: ExcludedFileEntry[] = []

    for (const file of files) {
      const relPath = normalizeRelPath(this.getDisplayPath(file.uri))

      if (config.skipLockfiles && isLockfilePath(relPath)) {
        excludedFiles.push({ relPath, reason: 'lockfile' })
        continue
      }

      const matchedPattern = matchesAnyExcludePattern(relPath, config.excludePatterns)
      if (matchedPattern) {
        excludedFiles.push({ relPath, reason: `matched ${matchedPattern}` })
        continue
      }

      if (config.preset === 'sourceOnly' && isSourceOnlyExcluded(relPath)) {
        excludedFiles.push({ relPath, reason: 'source-only preset' })
        continue
      }

      includedFiles.push(file)
    }

    const ordered = config.priorityOrdering
      ? sortByPriority(includedFiles, (f) => this.getDisplayPath(f.uri))
      : includedFiles

    return { includedFiles: ordered, excludedFiles }
  }

  private static *generateTreeBlock(
    files: StagedFile[],
    excludedFiles: ExcludedFileEntry[],
    config: FormatterConfig,
  ): Generator<string> {
    if (config.showTreeMapHeader) {
      yield this.renderHeader(config.treeMapText)
    }

    yield '```\n'
    yield* this.generateAsciiTree(files)
    yield '```\n\n'

    if (excludedFiles.length > 0) {
      const preview = excludedFiles
        .slice(0, 10)
        .map((e) => `${e.relPath} (${e.reason})`)
        .join(', ')
      const more = excludedFiles.length > 10 ? ` (+${excludedFiles.length - 10} more)` : ''
      yield `> Excluded ${excludedFiles.length} file(s): ${preview}${more}.\n\n`
    }
  }

  private static renderHeader(text: string): string {
    if (!text || !text.trim()) {
      return ''
    }
    return `${text}\n\n`
  }

  private static async *streamFileContent(
    files: StagedFile[],
    config: FormatterConfig,
    initialBytes: number,
    token?: vscode.CancellationToken,
  ): AsyncGenerator<string, void, unknown> {
    let currentBytes = initialBytes
    let emittedCount = 0

    for (let i = 0; i < files.length; i++) {
      if (token?.isCancellationRequested) break

      const file = files[i]
      const processed = await this.processFile(file)
      if (!processed) continue

      const blockBytes = Buffer.byteLength(processed.block, 'utf8')

      // Never slice a file mid-content: stop strictly on whole-file boundaries
      // once at least one file has been emitted.
      if (emittedCount > 0 && currentBytes + blockBytes > config.maxSizeBytes) {
        const remaining = files.slice(i).map((f) => normalizeRelPath(this.getDisplayPath(f.uri)))
        yield this.makeLimitSummary(config.maxSizeBytes, remaining)
        break
      }

      if (emittedCount === 0 && currentBytes + blockBytes > config.maxSizeBytes) {
        const relPath = normalizeRelPath(this.getDisplayPath(file.uri))
        yield `> [Warning]: "${relPath}" (${(blockBytes / 1024).toFixed(1)} KB) exceeds context limit (${(config.maxSizeBytes / 1024).toFixed(1)} KB) and was kept intact on a whole-file boundary.\n\n`
      }

      currentBytes += blockBytes
      emittedCount++
      yield processed.block
    }
  }

  private static async processFile(
    file: StagedFile,
  ): Promise<{ block: string; isSkipped: boolean; skipReason?: string } | null> {
    const validationError = await this.validateFile(file)
    if (validationError) {
      return {
        block: this.makeSkipMsg(file, validationError),
        isSkipped: true,
        skipReason: validationError,
      }
    }

    try {
      const content = await this.readFileSafely(file.uri)
      if (content === null) {
        return {
          block: this.makeSkipMsg(file, 'binary or unreadable'),
          isSkipped: true,
          skipReason: 'binary or unreadable',
        }
      }
      return {
        block: this.formatBlock(file, content),
        isSkipped: false,
      }
    } catch (err) {
      Logger.error(`Read failed: ${file.uri.fsPath}`, err)
      return {
        block: this.makeSkipMsg(file, 'read error'),
        isSkipped: true,
        skipReason: 'read error',
      }
    }
  }

  private static async validateFile(file: StagedFile): Promise<string | null> {
    const relPath = this.getDisplayPath(file.uri)
    if (file.isBinary || isBinaryExtensionPath(relPath)) return 'binary file'

    const stats = await vscode.workspace.fs.stat(file.uri)
    if (stats.size > this.MAX_FILE_SIZE) {
      return `large file (>${this.MAX_FILE_SIZE / 1024 / 1024}MB)`
    }

    return null
  }

  private static async readFileSafely(uri: vscode.Uri): Promise<string | null> {
    const data = await vscode.workspace.fs.readFile(uri)

    if (this.isBinaryBuffer(data)) return null

    const decoder = new TextDecoder('utf-8', { fatal: false })
    return decoder.decode(data)
  }

  private static isBinaryBuffer(data: Uint8Array): boolean {
    const checkLen = Math.min(data.length, 512)
    for (let i = 0; i < checkLen; i++) {
      if (data[i] === 0) return true
    }
    return false
  }

  private static formatBlock(file: StagedFile, content: string): string {
    const relPath = this.getDisplayPath(file.uri)
    return formatCodeFileBlock(relPath, content)
  }

  private static makeSkipMsg(file: StagedFile, reason: string): string {
    const relPath = normalizeRelPath(this.getDisplayPath(file.uri))
    return `> Skipped ${reason}: ${relPath}\n`
  }

  private static makeLimitSummary(maxBytes: number, remainingPaths: string[]): string {
    const limitKB = (maxBytes / 1024).toFixed(1)
    const list = remainingPaths.map((p) => `> - ${p}`).join('\n')
    return `\n> [System]: Context limit (${limitKB} KB / ${maxBytes}B) reached on a whole-file boundary. Omitted ${remainingPaths.length} remaining file(s):\n${list}\n`
  }

  private static getDisplayPath(uri: vscode.Uri): string {
    const isMultiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1
    return vscode.workspace.asRelativePath(uri, isMultiRoot)
  }
}
