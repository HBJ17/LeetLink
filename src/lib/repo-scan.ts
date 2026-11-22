// Finds problem folders already in the repository, including ones made by
// other tools, so new files go into the existing folder instead of a second one.
//
// A folder counts as a problem folder when its name starts with a number
// followed by a name: `0001_two-sum`, `1-two-sum`, `0001-two-sum`, `1. Two Sum`.

import type { GitHubClient, TreeEntry } from './github';
import type { ProblemInfo } from './messages';
import { slugify } from './naming';

export interface FolderFile {
  name: string;
  /** Git blob SHA of the file's content. */
  sha: string;
}

export interface ProblemFolder {
  /** Path from the repository root, e.g. `0001_two-sum` or `leetcode/1-two-sum`. */
  path: string;
  number: number;
  slug: string;
  /** Files directly inside the folder, or null when not loaded yet. */
  files: FolderFile[] | null;
}

export interface RepoIndex {
  folders: ProblemFolder[];
  /**
   * False when the repository was too large to read in one request. Only
   * top-level folders are listed then, and their files load on demand.
   */
  complete: boolean;
}

const FOLDER_NAME = /^0*(\d+)[\s._-]+(.*[A-Za-z0-9].*)$/;

/** Reads the problem number and slug from a folder name, or null if it is not a problem folder. */
export function parseFolderName(name: string): { number: number; slug: string } | null {
  const match = FOLDER_NAME.exec(name);
  if (!match?.[1] || !match[2]) return null;
  const slug = slugify(match[2]);
  return slug ? { number: Number(match[1]), slug } : null;
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function parentPath(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/**
 * Builds the folder list from tree entries. With a recursive listing the
 * files of each folder are filled in; with a top-level listing they stay null.
 */
export function indexTree(entries: readonly TreeEntry[], recursive: boolean): ProblemFolder[] {
  const folders = new Map<string, ProblemFolder>();
  for (const entry of entries) {
    if (entry.type !== 'tree') continue;
    const parsed = parseFolderName(baseName(entry.path));
    if (parsed) folders.set(entry.path, { path: entry.path, ...parsed, files: recursive ? [] : null });
  }
  if (recursive) {
    for (const entry of entries) {
      if (entry.type !== 'blob') continue;
      folders.get(parentPath(entry.path))?.files?.push({ name: baseName(entry.path), sha: entry.sha });
    }
  }
  return [...folders.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/** Scans the tree at `rootTree` for problem folders. */
export async function scanRepository(client: GitHubClient, rootTree: string): Promise<RepoIndex> {
  const whole = await client.readTreeWithStatus(rootTree, true);
  if (!whole.truncated) return { folders: indexTree(whole.entries, true), complete: true };

  const top = await client.readTreeWithStatus(rootTree, false);
  return { folders: indexTree(top.entries, false), complete: false };
}

/** Files in a problem folder, loading them if the scan did not include them. */
export async function folderFiles(client: GitHubClient, rootTree: string, folder: ProblemFolder): Promise<FolderFile[]> {
  if (folder.files) return folder.files;
  const entries = await client.listFolder(rootTree, folder.path);
  return entries.filter((e) => e.type === 'blob').map((e) => ({ name: e.path, sha: e.sha }));
}

/**
 * The existing folder for a problem. A folder matching both number and slug
 * wins, then one matching the slug, then one matching the number.
 */
export function matchProblemFolder(
  folders: readonly ProblemFolder[],
  problem: Pick<ProblemInfo, 'frontendId' | 'titleSlug'>,
): ProblemFolder | null {
  const number = /^\d+$/.test(problem.frontendId) ? Number(problem.frontendId) : null;
  const slug = slugify(problem.titleSlug);
  const sameNumber = (f: ProblemFolder) => number !== null && f.number === number;
  const sameSlug = (f: ProblemFolder) => f.slug === slug;

  return (
    folders.find((f) => sameNumber(f) && sameSlug(f)) ??
    folders.find(sameSlug) ??
    folders.find(sameNumber) ??
    null
  );
}
