import { KNOWN_BINARY_EXTENSIONS } from '../constants'

export const DEFAULT_MAX_CHUNK_BYTES = 140_000
export const LARGE_EXPORT_WARNING_BYTES = 150 * 1024

export const KNOWN_LOCKFILE_NAMES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
  'cargo.lock',
  'gemfile.lock',
  'poetry.lock',
  'pipfile.lock',
  'composer.lock',
  'uv.lock',
  'go.sum',
  'flake.lock',
  'mix.lock',
  'pubspec.lock',
  'podfile.lock',
  'package.resolved',
])

export enum FilePriorityTier {
  ManifestAndConfig = 0,
  CoreSource = 1,
  OtherCodeAndConfig = 2,
  Tests = 3,
  DocsAndHistory = 4,
}

export type ExportPreset = 'all' | 'sourceOnly' | 'splitChunks'

export interface ExportFileItem {
  relPath: string
  block: string
  byteLength: number
  isSkipped?: boolean
  skipReason?: string
}

export interface ExcludedFileEntry {
  relPath: string
  reason: string
}

export interface PlannedChunk {
  partNumber: number
  totalParts: number
  files: ExportFileItem[]
  content: string
  byteLength: number
  oversizedFiles: string[]
}

export interface ChunkPlanOptions {
  maxChunkBytes: number
  showTreeMap: boolean
  showTreeMapHeader: boolean
  treeMapText: string
  includeFileContents: boolean
  showFileContentsHeader: boolean
  fileContentsText: string
  excludedFiles?: ExcludedFileEntry[]
}

const MANIFEST_BASENAMES = new Set([
  'package.json',
  'tsconfig.json',
  'agents.md',
  'claude.md',
  'cargo.toml',
  'pyproject.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  'cmakelists.txt',
  'makefile',
  'dockerfile',
  'biome.json',
  'angular.json',
  'turbo.json',
  'nx.json',
  'pnpm-workspace.yaml',
  '.gitignore',
  '.vscodeignore',
  '.npmrc',
  '.nvmrc',
  '.editorconfig',
  'gemfile',
  'pipfile',
  'composer.json',
  'pubspec.yaml',
  'mix.exs',
  'deno.json',
  'deno.jsonc',
])

const MANIFEST_BASENAME_PATTERNS = [
  /^tsconfig\.[^/]+\.json$/i,
  /^docker-compose(?:\.[^/]+)?\.ya?ml$/i,
  /^vite\.config\.[^/]+$/i,
  /^webpack\.config\.[^/]+$/i,
  /^esbuild\.[^/]+$/i,
  /^eslint\.config\.[^/]+$/i,
  /^\.eslintrc(?:\.[^/]+)?$/i,
  /^\.prettierrc(?:\.[^/]+)?$/i,
  /^next\.config\.[^/]+$/i,
  /^nuxt\.config\.[^/]+$/i,
  /^tailwind\.config\.[^/]+$/i,
  /^jest\.config\.[^/]+$/i,
  /^vitest\.config\.[^/]+$/i,
]

const CORE_SOURCE_DIR_RE =
  /^(?:(?:packages|apps|services|modules|libs)\/[^/]+\/)?(?:src|lib|app|core|server|client|internal|cmd|pkg)\//i

const TEST_DIR_RE =
  /(?:^|\/)(?:test|tests|__tests__|__mocks__|spec|specs|e2e|cypress|playwright)\//i

const TEST_FILE_RE =
  /(?:\.(?:test|spec|e2e|integration|unit)\.[^./]+|(?:^|\/)(?:test_[^/]+|[^/]+_test\.[^./]+|[^/]+-stub\.[^./]+))$/i

const DOC_DIR_RE = /^(?:docs?|documentation|\.agents)\//i

const DOC_BASENAME_RE =
  /^(?:changelog|readme|license|licence|contributing|code_of_conduct|security|history|authors|notice|copying)(?:\.[^/]+)?$/i

export function normalizeRelPath(relPath: string): string {
  return relPath.replace(/\\/g, '/').replace(/^\/+/, '')
}

export function isLockfilePath(relPath: string): boolean {
  const normalized = normalizeRelPath(relPath)
  const base = normalized.split('/').pop()?.toLowerCase() ?? ''
  return KNOWN_LOCKFILE_NAMES.has(base)
}

export function isBinaryExtensionPath(relPath: string): boolean {
  const normalized = normalizeRelPath(relPath)
  const base = normalized.split('/').pop() ?? ''
  const dotIdx = base.lastIndexOf('.')
  if (dotIdx <= 0) {
    return false
  }
  return KNOWN_BINARY_EXTENSIONS.has(base.slice(dotIdx).toLowerCase())
}

export function matchesGlobPattern(relPath: string, pattern: string): boolean {
  const normalizedPath = normalizeRelPath(relPath)
  const rawTrimmed = pattern.trim().replace(/\\/g, '/')
  if (!rawTrimmed) {
    return false
  }
  const trimmed = rawTrimmed.endsWith('/') ? `${rawTrimmed}**` : rawTrimmed

  let regexStr = '^'
  let i = 0
  while (i < trimmed.length) {
    const ch = trimmed[i]
    if (ch === '*') {
      if (trimmed[i + 1] === '*') {
        if (trimmed[i + 2] === '/') {
          regexStr += '(?:.*/)?'
          i += 3
        } else {
          regexStr += '.*'
          i += 2
        }
      } else {
        regexStr += '[^/]*'
        i += 1
      }
    } else if (ch === '?') {
      regexStr += '[^/]'
      i += 1
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      regexStr += `\\${ch}`
      i += 1
    } else {
      regexStr += ch
      i += 1
    }
  }
  regexStr += '$'

  return new RegExp(regexStr, 'i').test(normalizedPath)
}

export function matchesAnyExcludePattern(relPath: string, patterns: string[]): string | undefined {
  for (const pattern of patterns) {
    if (matchesGlobPattern(relPath, pattern)) {
      return pattern
    }
  }
  return undefined
}

export function classifyFilePriority(relPath: string): FilePriorityTier {
  const normalized = normalizeRelPath(relPath)
  const base = normalized.split('/').pop() ?? ''
  const baseLower = base.toLowerCase()

  if (MANIFEST_BASENAMES.has(baseLower) || MANIFEST_BASENAME_PATTERNS.some((rx) => rx.test(base))) {
    return FilePriorityTier.ManifestAndConfig
  }

  if (DOC_DIR_RE.test(normalized) || DOC_BASENAME_RE.test(base) || baseLower.endsWith('.md')) {
    return FilePriorityTier.DocsAndHistory
  }

  if (TEST_DIR_RE.test(normalized) || TEST_FILE_RE.test(normalized)) {
    return FilePriorityTier.Tests
  }

  if (CORE_SOURCE_DIR_RE.test(normalized)) {
    return FilePriorityTier.CoreSource
  }

  return FilePriorityTier.OtherCodeAndConfig
}

export function sortByPriority<T>(items: T[], getRelPath: (item: T) => string): T[] {
  return [...items].sort((a, b) => {
    const pathA = normalizeRelPath(getRelPath(a))
    const pathB = normalizeRelPath(getRelPath(b))
    const tierA = classifyFilePriority(pathA)
    const tierB = classifyFilePriority(pathB)
    if (tierA !== tierB) {
      return tierA - tierB
    }
    return pathA.localeCompare(pathB)
  })
}

export function isSourceOnlyExcluded(relPath: string): boolean {
  const tier = classifyFilePriority(relPath)
  return tier === FilePriorityTier.Tests || tier === FilePriorityTier.DocsAndHistory
}

export function getCodeFenceLanguage(relPath: string): string {
  const normalized = normalizeRelPath(relPath)
  const base = normalized.split('/').pop() ?? ''
  if (!base) {
    return ''
  }

  const lastDot = base.lastIndexOf('.')
  if (lastDot > 0 && lastDot < base.length - 1) {
    return base.slice(lastDot + 1).toLowerCase()
  }

  // Dotfiles like .gitignore or .vscodeignore: strip leading dot
  if (lastDot === 0 && base.length > 1) {
    return base.slice(1).toLowerCase()
  }

  // Extensionless files (e.g., LICENSE, Makefile, Dockerfile)
  const lower = base.toLowerCase()
  if (lower === 'makefile') {
    return 'makefile'
  }
  if (lower === 'dockerfile') {
    return 'dockerfile'
  }
  return ''
}

export function getSafeCodeFence(content: string): string {
  let maxRun = 0
  const matches = content.match(/`+/g)
  if (matches) {
    for (const run of matches) {
      if (run.length > maxRun) {
        maxRun = run.length
      }
    }
  }
  return '`'.repeat(Math.max(3, maxRun + 1))
}

export function formatCodeFileBlock(relPath: string, content: string): string {
  const normalized = normalizeRelPath(relPath)
  const lang = getCodeFenceLanguage(normalized)
  const fence = getSafeCodeFence(content)
  const body = content.length === 0 || content.endsWith('\n') ? content : `${content}\n`
  return `File: ${normalized}\n${fence}${lang}\n${body}${fence}\n`
}

export function renderAsciiTreeFromPaths(paths: string[]): string {
  interface TreeNode {
    [key: string]: TreeNode
  }

  const root: TreeNode = {}
  const sorted = [...paths].map(normalizeRelPath).sort((a, b) => a.localeCompare(b))
  for (const p of sorted) {
    let current = root
    for (const seg of p.split('/')) {
      if (!seg) continue
      if (!current[seg]) current[seg] = {}
      current = current[seg]
    }
  }

  const sortNodes = (node: TreeNode) => (a: string, b: string) => {
    const aIsDir = Object.keys(node[a]).length > 0
    const bIsDir = Object.keys(node[b]).length > 0
    if (aIsDir === bIsDir) return a.localeCompare(b)
    return bIsDir ? 1 : -1
  }

  const lines: string[] = []
  const rootEntries = Object.keys(root).sort(sortNodes(root))
  const stack: Array<{ node: TreeNode; prefix: string; entries: string[]; index: number }> = [
    { node: root, prefix: '', entries: rootEntries, index: 0 },
  ]

  while (stack.length > 0) {
    const current = stack[stack.length - 1]
    if (current.index >= current.entries.length) {
      stack.pop()
      continue
    }
    const key = current.entries[current.index]
    const isLast = current.index === current.entries.length - 1
    current.index++

    lines.push(`${current.prefix}${isLast ? '└── ' : '├── '}${key}\n`)

    const childNode = current.node[key]
    const childEntries = Object.keys(childNode).sort(sortNodes(childNode))
    if (childEntries.length > 0) {
      stack.push({
        node: childNode,
        prefix: current.prefix + (isLast ? '    ' : '│   '),
        entries: childEntries,
        index: 0,
      })
    }
  }

  return lines.join('')
}

function renderSectionHeader(text: string): string {
  if (!text || !text.trim()) {
    return ''
  }
  return `${text}\n\n`
}

function renderPartDocument(
  partNumber: number,
  totalParts: number,
  partFiles: ExportFileItem[],
  allIncludedCount: number,
  options: ChunkPlanOptions,
  oversizedFiles: string[],
): string {
  const sections: string[] = []
  const excluded = options.excludedFiles ?? []

  if (totalParts > 1) {
    sections.push(`# Context Export — Part ${partNumber} of ${totalParts}\n\n`)
  }

  for (const oversized of oversizedFiles) {
    const item = partFiles.find((f) => f.relPath === oversized)
    const sizeKB = item ? (item.byteLength / 1024).toFixed(1) : '?'
    const limitKB = (options.maxChunkBytes / 1024).toFixed(1)
    sections.push(
      `> [Warning]: "${oversized}" (${sizeKB} KB) exceeds maxChunkBytes (${limitKB} KB) and was kept intact on a whole-file boundary.\n\n`,
    )
  }

  if (options.showTreeMap) {
    if (options.showTreeMapHeader) {
      sections.push(renderSectionHeader(options.treeMapText))
    }
    const tree = renderAsciiTreeFromPaths(partFiles.map((f) => f.relPath))
    sections.push(`\`\`\`\n${tree}\`\`\`\n\n`)

    const notes: string[] = []
    if (totalParts > 1) {
      const otherCount = allIncludedCount - partFiles.length
      notes.push(
        `Part ${partNumber} of ${totalParts}: ${partFiles.length} file(s) in this part, ${otherCount} file(s) in other parts.`,
      )
    }
    if (excluded.length > 0) {
      const preview = excluded
        .slice(0, 10)
        .map((e) => `${e.relPath} (${e.reason})`)
        .join(', ')
      const more = excluded.length > 10 ? ` (+${excluded.length - 10} more)` : ''
      notes.push(`Excluded ${excluded.length} file(s): ${preview}${more}.`)
    }
    if (notes.length > 0) {
      sections.push(notes.map((n) => `> ${n}\n`).join('') + '\n')
    }
  }

  if (options.includeFileContents) {
    if (options.showFileContentsHeader) {
      sections.push(renderSectionHeader(options.fileContentsText))
    }
    for (const file of partFiles) {
      sections.push(file.block)
    }
  }

  return sections.join('')
}

/**
 * Splits priority-ordered file entries into one or more self-contained parts
 * strictly on whole-file boundaries. Never slices a file mid-content or leaves
 * an unclosed Markdown code fence.
 */
export function planExportChunks(items: ExportFileItem[], options: ChunkPlanOptions): PlannedChunk[] {
  if (items.length === 0) {
    return []
  }

  const maxBytes = options.maxChunkBytes

  // Unbounded single-file mode
  if (!maxBytes || maxBytes <= 0) {
    const content = renderPartDocument(1, 1, items, items.length, options, [])
    return [
      {
        partNumber: 1,
        totalParts: 1,
        files: items,
        content,
        byteLength: Buffer.byteLength(content, 'utf8'),
        oversizedFiles: [],
      },
    ]
  }

  // Reserve a conservative header/map budget for chunk packing, then verify
  // exact rendered byte size for every candidate addition.
  const groups: ExportFileItem[][] = []
  let currentGroup: ExportFileItem[] = []

  const estimateGroupBytes = (group: ExportFileItem[], assumedTotalParts: number): number => {
    const rendered = renderPartDocument(1, assumedTotalParts, group, items.length, options, [])
    return Buffer.byteLength(rendered, 'utf8')
  }

  for (const item of items) {
    if (currentGroup.length === 0) {
      currentGroup.push(item)
      continue
    }

    const candidate = [...currentGroup, item]
    const candidateBytes = estimateGroupBytes(candidate, Math.max(2, groups.length + 1))

    if (candidateBytes > maxBytes) {
      groups.push(currentGroup)
      currentGroup = [item]
    } else {
      currentGroup = candidate
    }
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup)
  }

  const totalParts = groups.length
  return groups.map((group, idx) => {
    const partNumber = idx + 1
    const oversizedFiles =
      group.length === 1 && group[0].byteLength > maxBytes ? [group[0].relPath] : []
    const content = renderPartDocument(partNumber, totalParts, group, items.length, options, oversizedFiles)
    return {
      partNumber,
      totalParts,
      files: group,
      content,
      byteLength: Buffer.byteLength(content, 'utf8'),
      oversizedFiles,
    }
  })
}

export function buildPartFileName(baseFileName: string, partNumber: number, totalParts: number): string {
  if (totalParts <= 1) {
    return baseFileName
  }
  const dotIdx = baseFileName.lastIndexOf('.')
  if (dotIdx > 0) {
    const stem = baseFileName.slice(0, dotIdx)
    const ext = baseFileName.slice(dotIdx)
    return `${stem}-part${partNumber}${ext}`
  }
  return `${baseFileName}-part${partNumber}.txt`
}
