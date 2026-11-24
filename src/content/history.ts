// Collects the user's past accepted submissions, with their code, for the
// import. Runs on a leetcode.com tab so requests use the existing session.
//
// Requests are spaced out, and the position in the submission list is saved
// after every page, so collecting can stop at any point and continue later.

import { fetchProblem, fetchSubmissionCode, fetchSubmissionPage, type HistorySubmission } from '../lib/leetcode';
import type { ProblemInfo } from '../lib/messages';
import { getImportItems, getImportState, setImportItems, updateImportState, type ImportItem } from '../lib/storage';

const PAGE_SIZE = 20;

export interface CollectOptions {
  /** Pause between LeetCode requests, in ms. */
  delayMs?: number;
  /** Checked between requests; return true to stop (the position is kept). */
  shouldStop?: () => boolean | Promise<boolean>;
  onProgress?: (progress: { scanned: number; collected: number }) => void;
  /** Injected in tests. */
  sleep?: (ms: number) => Promise<void>;
}

export type CollectResult = 'done' | 'stopped';

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Continues collecting from the saved position until the whole list is read
 * (`done`) or `shouldStop` says so (`stopped`). Collected items end up in
 * storage, oldest first once done.
 */
export async function collectAcceptedHistory(options: CollectOptions = {}): Promise<CollectResult> {
  const { delayMs = 1000, shouldStop = () => false, onProgress, sleep = realSleep } = options;
  const items = await getImportItems();
  const seen = new Set(items.map((item) => item.submissionId));
  const problems = new Map<string, ProblemInfo>(items.map((item) => [item.problem.titleSlug, item.problem]));
  let { collect } = await getImportState();

  async function problemFor(submission: HistorySubmission): Promise<ProblemInfo> {
    const known = problems.get(submission.titleSlug);
    if (known) return known;
    await sleep(delayMs);
    const problem = await fetchProblem(submission.titleSlug);
    problems.set(submission.titleSlug, problem);
    return problem;
  }

  while (!collect.done) {
    if (await shouldStop()) return 'stopped';

    const page = await fetchSubmissionPage(collect.offset, PAGE_SIZE, collect.lastKey);
    for (const submission of page.submissions) {
      if (!submission.accepted || seen.has(submission.submissionId)) continue;
      if (await shouldStop()) return 'stopped';

      const problem = await problemFor(submission);
      await sleep(delayMs);
      const code = await fetchSubmissionCode(submission.submissionId);
      const item: ImportItem = {
        submissionId: submission.submissionId,
        problem,
        lang: submission.lang,
        code,
        timestamp: submission.timestamp,
        runtime: submission.runtime,
        memory: submission.memory,
      };
      items.push(item);
      seen.add(item.submissionId);
    }

    collect = {
      offset: collect.offset + page.submissions.length,
      lastKey: page.lastKey,
      scanned: collect.scanned + page.submissions.length,
      done: !page.hasNext || page.submissions.length === 0,
    };
    if (collect.done) items.sort((a, b) => a.timestamp - b.timestamp);
    await setImportItems(items);
    await updateImportState({ collect, total: items.length });
    onProgress?.({ scanned: collect.scanned, collected: items.length });

    if (!collect.done) await sleep(delayMs);
  }
  return 'done';
}
