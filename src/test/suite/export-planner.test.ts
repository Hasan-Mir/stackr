import * as assert from 'assert'
import * as sinon from 'sinon'
import * as vscode from 'vscode'

import { StagedFile } from '../../models'
import {
  buildPartFileName,
  classifyFilePriority,
  ContentFormatter,
  ExportFileItem,
  FilePriorityTier,
  formatCodeFileBlock,
  getCodeFenceLanguage,
  isBinaryExtensionPath,
  isLockfilePath,
  isSourceOnlyExcluded,
  matchesAnyExcludePattern,
  planExportChunks,
  sortByPriority,
} from '../../utils'

suite('Export Planner & ContentFormatter Test Suite', () => {
  suite('Smart Priority Ordering', () => {
    test('classifies manifests, core source, other code, tests, and docs into expected tiers', () => {
      assert.strictEqual(classifyFilePriority('package.json'), FilePriorityTier.ManifestAndConfig)
      assert.strictEqual(classifyFilePriority('tsconfig.json'), FilePriorityTier.ManifestAndConfig)
      assert.strictEqual(classifyFilePriority('tsconfig.offline.json'), FilePriorityTier.ManifestAndConfig)
      assert.strictEqual(classifyFilePriority('AGENTS.md'), FilePriorityTier.ManifestAndConfig)
      assert.strictEqual(classifyFilePriority('Cargo.toml'), FilePriorityTier.ManifestAndConfig)

      assert.strictEqual(classifyFilePriority('src/tree.ts'), FilePriorityTier.CoreSource)
      assert.strictEqual(classifyFilePriority('packages/core/src/index.ts'), FilePriorityTier.CoreSource)
      assert.strictEqual(classifyFilePriority('lib/parser.ts'), FilePriorityTier.CoreSource)

      assert.strictEqual(classifyFilePriority('typings/shims.d.ts'), FilePriorityTier.OtherCodeAndConfig)
      assert.strictEqual(classifyFilePriority('.github/workflows/ci.yml'), FilePriorityTier.OtherCodeAndConfig)

      assert.strictEqual(classifyFilePriority('test/integration.js'), FilePriorityTier.Tests)
      assert.strictEqual(classifyFilePriority('src/test/suite/new-features.test.ts'), FilePriorityTier.Tests)
      assert.strictEqual(classifyFilePriority('src/utils/parser.spec.ts'), FilePriorityTier.Tests)

      assert.strictEqual(classifyFilePriority('docs/reviews/audit.md'), FilePriorityTier.DocsAndHistory)
      assert.strictEqual(classifyFilePriority('CHANGELOG.md'), FilePriorityTier.DocsAndHistory)
      assert.strictEqual(classifyFilePriority('README.md'), FilePriorityTier.DocsAndHistory)
      assert.strictEqual(classifyFilePriority('LICENSE'), FilePriorityTier.DocsAndHistory)
    })

    test('sorts manifests and src/ before test/ and docs/', () => {
      const unsorted = [
        'docs/reviews/2026-11-26-audit.md',
        'test/integration.js',
        'CHANGELOG.md',
        'README.md',
        'src/tree.ts',
        'src/git.ts',
        'typings/shims.d.ts',
        'package.json',
        'AGENTS.md',
        'LICENSE',
      ]

      const sorted = sortByPriority(unsorted, (p) => p)

      assert.deepStrictEqual(sorted, [
        'AGENTS.md',
        'package.json',
        'src/git.ts',
        'src/tree.ts',
        'typings/shims.d.ts',
        'test/integration.js',
        'CHANGELOG.md',
        'docs/reviews/2026-11-26-audit.md',
        'LICENSE',
        'README.md',
      ])
    })
  })

  suite('Markdown Code Fence Safety', () => {
    test('handles extensionless files without leaking full paths into fence language', () => {
      assert.strictEqual(getCodeFenceLanguage('LICENSE'), '')
      assert.strictEqual(getCodeFenceLanguage('src/tree.ts'), 'ts')
      assert.strictEqual(getCodeFenceLanguage('.gitignore'), 'gitignore')
      assert.strictEqual(getCodeFenceLanguage('Makefile'), 'makefile')

      const block = formatCodeFileBlock('LICENSE', 'MIT License\n')
      assert.ok(block.startsWith('File: LICENSE\n```\nMIT License\n```\n'))
    })

    test('expands fence length when file content contains triple backticks', () => {
      const mdContent = '# Guide\n\n```ts\nconst x = 1\n```\n'
      const block = formatCodeFileBlock('README.md', mdContent)
      assert.ok(block.startsWith('File: README.md\n````md\n'), 'Should use 4-backtick opening fence')
      assert.ok(block.endsWith('\n````\n'), 'Should close with matching 4-backtick fence')
    })
  })

  suite('Whole-File Boundary Chunking', () => {
    function makeItem(relPath: string, body: string): ExportFileItem {
      const block = formatCodeFileBlock(relPath, body)
      return {
        relPath,
        block,
        byteLength: Buffer.byteLength(block, 'utf8'),
      }
    }

    test('splits strictly on whole-file boundaries with Part headers, Context Maps, and closed fences', () => {
      const items = [
        makeItem('package.json', '{"name":"demo"}\n'),
        makeItem('src/a.ts', 'export const a = "' + 'A'.repeat(600) + '"\n'),
        makeItem('src/b.ts', 'export const b = "' + 'B'.repeat(600) + '"\n'),
        makeItem('test/a.test.ts', 'export const t = "' + 'T'.repeat(600) + '"\n'),
      ]

      const chunks = planExportChunks(items, {
        maxChunkBytes: 1000,
        showTreeMap: true,
        showTreeMapHeader: true,
        treeMapText: '# Context Map',
        includeFileContents: true,
        showFileContentsHeader: true,
        fileContentsText: '# File Contents',
        excludedFiles: [{ relPath: 'package-lock.json', reason: 'lockfile' }],
      })

      assert.ok(chunks.length >= 2, 'Should split into multiple parts')
      const allPathsInChunks: string[] = []

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]
        assert.strictEqual(chunk.partNumber, i + 1)
        assert.strictEqual(chunk.totalParts, chunks.length)
        assert.ok(chunk.content.includes(`# Context Export — Part ${i + 1} of ${chunks.length}`))
        assert.ok(chunk.content.includes('# Context Map'))
        assert.ok(chunk.content.includes('# File Contents'))
        assert.ok(chunk.content.includes('Excluded 1 file(s): package-lock.json (lockfile)'))

        // Verify every fence in the chunk is balanced (even count of ``` lines)
        const fenceLines = chunk.content.split('\n').filter((line) => /^`{3,}/.test(line))
        assert.strictEqual(fenceLines.length % 2, 0, `Part ${i + 1} must have balanced code fences`)

        for (const f of chunk.files) {
          allPathsInChunks.push(f.relPath)
          assert.ok(chunk.content.includes(f.block), `Part ${i + 1} must contain intact block for ${f.relPath}`)
        }
      }

      assert.deepStrictEqual(allPathsInChunks, ['package.json', 'src/a.ts', 'src/b.ts', 'test/a.test.ts'])
    })

    test('keeps an oversized single file intact and emits an explicit warning', () => {
      const huge = makeItem('src/huge.ts', 'x'.repeat(2500) + '\n')
      const small = makeItem('src/small.ts', 'export const ok = true\n')

      const chunks = planExportChunks([huge, small], {
        maxChunkBytes: 800,
        showTreeMap: true,
        showTreeMapHeader: true,
        treeMapText: '# Context Map',
        includeFileContents: true,
        showFileContentsHeader: true,
        fileContentsText: '# File Contents',
      })

      assert.strictEqual(chunks.length, 2)
      assert.deepStrictEqual(chunks[0].oversizedFiles, ['src/huge.ts'])
      assert.ok(chunks[0].content.includes('> [Warning]: "src/huge.ts"'))
      assert.ok(chunks[0].content.includes(huge.block), 'Oversized file must never be sliced mid-content')
      assert.deepStrictEqual(chunks[1].oversizedFiles, [])
      assert.ok(chunks[1].content.includes(small.block))
    })

    test('buildPartFileName formats sequential part filenames cleanly', () => {
      assert.strictEqual(buildPartFileName('context.txt', 1, 1), 'context.txt')
      assert.strictEqual(buildPartFileName('context.txt', 1, 3), 'context-part1.txt')
      assert.strictEqual(buildPartFileName('context.txt', 2, 3), 'context-part2.txt')
      assert.strictEqual(buildPartFileName('context', 2, 3), 'context-part2.txt')
    })
  })

  suite('Binary, Lockfile & Exclusion Filtering', () => {
    test('detects lockfiles, binary extensions, source-only exclusions, and custom globs', () => {
      assert.strictEqual(isLockfilePath('package-lock.json'), true)
      assert.strictEqual(isLockfilePath('apps/web/pnpm-lock.yaml'), true)
      assert.strictEqual(isLockfilePath('yarn.lock'), true)
      assert.strictEqual(isLockfilePath('Cargo.lock'), true)
      assert.strictEqual(isLockfilePath('package.json'), false)

      assert.strictEqual(isBinaryExtensionPath('icon.png'), true)
      assert.strictEqual(isBinaryExtensionPath('assets/logo.webp'), true)
      assert.strictEqual(isBinaryExtensionPath('src/tree.ts'), false)
      assert.strictEqual(isBinaryExtensionPath('LICENSE'), false)

      assert.strictEqual(isSourceOnlyExcluded('test/integration.js'), true)
      assert.strictEqual(isSourceOnlyExcluded('docs/LESSONS_LEARNED.md'), true)
      assert.strictEqual(isSourceOnlyExcluded('CHANGELOG.md'), true)
      assert.strictEqual(isSourceOnlyExcluded('src/tree.ts'), false)
      assert.strictEqual(isSourceOnlyExcluded('package.json'), false)

      assert.strictEqual(matchesAnyExcludePattern('docs/reviews/audit.md', ['docs/**']), 'docs/**')
      assert.strictEqual(matchesAnyExcludePattern('docs/reviews/audit.md', ['docs/']), 'docs/')
      assert.strictEqual(matchesAnyExcludePattern('src/app.spec.ts', ['**/*.spec.ts']), '**/*.spec.ts')
      assert.strictEqual(matchesAnyExcludePattern('src/app.ts', ['docs/**', '**/*.spec.ts']), undefined)
    })

    test('ContentFormatter skips lockfiles and binaries and stops on whole-file boundary with omitted summary', async () => {
      const sandbox = sinon.createSandbox()
      try {
        const fakeContents = new Map<string, Uint8Array>([
          ['/ws/package.json', new TextEncoder().encode('{"name":"demo"}\n')],
          ['/ws/src/main.ts', new TextEncoder().encode('export const main = 1\n')],
          ['/ws/docs/guide.md', new TextEncoder().encode('# Guide\n' + 'D'.repeat(400) + '\n')],
          ['/ws/icon.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01])],
          ['/ws/package-lock.json', new TextEncoder().encode('{"lockfileVersion":3}\n')],
        ])

        sandbox.stub(vscode.workspace, 'asRelativePath').callsFake((uri) => {
          const fsPath = typeof uri === 'string' ? uri : uri.path
          return fsPath.replace(/^\/ws\//, '')
        })
        sandbox.stub(vscode.workspace.fs, 'stat').callsFake(async (uri) => {
          const data = fakeContents.get(uri.path) ?? new Uint8Array(0)
          return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: data.length }
        })
        sandbox.stub(vscode.workspace.fs, 'readFile').callsFake(async (uri) => {
          return fakeContents.get(uri.path) ?? new Uint8Array(0)
        })

        const files: StagedFile[] = [
          { type: 'file', uri: vscode.Uri.file('/ws/docs/guide.md'), label: 'guide.md' },
          { type: 'file', uri: vscode.Uri.file('/ws/package-lock.json'), label: 'package-lock.json' },
          { type: 'file', uri: vscode.Uri.file('/ws/icon.png'), label: 'icon.png' },
          { type: 'file', uri: vscode.Uri.file('/ws/src/main.ts'), label: 'main.ts' },
          { type: 'file', uri: vscode.Uri.file('/ws/package.json'), label: 'package.json' },
        ]

        const output = await ContentFormatter.format(files, {
          forceTree: true,
          priorityOrdering: true,
          skipLockfiles: true,
          maxTotalBytes: 350,
        })

        assert.ok(!output.includes('File: package-lock.json'), 'Lockfile should be excluded from File Contents')
        assert.ok(output.includes('Excluded 1 file(s): package-lock.json (lockfile)'))
        assert.ok(output.includes('> Skipped binary file: icon.png') || output.includes('Omitted'))

        const pkgIdx = output.indexOf('File: package.json')
        const srcIdx = output.indexOf('File: src/main.ts')
        assert.ok(pkgIdx !== -1 && srcIdx !== -1 && pkgIdx < srcIdx, 'package.json should appear before src/main.ts')

        // docs/guide.md (~430 bytes) should be omitted cleanly on whole-file boundary
        assert.ok(!output.includes('File: docs/guide.md'), 'Oversized trailing doc should be omitted cleanly')
        assert.ok(output.includes('Omitted'), 'Should append omitted file summary')
        assert.ok(output.includes('> - docs/guide.md'), 'Summary should list omitted file path')
      } finally {
        sandbox.restore()
      }
    })
  })
})
