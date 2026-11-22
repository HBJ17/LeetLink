import { describe, expect, it, vi } from 'vitest';
import type { GitHubClient, TreeEntry } from '../src/lib/github';
import {
  folderFiles,
  indexTree,
  matchProblemFolder,
  parseFolderName,
  scanRepository,
  type ProblemFolder,
} from '../src/lib/repo-scan';

function tree(path: string): TreeEntry {
  return { path, mode: '040000', type: 'tree', sha: `tree-${path}` };
}

function blob(path: string, sha = `sha-${path}`): TreeEntry {
  return { path, mode: '100644', type: 'blob', sha };
}

describe('parseFolderName', () => {
  it.each([
    ['0001_two-sum', 1, 'two-sum'],
    ['1-two-sum', 1, 'two-sum'],
    ['0001-two-sum', 1, 'two-sum'],
    ['1. Two Sum', 1, 'two-sum'],
    ['0146_LRU_Cache', 146, 'lru-cache'],
    ['2000 reverse-prefix-of-word', 2000, 'reverse-prefix-of-word'],
  ])('reads %s', (name, number, slug) => {
    expect(parseFolderName(name)).toEqual({ number, slug });
  });

  it.each(['src', 'two-sum', '0001', '0001_', '1-_-', 'node_modules', '.github'])('ignores %s', (name) => {
    expect(parseFolderName(name)).toBeNull();
  });
});

describe('indexTree', () => {
  const entries = [
    tree('src'),
    blob('src/index.ts'),
    tree('0001_two-sum'),
    blob('0001_two-sum/two-sum_py_1.py', 'aaa'),
    blob('0001_two-sum/README.md', 'bbb'),
    tree('leetcode'),
    tree('leetcode/20-valid-parentheses'),
    blob('leetcode/20-valid-parentheses/solution.cpp', 'ccc'),
    blob('README.md'),
  ];

  it('finds problem folders at any depth with their files', () => {
    expect(indexTree(entries, true)).toEqual([
      {
        path: '0001_two-sum',
        number: 1,
        slug: 'two-sum',
        files: [
          { name: 'two-sum_py_1.py', sha: 'aaa' },
          { name: 'README.md', sha: 'bbb' },
        ],
      },
      { path: 'leetcode/20-valid-parentheses', number: 20, slug: 'valid-parentheses', files: [{ name: 'solution.cpp', sha: 'ccc' }] },
    ]);
  });

  it('leaves files unloaded for a top-level listing', () => {
    const folders = indexTree([tree('src'), tree('0001_two-sum'), blob('README.md')], false);
    expect(folders).toEqual([{ path: '0001_two-sum', number: 1, slug: 'two-sum', files: null }]);
  });
});

describe('matchProblemFolder', () => {
  const folder = (path: string, number: number, slug: string): ProblemFolder => ({ path, number, slug, files: [] });
  const twoSum = { frontendId: '1', titleSlug: 'two-sum' };

  it('matches folders from other tools by number and slug', () => {
    expect(matchProblemFolder([folder('1-two-sum', 1, 'two-sum')], twoSum)?.path).toBe('1-two-sum');
  });

  it('prefers a folder matching both number and slug', () => {
    const folders = [folder('1-notes', 1, 'notes'), folder('two/0001_two-sum', 1, 'two-sum')];
    expect(matchProblemFolder(folders, twoSum)?.path).toBe('two/0001_two-sum');
  });

  it('falls back to slug, then number', () => {
    expect(matchProblemFolder([folder('9_two-sum', 9, 'two-sum')], twoSum)?.path).toBe('9_two-sum');
    expect(matchProblemFolder([folder('0001_twosum', 1, 'twosum')], twoSum)?.path).toBe('0001_twosum');
  });

  it('returns null when nothing matches', () => {
    expect(matchProblemFolder([folder('0002_add-two-numbers', 2, 'add-two-numbers')], twoSum)).toBeNull();
  });
});

describe('scanRepository', () => {
  function fakeClient(truncated: boolean) {
    const readTreeWithStatus = vi.fn(async (_sha: string, recursive: boolean) =>
      recursive
        ? { entries: [tree('0001_two-sum'), blob('0001_two-sum/a.py', 'aaa')], truncated }
        : { entries: [tree('0001_two-sum'), tree('src')], truncated: false },
    );
    const listFolder = vi.fn(async () => [blob('a.py', 'aaa'), tree('nested')]);
    return { client: { readTreeWithStatus, listFolder } as unknown as GitHubClient, readTreeWithStatus, listFolder };
  }

  it('indexes the whole tree in one request', async () => {
    const { client, readTreeWithStatus } = fakeClient(false);
    const index = await scanRepository(client, 'root');
    expect(index.complete).toBe(true);
    expect(index.folders[0]?.files).toEqual([{ name: 'a.py', sha: 'aaa' }]);
    expect(readTreeWithStatus).toHaveBeenCalledTimes(1);
  });

  it('falls back to top-level folders when the tree is truncated, loading files on demand', async () => {
    const { client, listFolder } = fakeClient(true);
    const index = await scanRepository(client, 'root');
    expect(index.complete).toBe(false);
    const [first] = index.folders;
    expect(first?.files).toBeNull();
    expect(await folderFiles(client, 'root', first as ProblemFolder)).toEqual([{ name: 'a.py', sha: 'aaa' }]);
    expect(listFolder).toHaveBeenCalledWith('root', '0001_two-sum');
  });
});
