// Push and duplicate checks against an in-memory repository.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommitFilesOptions, TreeEntry } from '../src/lib/github';
import { gitBlobSha } from '../src/lib/hash';
import type { ProblemInfo, PushRequest, SubmissionResult } from '../src/lib/messages';

/** Repository content: path to file text. */
let files: Record<string, string> = {};
let commits: CommitFilesOptions[] = [];

class FakeClient {
  readonly fullName = 'me/solutions';
  commitUrl(sha: string): string {
    return `https://github.com/me/solutions/commit/${sha}`;
  }
  async getDefaultBranch(): Promise<string> {
    return 'main';
  }
  async getRef(): Promise<string> {
    return 'head';
  }
  async getCommitTree(): Promise<string> {
    return 'root';
  }
  private async entries(): Promise<TreeEntry[]> {
    const out = new Map<string, TreeEntry>();
    for (const [path, content] of Object.entries(files)) {
      const parts = path.split('/');
      for (let i = 1; i < parts.length; i++) {
        const dir = parts.slice(0, i).join('/');
        out.set(dir, { path: dir, mode: '040000', type: 'tree', sha: `tree-${dir}` });
      }
      out.set(path, { path, mode: '100644', type: 'blob', sha: await gitBlobSha(content) });
    }
    return [...out.values()];
  }
  async readTreeWithStatus(): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    return { entries: await this.entries(), truncated: false };
  }
  async listFolder(_root: string, folder: string): Promise<TreeEntry[]> {
    const prefix = `${folder}/`;
    return (await this.entries())
      .filter((e) => e.path.startsWith(prefix) && !e.path.slice(prefix.length).includes('/'))
      .map((e) => ({ ...e, path: e.path.slice(prefix.length) }));
  }
  async readBlob(sha: string): Promise<string> {
    for (const content of Object.values(files)) if ((await gitBlobSha(content)) === sha) return content;
    throw new Error('missing blob');
  }
  async commitOnto(_parent: string, options: CommitFilesOptions): Promise<{ sha: string; htmlUrl: string }> {
    commits.push(options);
    for (const file of options.files) files[file.path] = file.content;
    return { sha: `c${commits.length}`, htmlUrl: this.commitUrl(`c${commits.length}`) };
  }
}

vi.mock('../src/lib/storage', () => ({
  getSettings: async () => ({ token: 't', owner: 'me', repo: 'solutions', branch: '' }),
  isConnected: () => true,
}));

vi.mock('../src/lib/github', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/github')>()),
  GitHubClient: FakeClient,
}));

const { findCommittedCopy, pushSubmission } = await import('../src/background/push');

const problem: ProblemInfo = { frontendId: '1', title: 'Two Sum', titleSlug: 'two-sum', difficulty: 'Easy', topicTags: [] };
const code = 'class Solution:\n    pass\n';
const submission: SubmissionResult = {
  submissionId: '1',
  titleSlug: 'two-sum',
  lang: 'python3',
  code,
  statusCode: 10,
  statusMsg: 'Accepted',
  runtime: '3 ms',
  memory: null,
  timestamp: 0,
};

function request(overrides: Partial<PushRequest> = {}): PushRequest {
  return { problem, submission, message: '0001_two-sum_3ms', notes: null, allowDuplicate: false, ...overrides };
}

beforeEach(() => {
  files = { 'README.md': '# Solutions\n' };
  commits = [];
});

describe('pushSubmission', () => {
  it('creates the default folder for a new problem', async () => {
    const result = await pushSubmission(request());
    expect(result).toMatchObject({ ok: true, path: '0001_two-sum/two-sum_py_1.py' });
    expect(files['0001_two-sum/two-sum_py_1.py']).toBe(code);
  });

  it('adds to a folder made by another tool instead of creating a second one', async () => {
    files['1-two-sum/solution.py'] = 'print("old")\n';
    const result = await pushSubmission(request());
    expect(result).toMatchObject({ ok: true, path: '1-two-sum/two-sum_py_1.py' });
    expect(Object.keys(files).some((p) => p.startsWith('0001_two-sum/'))).toBe(false);
    expect(files['1-two-sum/solution.py']).toBe('print("old")\n');
  });

  it('refuses identical code unless allowed, and never overwrites', async () => {
    files['0001_two-sum/two-sum_py_1.py'] = code;

    expect(await pushSubmission(request())).toEqual({
      ok: false,
      error: 'Already committed as 0001_two-sum/two-sum_py_1.py.',
      duplicatePath: '0001_two-sum/two-sum_py_1.py',
    });
    expect(commits).toHaveLength(0);

    const forced = await pushSubmission(request({ allowDuplicate: true }));
    expect(forced).toMatchObject({ ok: true, path: '0001_two-sum/two-sum_py_2.py' });
  });

  it('adds different code with the next number', async () => {
    files['0001_two-sum/two-sum_py_1.py'] = 'print("brute force")\n';
    expect(await pushSubmission(request())).toMatchObject({ ok: true, path: '0001_two-sum/two-sum_py_2.py' });
  });

  it('reads folders that do not start with a number before writing to them', async () => {
    const contest = { ...problem, frontendId: 'LCP 01', titleSlug: 'guess-numbers' };
    files['lcp-01_guess-numbers/guess-numbers_py_1.py'] = 'print(1)\n';
    const result = await pushSubmission(request({ problem: contest }));
    expect(result).toMatchObject({ ok: true, path: 'lcp-01_guess-numbers/guess-numbers_py_2.py' });
  });

  it('appends notes to an existing README', async () => {
    files['0001_two-sum/README.md'] = '# 1. Two Sum\n\nOld notes\n';
    await pushSubmission(request({ notes: 'Use a hash map.' }));
    expect(files['0001_two-sum/README.md']).toBe('# 1. Two Sum\n\nOld notes\n\n### two-sum_py_1.py\n\nUse a hash map.\n');
    expect(commits[0]?.files).toHaveLength(2);
  });
});

describe('findCommittedCopy', () => {
  it('finds identical code in a matching folder', async () => {
    files['1-two-sum/solution.py'] = code;
    expect(await findCommittedCopy({ problem, code })).toEqual({ ok: true, duplicatePath: '1-two-sum/solution.py' });
  });

  it('returns null for new code', async () => {
    files['0001_two-sum/two-sum_py_1.py'] = 'print("other")\n';
    expect(await findCommittedCopy({ problem, code })).toEqual({ ok: true, duplicatePath: null });
  });
});
