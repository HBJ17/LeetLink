// Committing collected submissions against an in-memory repository.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitIdentity, InlineTreeEntry, TreeEntry } from '../src/lib/github';
import { gitBlobSha } from '../src/lib/hash';
import type { ImportItem, ImportState } from '../src/lib/storage';

const store: Record<string, unknown> = {};
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: store[key] }),
      set: async (items: Record<string, unknown>) => Object.assign(store, items),
    },
  },
});

interface FakeCommit {
  message: string;
  files: Record<string, string>;
  author?: GitIdentity;
  committer?: GitIdentity;
}

/** Repository content (path to text) and its history; `empty` means no commits yet. */
let files: Record<string, string> = {};
let empty = false;
let commits: FakeCommit[] = [];
let pendingTrees = new Map<string, Record<string, string>>();
let failUpdateRef: Error | null = null;

class FakeClient {
  readonly fullName = 'me/solutions';
  async getDefaultBranch() {
    return 'main';
  }
  async getNoreplyIdentity() {
    return { name: 'HBJ', email: '123+hbj@users.noreply.github.com' };
  }
  async getRef(): Promise<string | null> {
    const { EmptyRepositoryError } = await import('../src/lib/github');
    if (empty) throw new EmptyRepositoryError('Repository is empty');
    return `head${commits.length}`;
  }
  async getCommitTree() {
    return `tree${commits.length}`;
  }
  private async entries(): Promise<TreeEntry[]> {
    const out = new Map<string, TreeEntry>();
    for (const [path, content] of Object.entries(files)) {
      const parts = path.split('/');
      for (let i = 1; i < parts.length; i++) {
        const dir = parts.slice(0, i).join('/');
        out.set(dir, { path: dir, mode: '040000', type: 'tree', sha: `t-${dir}` });
      }
      out.set(path, { path, mode: '100644', type: 'blob', sha: await gitBlobSha(content) });
    }
    return [...out.values()];
  }
  async readTreeWithStatus() {
    return { entries: await this.entries(), truncated: false };
  }
  async listFolder(_tree: string, folder: string): Promise<TreeEntry[]> {
    const prefix = `${folder}/`;
    return (await this.entries())
      .filter((e) => e.path.startsWith(prefix) && !e.path.slice(prefix.length).includes('/'))
      .map((e) => ({ ...e, path: e.path.slice(prefix.length) }));
  }
  async createTree(_base: string, entries: InlineTreeEntry[]) {
    const id = `new-tree-${pendingTrees.size}`;
    pendingTrees.set(id, Object.fromEntries(entries.map((e) => [e.path, e.content])));
    return id;
  }
  async createCommit(params: { message: string; tree: string; author?: GitIdentity; committer?: GitIdentity }) {
    const commit: FakeCommit = { message: params.message, files: pendingTrees.get(params.tree) ?? {} };
    if (params.author) commit.author = params.author;
    if (params.committer) commit.committer = params.committer;
    commits.push(commit);
    return `c${commits.length}`;
  }
  async updateRef() {
    if (failUpdateRef) {
      commits.pop();
      throw failUpdateRef;
    }
    Object.assign(files, commits[commits.length - 1]?.files);
  }
  async createFileWithContentsApi(
    _branch: string,
    file: { path: string; content: string },
    message: string,
    identity?: { author: GitIdentity; committer: GitIdentity },
  ) {
    empty = false;
    commits.push({ message, files: { [file.path]: file.content }, ...identity });
    files[file.path] = file.content;
    return `c${commits.length}`;
  }
}

vi.mock('../src/lib/github', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/github')>()),
  GitHubClient: FakeClient,
}));

const { runImport } = await import('../src/background/backfill');

const twoSum = { frontendId: '1', title: 'Two Sum', titleSlug: 'two-sum', difficulty: 'Easy', topicTags: [] };
const parens = { frontendId: '20', title: 'Valid Parentheses', titleSlug: 'valid-parentheses', difficulty: 'Easy', topicTags: [] };

function item(id: string, problem: typeof twoSum, code: string, isoDate: string): ImportItem {
  return { submissionId: id, problem, lang: 'python3', code, timestamp: Date.parse(isoDate), runtime: null, memory: null };
}

const noSleep = async () => undefined;

function state(): ImportState {
  return store['importState'] as ImportState;
}

function startWith(items: ImportItem[], overrides: Partial<ImportState> = {}): void {
  store['settings'] = { token: 't', owner: 'me', repo: 'solutions', branch: '' };
  store['importItems'] = items;
  store['importState'] = { status: 'importing', next: 0, total: items.length, pushed: 0, skipped: 0, ...overrides };
}

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  files = { 'README.md': '# Solutions\n' };
  empty = false;
  commits = [];
  pendingTrees = new Map();
  failUpdateRef = null;
});

describe('runImport', () => {
  it('commits each submission oldest first, dated when it was submitted', async () => {
    startWith([
      item('1', twoSum, 'brute()', '2024-01-05T10:00:00.000Z'),
      item('2', parens, 'stack()', '2024-02-01T08:30:00.000Z'),
      item('3', twoSum, 'hashmap()', '2024-03-10T21:15:00.000Z'),
    ]);
    await runImport({ sleep: noSleep });

    expect(commits.map((c) => c.message)).toEqual(['0001_two-sum', '0020_valid-parentheses', '0001_two-sum']);
    expect(commits.map((c) => c.author?.date)).toEqual([
      '2024-01-05T10:00:00.000Z',
      '2024-02-01T08:30:00.000Z',
      '2024-03-10T21:15:00.000Z',
    ]);
    expect(commits[0]?.author).toEqual(commits[0]?.committer);
    expect(commits[0]?.author).toMatchObject({ name: 'HBJ', email: '123+hbj@users.noreply.github.com' });
    expect(files['0001_two-sum/two-sum_py_1.py']).toBe('brute()');
    expect(files['0001_two-sum/two-sum_py_2.py']).toBe('hashmap()');
    expect(files['0020_valid-parentheses/valid-parentheses_py_1.py']).toBe('stack()');
    expect(Object.keys(files).filter((p) => p.endsWith('README.md'))).toEqual(['README.md']);
    expect(state()).toMatchObject({ status: 'done', next: 3, pushed: 3, skipped: 0 });
  });

  it('skips code already in the repository and uses existing folders', async () => {
    files['1-two-sum/solution.py'] = 'brute()';
    startWith([item('1', twoSum, 'brute()', '2024-01-05T10:00:00Z'), item('2', twoSum, 'better()', '2024-01-06T10:00:00Z')]);
    await runImport({ sleep: noSleep });

    expect(commits).toHaveLength(1);
    expect(files['1-two-sum/two-sum_py_1.py']).toBe('better()');
    expect(state()).toMatchObject({ status: 'done', pushed: 1, skipped: 1 });
  });

  it('stops when paused and continues from the next item', async () => {
    startWith([
      item('1', twoSum, 'a()', '2024-01-01T00:00:00Z'),
      item('2', twoSum, 'b()', '2024-01-02T00:00:00Z'),
      item('3', twoSum, 'c()', '2024-01-03T00:00:00Z'),
    ]);
    const pauseAfterFirst = async () => {
      (store['importState'] as ImportState).status = 'paused';
    };
    await runImport({ sleep: pauseAfterFirst });
    expect(commits).toHaveLength(1);
    expect(state()).toMatchObject({ status: 'paused', next: 1 });

    (store['importState'] as ImportState).status = 'importing';
    await runImport({ sleep: noSleep });
    expect(commits.map((c) => Object.values(c.files)[0])).toEqual(['a()', 'b()', 'c()']);
    expect(state()).toMatchObject({ status: 'done', next: 3, pushed: 3 });
  });

  it('does nothing unless an import is running', async () => {
    startWith([item('1', twoSum, 'a()', '2024-01-01T00:00:00Z')], { status: 'cancelled' });
    await runImport({ sleep: noSleep });
    expect(commits).toHaveLength(0);
  });

  it('creates the first commit of an empty repository with the original date', async () => {
    files = {};
    empty = true;
    startWith([item('1', twoSum, 'a()', '2024-01-01T00:00:00.000Z'), item('2', twoSum, 'b()', '2024-01-02T00:00:00.000Z')]);
    await runImport({ sleep: noSleep });

    expect(commits.map((c) => c.author?.date)).toEqual(['2024-01-01T00:00:00.000Z', '2024-01-02T00:00:00.000Z']);
    expect(Object.keys(files).sort()).toEqual(['0001_two-sum/two-sum_py_1.py', '0001_two-sum/two-sum_py_2.py']);
  });

  it('stops with a clear error at a protected branch', async () => {
    const { HttpError } = await import('../src/lib/http');
    failUpdateRef = new HttpError(422, '422: Protected branch update failed', {
      message: 'Protected branch update failed for refs/heads/main.',
    });
    startWith([item('1', twoSum, 'a()', '2024-01-01T00:00:00Z')]);
    await runImport({ sleep: noSleep });

    expect(state().status).toBe('error');
    expect(state().error).toContain('"main" in me/solutions is protected');
    expect(state().next).toBe(0);
  });
});

describe('resumeImport', () => {
  it('continues committing from where a paused import stopped', async () => {
    const { resumeImport } = await import('../src/background/backfill');
    startWith(
      [item('1', twoSum, 'a()', '2024-01-01T00:00:00Z'), item('2', twoSum, 'b()', '2024-01-02T00:00:00Z')],
      { status: 'paused', next: 1, pushed: 1, collect: { offset: 2, lastKey: null, scanned: 2, done: true } },
    );
    files['0001_two-sum/two-sum_py_1.py'] = 'a()';

    await resumeImport();
    await vi.waitFor(() => expect(state().status).toBe('done'), { timeout: 10_000 });
    expect(commits.map((c) => Object.values(c.files)[0])).toEqual(['b()']);
    expect(state()).toMatchObject({ next: 2, pushed: 2 });
  });
});
