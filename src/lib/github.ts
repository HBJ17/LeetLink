// GitHub Git Data API client. The only module that knows GitHub's endpoints.
// A commit is built from blobs and a tree so several files land in one commit
// and author/committer dates can be set.

import { HttpError, RateLimitError, request, type RequestOptions } from './http';

const API = 'https://api.github.com';

/** Turns a GitHub API failure into a message the user can act on. */
export function describeGitHubError(err: unknown, repo: string): string {
  if (err instanceof RateLimitError) return `GitHub ${err.message.toLowerCase()}. Try again later.`;
  if (err instanceof HttpError) {
    switch (err.status) {
      case 0:
        return err.message;
      case 401:
        return 'GitHub token is invalid or expired.';
      case 403:
        return `The token does not have write access to ${repo}.`;
      case 404:
        return `Repository ${repo} was not found, or the token cannot access it.`;
      default:
        return `GitHub error ${err.message}`;
    }
  }
  return err instanceof Error ? err.message : String(err);
}

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

export interface RepositoryInfo {
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
  canPush: boolean;
}

export interface AccessCheck {
  repository: RepositoryInfo;
  /** Branch commits will go to. */
  branch: string;
  /** True when the repository has no commits yet. */
  empty: boolean;
}

/** Thrown when the repository has no commits yet. */
export class EmptyRepositoryError extends Error {
  override name = 'EmptyRepositoryError';
}

export interface RepoRef {
  owner: string;
  repo: string;
}

const NAME = /^[A-Za-z0-9_.-]+$/;

/**
 * Reads `owner/repo` from a repository link. Accepts web links, clone URLs
 * (HTTPS or SSH) and the bare `owner/repo` form. Returns null when invalid.
 */
export function parseRepoLink(link: string): RepoRef | null {
  let path = link.trim();
  const ssh = /^git@github\.com:(.+)$/i.exec(path);
  if (ssh?.[1]) {
    path = ssh[1];
  } else if (/^(https?:\/\/)?(www\.)?github\.com\//i.test(path)) {
    path = path.replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '');
  } else if (path.includes('://')) {
    return null;
  }

  const [owner, rawRepo] = path.split(/[/?#]/);
  const repo = rawRepo?.replace(/\.git$/i, '');
  if (!owner || !repo || !NAME.test(owner) || !NAME.test(repo)) return null;
  return { owner, repo };
}

export function repoWebUrl({ owner, repo }: RepoRef): string {
  return `https://github.com/${owner}/${repo}`;
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

  get fullName(): string {
    return `${this.owner}/${this.repo}`;
  }

  /**
   * Checks that the token can read the repository and write to it, and that
   * `branch` (when given) exists. Throws with a user-facing message otherwise.
   *
   * Write access is proven by creating an empty blob. A blob that no commit
   * points to never shows up in the repository and is cleaned up by GitHub.
   */
  async verifyAccess(branch: string): Promise<AccessCheck> {
    let info: RepositoryInfo;
    try {
      info = await this.getRepository();
    } catch (err) {
      throw new Error(describeGitHubError(err, this.fullName));
    }
    if (!info.canPush) throw new Error(`Your account cannot push to ${info.fullName}.`);

    const target = branch || info.defaultBranch;
    let empty = false;
    try {
      if ((await this.getRef(target)) === null) {
        throw new Error(`Branch "${target}" does not exist in ${info.fullName}.`);
      }
      await this.createBlob('');
    } catch (err) {
      if (err instanceof EmptyRepositoryError || (err instanceof HttpError && err.status === 409)) {
        empty = true;
      } else if (err instanceof HttpError && (err.status === 403 || err.status === 404)) {
        throw new Error(`The token can read ${info.fullName} but cannot write to it. Give it Contents: Read and write.`);
      } else if (err instanceof HttpError) {
        throw new Error(describeGitHubError(err, info.fullName));
      } else {
        throw err;
      }
    }
    return { repository: info, branch: target, empty };
  }

  commitUrl(sha: string): string {
    return `https://github.com/${this.owner}/${this.repo}/commit/${sha}`;
  }

  async getDefaultBranch(): Promise<string> {
    const repo = await this.call<{ default_branch: string }>('');
    return repo.default_branch;
  }

  /** Repository details plus whether the token can push to it. */
  async getRepository(): Promise<RepositoryInfo> {
    const repo = await this.call<{
      full_name: string;
      default_branch: string;
      private: boolean;
      permissions?: { push?: boolean; admin?: boolean };
    }>('');
    return {
      fullName: repo.full_name,
      defaultBranch: repo.default_branch,
      isPrivate: repo.private,
      canPush: Boolean(repo.permissions?.push || repo.permissions?.admin),
    };
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
