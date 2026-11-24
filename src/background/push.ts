// Pushes one submission (and optional notes) to the connected repository.

import {
  describeGitHubError,
  EmptyRepositoryError,
  GitHubClient,
  isNotFastForward,
  type FileChange,
} from '../lib/github';
import { isTransientError, retryAfter } from '../lib/http';
import { problemUrl } from '../lib/leetcode';
import { gitBlobSha } from '../lib/hash';
import type {
  ProblemInfo,
  PushPreviewRequest,
  PushPreviewResponse,
  PushRequest,
  PushResponse,
  SubmissionResult,
} from '../lib/messages';
import { folderName, nextSequence, solutionFileName, statusLabel } from '../lib/naming';
import { folderFiles, matchProblemFolder, scanRepository, type FolderFile } from '../lib/repo-scan';
import { getSettings, isConnected } from '../lib/storage';

const README = 'README.md';
/** Attempts when the branch moves while a commit is being built. */
const MAX_ATTEMPTS = 3;

function readmeContent(existing: string | null, problem: ProblemInfo, fileName: string, notes: string): string {
  const section = `### ${fileName}\n\n${notes}\n`;
  if (existing !== null) return `${existing.trimEnd()}\n\n${section}`;

  const meta = [`[LeetCode](${problemUrl(problem.titleSlug)})`, problem.difficulty];
  if (problem.topicTags.length) meta.push(problem.topicTags.join(', '));
  return `# ${problem.frontendId}. ${problem.title}\n\n${meta.join(' · ')}\n\n${section}`;
}

/** The submitted code is already committed at `path`. */
class DuplicateError extends Error {
  override name = 'DuplicateError';
  constructor(readonly path: string) {
    super(`Already committed as ${path}`);
  }
}

/**
 * Where a problem's files go: an existing folder for the problem (also one
 * named by another tool, like `1-two-sum`) or the default `0001_two-sum`.
 */
async function locateProblemFolder(
  client: GitHubClient,
  rootTree: string | null,
  problem: ProblemInfo,
): Promise<{ folder: string; files: FolderFile[] }> {
  const fallback = folderName(problem);
  if (!rootTree) return { folder: fallback, files: [] };

  const index = await scanRepository(client, rootTree);
  const match = matchProblemFolder(index.folders, problem);
  if (match) return { folder: match.path, files: await folderFiles(client, rootTree, match) };

  // Folder names that do not start with a number (contest problems) are not
  // in the index, so read the default folder directly before writing to it.
  const entries = await client.listFolder(rootTree, fallback);
  const files = entries.filter((e) => e.type === 'blob').map((e) => ({ name: e.path, sha: e.sha }));
  return { folder: fallback, files };
}

/**
 * The next file name for this submission in `folder`: numbered per language
 * after the files already there, so nothing is overwritten.
 */
function planSolutionFile(
  folder: string,
  existing: readonly FolderFile[],
  problem: ProblemInfo,
  submission: SubmissionResult,
): { fileName: string; path: string } {
  const names = existing.map((f) => f.name);
  const sequence = nextSequence(names, problem.titleSlug, submission.lang);
  const status = statusLabel(submission.statusCode, submission.statusMsg);
  const fileName = solutionFileName(problem.titleSlug, submission.lang, sequence, status);
  return { fileName, path: `${folder}/${fileName}` };
}

/** Path of a file in `folder` with exactly this code, or null. */
async function findCopy(folder: string, existing: readonly FolderFile[], code: string): Promise<string | null> {
  const sha = await gitBlobSha(code);
  const same = existing.find((f) => f.sha === sha);
  return same ? `${folder}/${same.name}` : null;
}

async function buildFiles(
  client: GitHubClient,
  rootTree: string | null,
  req: PushRequest,
): Promise<{ files: FileChange[]; solutionPath: string }> {
  const { problem, submission, notes } = req;
  const { folder, files: existing } = await locateProblemFolder(client, rootTree, problem);

  if (!req.allowDuplicate) {
    const copy = await findCopy(folder, existing, submission.code);
    if (copy) throw new DuplicateError(copy);
  }

  const { fileName, path: solutionPath } = planSolutionFile(folder, existing, problem, submission);
  const files: FileChange[] = [{ path: solutionPath, content: submission.code }];

  if (notes) {
    const readmeFile = existing.find((f) => f.name === README);
    const readme = readmeFile ? await client.readBlob(readmeFile.sha) : null;
    files.push({ path: `${folder}/${README}`, content: readmeContent(readme, problem, fileName, notes) });
  }
  return { files, solutionPath };
}

async function pushToEmptyRepository(client: GitHubClient, branch: string, req: PushRequest): Promise<PushResponse> {
  // The Git Data API cannot write to a repository with no commits, so the
  // first file goes through the Contents API, which also creates the branch.
  const { files, solutionPath } = await buildFiles(client, null, req);
  const [first, ...rest] = files;
  if (!first) throw new Error('Nothing to commit');
  let sha = await client.createFileWithContentsApi(branch, first, req.message);
  if (rest.length) {
    sha = (await client.commitOnto(sha, { branch, message: req.message, files: rest })).sha;
  }
  return { ok: true, commitUrl: client.commitUrl(sha), path: solutionPath };
}

class NotConnectedError extends Error {
  override name = 'NotConnectedError';
  constructor() {
    super('No repository connected. Add your repository and token in LeetLink settings.');
  }
}

async function connect(): Promise<{ client: GitHubClient; branch: string }> {
  const settings = await getSettings();
  if (!isConnected(settings)) throw new NotConnectedError();
  const client = new GitHubClient(settings.token, settings.owner, settings.repo);
  const branch = settings.branch || (await client.getDefaultBranch());
  return { client, branch };
}

function failureMessage(err: unknown, client: GitHubClient | null, branch = ''): string {
  if (err instanceof NotConnectedError || !client) return err instanceof Error ? err.message : String(err);
  return describeGitHubError(err, client.fullName, branch);
}

/**
 * What pushing this submission would do right now: the file it would be saved
 * as, and any file that already has identical code. Nothing is written.
 */
export async function previewPush(req: PushPreviewRequest): Promise<PushPreviewResponse> {
  let client: GitHubClient | null = null;
  try {
    const repo = await connect();
    client = repo.client;
    let rootTree: string | null = null;
    try {
      const head = await client.getRef(repo.branch);
      if (head) rootTree = await client.getCommitTree(head);
    } catch (err) {
      if (!(err instanceof EmptyRepositoryError)) throw err;
    }

    const { folder, files } = await locateProblemFolder(client, rootTree, req.problem);
    const { path } = planSolutionFile(folder, files, req.problem, req.submission);
    return { ok: true, targetPath: path, duplicatePath: await findCopy(folder, files, req.submission.code) };
  } catch (err) {
    return { ok: false, error: failureMessage(err, client) };
  }
}

export async function pushSubmission(req: PushRequest): Promise<PushResponse> {
  let client: GitHubClient | null = null;
  let branch = '';
  try {
    const repo = await connect();
    client = repo.client;
    branch = repo.branch;

    for (let attempt = 1; ; attempt++) {
      let head: string | null;
      try {
        head = await client.getRef(branch);
      } catch (err) {
        if (err instanceof EmptyRepositoryError) return await pushToEmptyRepository(client, branch, req);
        throw err;
      }
      if (!head) return { ok: false, error: `Branch "${branch}" does not exist in ${client.fullName}.` };

      try {
        const rootTree = await client.getCommitTree(head);
        const { files, solutionPath } = await buildFiles(client, rootTree, req);
        const result = await client.commitOnto(head, { branch, message: req.message, files });
        return { ok: true, commitUrl: result.htmlUrl, path: solutionPath };
      } catch (err) {
        // Someone else moved the branch while this commit was built. Rebuild on the new head.
        // A protected branch fails with the same status code but is never retried.
        if (isNotFastForward(err) && attempt < MAX_ATTEMPTS) continue;
        throw err;
      }
    }
  } catch (err) {
    if (err instanceof DuplicateError) {
      return { ok: false, error: `Already committed as ${err.path}.`, duplicatePath: err.path };
    }
    const failure: PushResponse = { ok: false, error: failureMessage(err, client, branch) };
    if (isTransientError(err)) failure.retryable = true;
    const after = retryAfter(err);
    if (after) failure.notBefore = after.getTime();
    return failure;
  }
}
