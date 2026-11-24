// Import of past accepted submissions. Collecting happens on a LeetCode tab
// (see content/history.ts); this module starts it, then commits what was
// collected, each submission dated when it was originally submitted.

import { describeGitHubError, EmptyRepositoryError, GitHubClient, isNotFastForward } from '../lib/github';
import { gitBlobSha } from '../lib/hash';
import { isTransientError, retryAfter } from '../lib/http';
import { ACCEPTED_STATUS, type ImportCountResponse, type ProblemInfo, type SimpleResponse } from '../lib/messages';
import { folderName } from '../lib/naming';
import { folderFiles, matchProblemFolder, scanRepository, type FolderFile, type ProblemFolder } from '../lib/repo-scan';
import {
  getImportItems,
  getImportState,
  getSettings,
  IDLE_IMPORT,
  isConnected,
  setImportItems,
  updateImportState,
  type ImportItem,
} from '../lib/storage';
import { askLeetCodeTab } from './leetcode-tab';
import { findCopy, planSolutionFile } from './push';

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** How many problems the signed-in LeetCode user has solved, for the confirmation prompt. */
export async function countSolved(): Promise<ImportCountResponse> {
  try {
    return await askLeetCodeTab<ImportCountResponse>({ type: 'leetcodeSolvedCount' }, true);
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }
}

/** Starts a fresh import. Does nothing when one is already running. */
export async function startImport(): Promise<SimpleResponse> {
  if (!isConnected(await getSettings())) {
    return { ok: false, error: 'Connect a repository in LeetLink settings first.' };
  }
  const state = await getImportState();
  if (state.status === 'collecting' || state.status === 'importing') return { ok: true };

  await setImportItems([]);
  await updateImportState({ ...IDLE_IMPORT, status: 'collecting' });
  askLeetCodeTab<SimpleResponse>({ type: 'leetcodeCollect' }, true)
    .then((reply) => {
      if (!reply.ok) return updateImportState({ status: 'error', error: reply.error });
      return undefined;
    })
    .catch((err: unknown) => updateImportState({ status: 'error', error: errorText(err) }));
  return { ok: true };
}

/** Pauses a running import; collecting or committing stops after the current step. */
export async function pauseImport(): Promise<SimpleResponse> {
  const state = await getImportState();
  if (state.status === 'collecting' || state.status === 'importing') await updateImportState({ status: 'paused' });
  return { ok: true };
}

/** Continues a paused import where it stopped. */
export async function resumeImport(): Promise<SimpleResponse> {
  const state = await getImportState();
  if (state.status !== 'paused') return { ok: true };
  if (!state.collect.done) {
    await updateImportState({ status: 'collecting', error: null });
    try {
      const reply = await askLeetCodeTab<SimpleResponse>({ type: 'leetcodeCollect' }, true);
      if (!reply.ok) await updateImportState({ status: 'error', error: reply.error });
    } catch (err) {
      await updateImportState({ status: 'error', error: errorText(err) });
    }
    return { ok: true };
  }
  await updateImportState({ status: 'importing', error: null });
  void runImport();
  return { ok: true };
}

/** Stops the import for good. Commits already made stay in the repository. */
export async function cancelImport(): Promise<SimpleResponse> {
  const state = await getImportState();
  if (state.status === 'idle' || state.status === 'done') return { ok: true };
  await updateImportState({ status: 'cancelled' });
  await setImportItems([]);
  return { ok: true };
}

// --- Committing collected submissions ------------------------------------------

/** Pause between commits, to stay well inside GitHub's limits on creating content. */
const PACE_MS = 4000;
/** Times one item is rebuilt when the branch moves underneath the import. */
const MAX_REBUILDS = 3;
/** Wait after a temporary failure before trying again. */
const RETRY_WAIT_MS = 2 * 60_000;

/** What the import knows about the repository between commits. */
interface RepoCursor {
  head: string | null;
  tree: string | null;
  folders: ProblemFolder[];
  /** Files per folder path, loaded when first needed and kept up to date. */
  files: Map<string, FolderFile[]>;
}

async function loadRepo(client: GitHubClient, branch: string): Promise<RepoCursor> {
  const cursor: RepoCursor = { head: null, tree: null, folders: [], files: new Map() };
  let head: string | null;
  try {
    head = await client.getRef(branch);
  } catch (err) {
    if (err instanceof EmptyRepositoryError) return cursor;
    throw err;
  }
  if (head === null) throw new Error(`Branch "${branch}" does not exist in ${client.fullName}.`);
  cursor.head = head;
  cursor.tree = await client.getCommitTree(head);
  cursor.folders = (await scanRepository(client, cursor.tree)).folders;
  return cursor;
}

async function filesFor(
  client: GitHubClient,
  repo: RepoCursor,
  problem: ProblemInfo,
): Promise<{ folder: string; files: FolderFile[] }> {
  const match = matchProblemFolder(repo.folders, problem);
  const folder = match?.path ?? folderName(problem);
  let files = repo.files.get(folder);
  if (!files) {
    if (match && repo.tree) {
      files = [...(await folderFiles(client, repo.tree, match))];
    } else if (repo.tree) {
      const entries = await client.listFolder(repo.tree, folder);
      files = entries.filter((e) => e.type === 'blob').map((e) => ({ name: e.path, sha: e.sha }));
    } else {
      files = [];
    }
    repo.files.set(folder, files);
  }
  return { folder, files };
}

/**
 * Commits one past submission, dated when it was submitted. Identical code
 * already in the problem folder is skipped.
 */
async function commitItem(
  client: GitHubClient,
  branch: string,
  repo: RepoCursor,
  item: ImportItem,
  identity: { name: string; email: string },
): Promise<'pushed' | 'skipped'> {
  const { folder, files } = await filesFor(client, repo, item.problem);
  if (await findCopy(folder, files, item.code)) return 'skipped';

  const { fileName, path } = planSolutionFile(folder, files, item.problem, {
    lang: item.lang,
    statusCode: ACCEPTED_STATUS,
    statusMsg: 'Accepted',
  });
  const who = { ...identity, date: new Date(item.timestamp).toISOString() };
  const message = folderName(item.problem);

  if (repo.head && repo.tree) {
    const tree = await client.createTree(repo.tree, [{ path, mode: '100644', type: 'blob', content: item.code }]);
    const sha = await client.createCommit({ message, tree, parents: [repo.head], author: who, committer: who });
    await client.updateRef(branch, sha);
    repo.head = sha;
    repo.tree = tree;
  } else {
    // The first commit in an empty repository has to use the Contents API.
    const sha = await client.createFileWithContentsApi(branch, { path, content: item.code }, message, {
      author: who,
      committer: who,
    });
    repo.head = sha;
    repo.tree = await client.getCommitTree(sha);
  }
  files.push({ name: fileName, sha: await gitBlobSha(item.code) });
  return 'pushed';
}

export interface RunImportOptions {
  paceMs?: number;
  /** Injected in tests. */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
let running = false;

/**
 * Commits collected submissions from where the import left off, oldest first,
 * until all are done or the import is paused or cancelled. Only one run goes
 * at a time.
 */
export async function runImport(options: RunImportOptions = {}): Promise<void> {
  const { paceMs = PACE_MS, sleep = realSleep } = options;
  if (running) return;
  running = true;
  let client: GitHubClient | null = null;
  let branch = '';
  try {
    let state = await getImportState();
    if (state.status !== 'importing' || state.waitUntil > Date.now()) return;
    if (state.error) await updateImportState({ error: null });
    const settings = await getSettings();
    if (!isConnected(settings)) throw new Error('No repository connected.');

    client = new GitHubClient(settings.token, settings.owner, settings.repo);
    branch = settings.branch || (await client.getDefaultBranch());
    const identity = await client.getNoreplyIdentity();
    const items = await getImportItems();
    let repo = await loadRepo(client, branch);
    let { pushed, skipped } = state;
    let rebuilds = 0;

    for (let index = state.next; index < items.length; ) {
      state = await getImportState();
      if (state.status !== 'importing') return; // Paused or cancelled.
      const item = items[index];
      if (!item) break;

      let result: 'pushed' | 'skipped';
      try {
        result = await commitItem(client, branch, repo, item, identity);
      } catch (err) {
        // Something else pushed to the branch. Reload it and try this item again.
        if (isNotFastForward(err) && rebuilds < MAX_REBUILDS) {
          rebuilds++;
          repo = await loadRepo(client, branch);
          continue;
        }
        throw err;
      }
      rebuilds = 0;
      if (result === 'pushed') pushed++;
      else skipped++;
      index++;
      await updateImportState({ next: index, pushed, skipped });
      if (result === 'pushed' && index < items.length) await sleep(paceMs);
    }
    await updateImportState({ status: 'done', error: null });
  } catch (err) {
    const message = client ? describeGitHubError(err, client.fullName, branch) : errorText(err);
    if (isTransientError(err)) {
      // Offline, rate limited or a GitHub outage: wait, then the import alarm picks it up again.
      const waitUntil = Math.max(Date.now() + RETRY_WAIT_MS, retryAfter(err)?.getTime() ?? 0);
      await updateImportState({ waitUntil, error: `${message} Continuing at ${new Date(waitUntil).toLocaleTimeString()}.` });
    } else {
      await updateImportState({ status: 'error', error: `Import stopped: ${message}` });
    }
  } finally {
    running = false;
  }
}

// --- Resuming after interruptions ----------------------------------------------

export const IMPORT_ALARM = 'leetlink-import';
/** Collecting saves progress after every page; this long without progress means it stopped. */
const COLLECT_STALL_MS = 90_000;

/** Keeps a once-a-minute alarm while an import is active, so it survives the worker stopping. */
export async function ensureImportAlarm(): Promise<void> {
  const state = await getImportState();
  if (state.status === 'collecting' || state.status === 'importing') {
    await chrome.alarms.create(IMPORT_ALARM, { periodInMinutes: 1 });
  } else {
    await chrome.alarms.clear(IMPORT_ALARM);
  }
}

/**
 * Continues an import that stopped without being paused: the worker was shut
 * down, the browser restarted, the LeetCode tab was closed or reloaded, or a
 * temporary failure has finished waiting. Called on startup and by the alarm.
 */
export async function resumeIfInterrupted(): Promise<void> {
  const state = await getImportState();
  if (state.status === 'importing') {
    if (state.waitUntil <= Date.now()) await runImport();
  } else if (state.status === 'collecting' && Date.now() - state.updatedAt > COLLECT_STALL_MS) {
    try {
      const reply = await askLeetCodeTab<SimpleResponse>({ type: 'leetcodeCollect' }, false);
      if (!reply.ok) await updateImportState({ error: reply.error });
    } catch (err) {
      // No LeetCode tab: wait for one rather than opening tabs unasked.
      await updateImportState({ error: errorText(err) });
    }
  }
  await ensureImportAlarm();
}
