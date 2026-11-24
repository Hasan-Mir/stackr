import * as assert from 'assert'
import * as sinon from 'sinon'
import * as vscode from 'vscode'

import { parseCopiedTabPaths, resolveTargets } from '../../commands/add-file-context-menu'
import { parseGitNameOnlyZ, parseGitPorcelainZ } from '../../commands/add-git-files'
import { collectOpenTabUris } from '../../commands/add-open-files'
import { determineClearAction } from '../../commands/clear-all'
import { splitRelativePath } from '../../commands/search-stack'
import { isStagedFolder, StagedFile } from '../../models'
import { TrackManager } from '../../providers/track-manager'
import { TreeBuilder } from '../../services'
import { buildZipBuffer, ContentFormatter, crc32, normalizeZipEntryPath, scoreFuzzyMatch } from '../../utils'

suite('Stackr New Features Test Suite', () => {
  suite('Zip Builder', () => {
    test('normalizeZipEntryPath converts backslashes and strips traversal segments', () => {
      assert.strictEqual(normalizeZipEntryPath('src\\utils\\zip-builder.ts'), 'src/utils/zip-builder.ts')
      assert.strictEqual(normalizeZipEntryPath('/leading/slash/../file.ts'), 'leading/slash/file.ts')
      assert.strictEqual(normalizeZipEntryPath('C:\\repo\\src\\index.ts'), 'repo/src/index.ts')
    })

    test('crc32 matches standard IEEE 802.3 vector', () => {
      const data = new TextEncoder().encode('123456789')
      assert.strictEqual(crc32(data), 0xcbf43926)
    })

    test('buildZipBuffer produces valid ZIP structure with mirrored folder paths', () => {
      const zip = buildZipBuffer([
        { path: 'src/a.ts', data: new TextEncoder().encode('export const a = 1\n') },
        { path: 'src/nested/b.ts', data: new TextEncoder().encode('export const b = 2\n') },
      ])

      const buf = Buffer.from(zip)
      assert.strictEqual(buf.readUInt32LE(0), 0x04034b50, 'Must start with local file header signature')
      assert.strictEqual(buf.readUInt32LE(buf.length - 22), 0x06054b50, 'Must end with EOCD signature')
      assert.strictEqual(buf.readUInt16LE(buf.length - 12), 2, 'Total entry count must be 2')
    })
  })

  suite('Multi-Source Target Resolution (Explorer, Git SCM, Tabs)', () => {
    test('resolves Explorer multi-select (clickedUri, selectedUris[])', () => {
      const u1 = vscode.Uri.file('/workspace/a.ts')
      const u2 = vscode.Uri.file('/workspace/b.ts')
      const result = resolveTargets(u1, [u1, u2])
      assert.strictEqual(result.length, 2)
      assert.strictEqual(result[0].fsPath, u1.fsPath)
      assert.strictEqual(result[1].fsPath, u2.fsPath)
    })

    test('resolves variadic Git SCM SourceControlResourceState args', () => {
      const u1 = vscode.Uri.file('/workspace/staged1.ts')
      const u2 = vscode.Uri.file('/workspace/staged2.ts')
      const result = resolveTargets({ resourceUri: u1 }, { resourceUri: u2 })
      assert.strictEqual(result.length, 2)
      assert.strictEqual(result[0].fsPath, u1.fsPath)
      assert.strictEqual(result[1].fsPath, u2.fsPath)
    })

    test('resolves Git SCM SourceControlResourceGroup arg', () => {
      const u1 = vscode.Uri.file('/workspace/change1.ts')
      const u2 = vscode.Uri.file('/workspace/change2.ts')
      const group = { resourceStates: [{ resourceUri: u1 }, { resourceUri: u2 }] }
      const result = resolveTargets(group)
      assert.strictEqual(result.length, 2)
    })

    test('deduplicates overlapping URIs across arguments', () => {
      const u1 = vscode.Uri.file('/workspace/dup.ts')
      const result = resolveTargets(u1, { resourceUri: u1 })
      assert.strictEqual(result.length, 1)
    })

    test('parseCopiedTabPaths extracts multi-selected tab paths and validates anchor membership', () => {
      const sentinel = '__sentinel__'
      const copied = '/workspace/a.ts\n/workspace/b.ts\r\n/workspace/c.ts'
      const paths = parseCopiedTabPaths(copied, sentinel, '/workspace/b.ts')
      assert.deepStrictEqual(paths, ['/workspace/a.ts', '/workspace/b.ts', '/workspace/c.ts'])

      assert.deepStrictEqual(parseCopiedTabPaths(sentinel, sentinel, '/workspace/b.ts'), [])
      assert.deepStrictEqual(parseCopiedTabPaths('/workspace/a.ts', sentinel, '/workspace/a.ts'), [])
      assert.deepStrictEqual(parseCopiedTabPaths('/workspace/a.ts\n/workspace/c.ts', sentinel, '/workspace/b.ts'), [])
    })
  })

  suite('Git Porcelain & Diff Parsers', () => {
    test('parseGitPorcelainZ parses changed, staged, renamed, untracked, and skips deleted', () => {
      const sample =
        [
          'M  src/staged.ts',
          ' M src/modified.ts',
          '?? src/untracked.ts',
          'R  src/new-name.ts',
          'src/old-name.ts',
          ' D src/deleted-wt.ts',
          'D  src/deleted-idx.ts',
        ].join('\0') + '\0'

      assert.deepStrictEqual(parseGitPorcelainZ(sample, 'all'), [
        'src/staged.ts',
        'src/modified.ts',
        'src/untracked.ts',
        'src/new-name.ts',
      ])

      assert.deepStrictEqual(parseGitPorcelainZ(sample, 'staged'), ['src/staged.ts', 'src/new-name.ts'])
    })

    test('parseGitNameOnlyZ splits NUL-delimited diff output', () => {
      assert.deepStrictEqual(parseGitNameOnlyZ('a.ts\0src/b c.ts\0'), ['a.ts', 'src/b c.ts'])
    })
  })

  suite('TreeBuilder.getParent & Sort by Token Count', () => {
    test('tracks parent folders for nested files and folders', async () => {
      const builder = new TreeBuilder()
      const rootFile: StagedFile = {
        type: 'file',
        uri: vscode.Uri.file('/root.ts'),
        label: 'root.ts',
        pathSegments: ['root.ts'],
      }
      const nestedFile: StagedFile = {
        type: 'file',
        uri: vscode.Uri.file('/src/utils/helper.ts'),
        label: 'helper.ts',
        pathSegments: ['src', 'utils', 'helper.ts'],
      }

      const roots = await builder.buildAsync([rootFile, nestedFile])
      assert.strictEqual(builder.getParent(rootFile), undefined)

      const srcFolder = roots.find((item) => isStagedFolder(item) && item.label === 'src')
      assert.ok(srcFolder && isStagedFolder(srcFolder))
      assert.strictEqual(builder.getParent(srcFolder), undefined)

      const utilsFolder = srcFolder.children.find((item) => isStagedFolder(item) && item.label === 'utils')
      assert.ok(utilsFolder && isStagedFolder(utilsFolder))
      assert.strictEqual(builder.getParent(utilsFolder), srcFolder)
      assert.strictEqual(builder.getParent(nestedFile), utilsFolder)
    })

    test('sorts files by token count descending while keeping pinned items first', async () => {
      const builder = new TreeBuilder()
      builder.setSortOrder('tokensDesc')

      const smallPinned: StagedFile = {
        type: 'file',
        uri: vscode.Uri.file('/small-pinned.ts'),
        label: 'small-pinned.ts',
        pathSegments: ['small-pinned.ts'],
        isPinned: true,
        stats: { tokenCount: 50, charCount: 200 },
      }
      const medium: StagedFile = {
        type: 'file',
        uri: vscode.Uri.file('/a-medium.ts'),
        label: 'a-medium.ts',
        pathSegments: ['a-medium.ts'],
        stats: { tokenCount: 500, charCount: 2000 },
      }
      const large: StagedFile = {
        type: 'file',
        uri: vscode.Uri.file('/z-large.ts'),
        label: 'z-large.ts',
        pathSegments: ['z-large.ts'],
        stats: { tokenCount: 4000, charCount: 16000 },
      }

      const roots = await builder.buildAsync([medium, large, smallPinned])
      assert.deepStrictEqual(
        roots.map((r) => r.label),
        ['small-pinned.ts', 'z-large.ts', 'a-medium.ts'],
      )
    })
  })

  suite('ContentFormatter Context Map Only', () => {
    test('formats ASCII context map without reading file contents when skipContents is true', async () => {
      const files: StagedFile[] = [
        { type: 'file', uri: vscode.Uri.file('/nonexistent-a.ts'), label: 'nonexistent-a.ts' },
        { type: 'file', uri: vscode.Uri.file('/nonexistent-b.ts'), label: 'nonexistent-b.ts' },
      ]

      const output = await ContentFormatter.format(files, { forceTree: true, skipContents: true })
      assert.ok(output.includes('```'), 'Output should contain fenced tree block')
      assert.ok(output.includes('nonexistent-a.ts'), 'Output should include first file path')
      assert.ok(output.includes('nonexistent-b.ts'), 'Output should include second file path')
      assert.ok(!output.includes('File: '), 'Output should not include file content blocks')
    })
  })

  suite('Open Tabs Collection (Exclude Pinned & Active Group)', () => {
    function makeTab(uri: vscode.Uri, isPinned: boolean): vscode.Tab {
      return {
        label: uri.path.split('/').pop() || '',
        group: {} as vscode.TabGroup,
        input: new vscode.TabInputText(uri),
        isActive: false,
        isDirty: false,
        isPinned,
        isPreview: false,
      }
    }

    test('collects all tabs, excludes pinned tabs, or limits to active group', () => {
      const a = vscode.Uri.file('/ws/a.ts')
      const bPinned = vscode.Uri.file('/ws/b-pinned.ts')
      const cGroup2 = vscode.Uri.file('/ws/c.ts')

      const group1 = {
        isActive: false,
        viewColumn: 1,
        activeTab: undefined,
        tabs: [makeTab(a, false), makeTab(bPinned, true)],
      }
      const group2 = {
        isActive: true,
        viewColumn: 2,
        activeTab: undefined,
        tabs: [makeTab(cGroup2, false), makeTab(a, false)],
      }
      const tabGroups = { all: [group1, group2], activeTabGroup: group2 }

      const allUris = collectOpenTabUris(tabGroups)
      assert.deepStrictEqual(
        allUris.map((u) => u.fsPath),
        [a.fsPath, bPinned.fsPath, cGroup2.fsPath],
      )

      const unpinnedUris = collectOpenTabUris(tabGroups, { excludePinned: true })
      assert.deepStrictEqual(
        unpinnedUris.map((u) => u.fsPath),
        [a.fsPath, cGroup2.fsPath],
      )

      const activeGroupUris = collectOpenTabUris(tabGroups, { activeGroupOnly: true })
      assert.deepStrictEqual(
        activeGroupUris.map((u) => u.fsPath),
        [cGroup2.fsPath, a.fsPath],
      )
    })
  })

  suite('Fuzzy Search & Path Splitting', () => {
    // cspell:ignore lpag
    test('scoreFuzzyMatch matches subsequence lpag against LandingPage.tsx and path queries', () => {
      const target = 'docs/src/LandingPage.tsx'
      const landingScore = scoreFuzzyMatch('lpag', target)
      const unrelatedScore = scoreFuzzyMatch('lpag', 'packages/cli/package.json')

      assert.ok(landingScore !== undefined, 'lpag should match LandingPage.tsx')
      assert.strictEqual(unrelatedScore, undefined)

      assert.ok(scoreFuzzyMatch('src/lpag', target) !== undefined, 'src/lpag should match full relative path')
      assert.ok(scoreFuzzyMatch('docs lpag', target) !== undefined, 'space-separated tokens should match')
      assert.strictEqual(scoreFuzzyMatch('xyz', target), undefined)
    })

    test('splitRelativePath separates filename and directory across separators', () => {
      assert.deepStrictEqual(splitRelativePath('docs/src/LandingPage.tsx'), {
        fileName: 'LandingPage.tsx',
        dirPath: 'docs/src',
        relPath: 'docs/src/LandingPage.tsx',
      })
      assert.deepStrictEqual(splitRelativePath('docs\\src\\LandingPage.tsx'), {
        fileName: 'LandingPage.tsx',
        dirPath: 'docs\\src',
        relPath: 'docs\\src\\LandingPage.tsx',
      })
      assert.deepStrictEqual(splitRelativePath('README.md'), {
        fileName: 'README.md',
        dirPath: '',
        relPath: 'README.md',
      })
    })
  })

  suite('Track Clear Stack', () => {
    test('determineClearAction reports empty, allPinned, and confirm states for named tracks', () => {
      assert.deepStrictEqual(determineClearAction([], 'docs'), {
        type: 'empty',
        message: 'Track "docs" is already empty.',
      })

      const pinnedFile: StagedFile = {
        type: 'file',
        uri: vscode.Uri.file('/ws/pinned.ts'),
        label: 'pinned.ts',
        isPinned: true,
      }
      const normalFile: StagedFile = {
        type: 'file',
        uri: vscode.Uri.file('/ws/normal.ts'),
        label: 'normal.ts',
        isPinned: false,
      }

      assert.deepStrictEqual(determineClearAction([pinnedFile], 'docs'), {
        type: 'allPinned',
        message: 'All files in track "docs" are pinned. Unpin them to clear.',
      })

      const mixedAction = determineClearAction([pinnedFile, normalFile], 'docs')
      assert.strictEqual(mixedAction.type, 'confirm')
      assert.ok(mixedAction.message.includes('track "docs"'))
      assert.ok(mixedAction.message.includes('1 pinned files will remain'))
    })

    test('TrackManager.clearTrack clears unpinned files on target track while keeping pinned files', () => {
      const sandbox = sinon.createSandbox()
      const persistenceMock = {
        saveImmediate: sandbox.stub().resolves(),
        requestSave: sandbox.stub(),
        clear: sandbox.stub().resolves(),
      }
      const hydrationMock = {
        hydrate: sandbox.stub().resolves(null),
      }
      const contextMock = {
        globalState: { get: sandbox.stub(), update: sandbox.stub().resolves() },
        extensionPath: '/mock/path',
        subscriptions: [],
      }

      const manager = new TrackManager(contextMock as any, persistenceMock as any, hydrationMock as any)
      try {
        const secondaryId = manager.createTrack('Docs', false)
        const secondary = manager.getTrackById(secondaryId)!
        secondary.files.push(
          { type: 'file', uri: vscode.Uri.file('/ws/keep.ts'), label: 'keep.ts', isPinned: true },
          { type: 'file', uri: vscode.Uri.file('/ws/drop.ts'), label: 'drop.ts', isPinned: false },
        )

        manager.clearTrack(secondaryId)

        assert.strictEqual(manager.getActiveTrack().id, 'default', 'Active track must remain unchanged')
        assert.deepStrictEqual(
          secondary.files.map((f) => f.label),
          ['keep.ts'],
        )
      } finally {
        manager.dispose()
        sandbox.restore()
      }
    })
  })
})
