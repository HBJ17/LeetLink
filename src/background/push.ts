// Pushes one submission (and optional notes) to the connected repository.

import { describeGitHubError, EmptyRepositoryError, GitHubClient, type FileChange } from '../lib/github';
import { HttpError } from '../lib/http';
import { problemUrl } from '../lib/leetcode';
import type { ProblemInfo, PushRequest, PushResponse } from '../lib/messages';
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

function isNotFastForward(err: unknown): boolean {
  return err instanceof HttpError && err.status === 422;
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

async function buildFiles(
  client: GitHubClient,
  rootTree: string | null,
  req: PushRequest,
): Promise<{ files: FileChange[]; solutionPath: string }> {
  const { problem, submission, notes } = req;
  const { folder, files: existing } = await locateProblemFolder(client, rootTree, problem);
  const names = existing.map((f) => f.name);

  const sequence = nextSequence(names, problem.titleSlug, submission.lang);
  const status = statusLabel(submission.statusCode, submission.statusMsg);
  const fileName = solutionFileName(problem.titleSlug, submission.lang, sequence, status);
  const solutionPath = `${folder}/${fileName}`;
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

export async function pushSubmission(req: PushRequest): Promise<PushResponse> {
  const settings = await getSettings();
  if (!isConnected(settings)) {
    return { ok: false, error: 'No repository connected. Add your repository and token in LeetLink settings.' };
  }

  const client = new GitHubClient(settings.token, settings.owner, settings.repo);
  try {
    const branch = settings.branch || (await client.getDefaultBranch());

    for (let attempt = 1; ; attempt++) {
      let head: string | null;
      try {
        head = await client.getRef(branch);
      } catch (err) {
        if (err instanceof EmptyRepositoryError) return await pushToEmptyRepository(client, branch, req);
        throw err;
      }
      if (!head) return { ok: false, error: `Branch "${branch}" does not exist in ${client.owner}/${client.repo}.` };

      try {
        const rootTree = await client.getCommitTree(head);
        const { files, solutionPath } = await buildFiles(client, rootTree, req);
        const result = await client.commitOnto(head, { branch, message: req.message, files });
        return { ok: true, commitUrl: result.htmlUrl, path: solutionPath };
      } catch (err) {
        // Someone else moved the branch while this commit was built. Rebuild on the new head.
        if (isNotFastForward(err) && attempt < MAX_ATTEMPTS) continue;
        throw err;
      }
    }
  } catch (err) {
    return { ok: false, error: describeGitHubError(err, client.fullName) };
  }
}
