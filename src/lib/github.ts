// GitHub Git Data API client. The only module that knows GitHub's endpoints.
// A commit is built from blobs and a tree so several files land in one commit
// and author/committer dates can be set.

import { HttpError, request, type RequestOptions } from './http';

const API = 'https://api.github.com';

export interface FileChange {
  /** Path from the repository root, e.g. `0001_two-sum/two-sum_py_1.py`. */
  path: string;
  content: string;
}

export interface GitIdentity {
  name: string;
  email: string;
  /** ISO 8601 timestamp. */
  date?: string;
}

export interface TreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
}

export interface CommitResult {
  sha: string;
  htmlUrl: string;
}

export interface CommitFilesOptions {
  branch: string;
  message: string;
  files: FileChange[];
  author?: GitIdentity;
  committer?: GitIdentity;
}

/** Thrown when the repository has no commits yet. */
export class EmptyRepositoryError extends Error {
  override name = 'EmptyRepositoryError';
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToUtf8(base64: string): string {
  const binary = atob(base64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export class GitHubClient {
  constructor(
    private readonly token: string,
    readonly owner: string,
    readonly repo: string,
  ) {}

  private call<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return request<T>(`${API}/repos/${this.owner}/${this.repo}${path}`, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...options.headers,
      },
    });
  }

  commitUrl(sha: string): string {
    return `https://github.com/${this.owner}/${this.repo}/commit/${sha}`;
  }

  async getDefaultBranch(): Promise<string> {
    const repo = await this.call<{ default_branch: string }>('');
    return repo.default_branch;
  }

  /** Commit SHA the branch points at, or null when the branch does not exist. */
  async getRef(branch: string): Promise<string | null> {
    try {
      const ref = await this.call<{ object: { sha: string } }>(`/git/ref/heads/${encodeURIComponent(branch)}`);
      return ref.object.sha;
    } catch (err) {
      if (err instanceof HttpError && err.status === 409) throw new EmptyRepositoryError('Repository is empty');
      if (err instanceof HttpError && err.status === 404) return null;
      throw err;
    }
  }

  async getCommitTree(commitSha: string): Promise<string> {
    const commit = await this.call<{ tree: { sha: string } }>(`/git/commits/${commitSha}`);
    return commit.tree.sha;
  }

  async readTree(treeSha: string, recursive = false): Promise<TreeEntry[]> {
    const suffix = recursive ? '?recursive=1' : '';
    const tree = await this.call<{ tree: TreeEntry[] }>(`/git/trees/${treeSha}${suffix}`);
    return tree.tree;
  }

  /** Entries directly inside `folder` (one level, no recursion). Empty when the folder does not exist. */
  async listFolder(rootTreeSha: string, folder: string): Promise<TreeEntry[]> {
    let treeSha = rootTreeSha;
    for (const part of folder.split('/').filter(Boolean)) {
      const entries = await this.readTree(treeSha);
      const next = entries.find((e) => e.type === 'tree' && e.path === part);
      if (!next) return [];
      treeSha = next.sha;
    }
    return this.readTree(treeSha);
  }

  async readBlob(blobSha: string): Promise<string> {
    const blob = await this.call<{ content: string; encoding: string }>(`/git/blobs/${blobSha}`);
    return blob.encoding === 'base64' ? base64ToUtf8(blob.content) : blob.content;
  }

  async createBlob(content: string): Promise<string> {
    const blob = await this.call<{ sha: string }>('/git/blobs', {
      method: 'POST',
      json: { content: utf8ToBase64(content), encoding: 'base64' },
    });
    return blob.sha;
  }

  async createTree(baseTree: string | null, entries: TreeEntry[]): Promise<string> {
    const json: Record<string, unknown> = { tree: entries };
    if (baseTree) json['base_tree'] = baseTree;
    const tree = await this.call<{ sha: string }>('/git/trees', { method: 'POST', json });
    return tree.sha;
  }

  async createCommit(params: {
    message: string;
    tree: string;
    parents: string[];
    author?: GitIdentity;
    committer?: GitIdentity;
  }): Promise<string> {
    const commit = await this.call<{ sha: string }>('/git/commits', { method: 'POST', json: params });
    return commit.sha;
  }

  async updateRef(branch: string, sha: string): Promise<void> {
    await this.call(`/git/refs/heads/${encodeURIComponent(branch)}`, {
      method: 'PATCH',
      json: { sha, force: false },
    });
  }

  async createRef(branch: string, sha: string): Promise<void> {
    await this.call('/git/refs', { method: 'POST', json: { ref: `refs/heads/${branch}`, sha } });
  }

  /** Creates a file with the Contents API. Only used for the first commit in an empty repository. */
  async createFileWithContentsApi(branch: string, file: FileChange, message: string): Promise<string> {
    const encodedPath = file.path.split('/').map(encodeURIComponent).join('/');
    const result = await this.call<{ commit: { sha: string } }>(`/contents/${encodedPath}`, {
      method: 'PUT',
      json: { message, content: utf8ToBase64(file.content), branch },
    });
    return result.commit.sha;
  }

  /**
   * Adds or replaces `files` on top of `parentSha` in a single commit and moves
   * the branch to it. Pass null as `parentSha` when the branch does not exist yet.
   */
  async commitOnto(parentSha: string | null, options: CommitFilesOptions): Promise<CommitResult> {
    const baseTree = parentSha ? await this.getCommitTree(parentSha) : null;
    const entries: TreeEntry[] = [];
    for (const file of options.files) {
      entries.push({ path: file.path, mode: '100644', type: 'blob', sha: await this.createBlob(file.content) });
    }
    const tree = await this.createTree(baseTree, entries);
    const commitParams: Parameters<GitHubClient['createCommit']>[0] = {
      message: options.message,
      tree,
      parents: parentSha ? [parentSha] : [],
    };
    if (options.author) commitParams.author = options.author;
    if (options.committer) commitParams.committer = options.committer;
    const sha = await this.createCommit(commitParams);

    if (parentSha) await this.updateRef(options.branch, sha);
    else await this.createRef(options.branch, sha);
    return { sha, htmlUrl: this.commitUrl(sha) };
  }
}
