// Isolated-world content script. Receives judged submissions from the page
// hook, loads problem details and opens the commit dialog.

import { fetchProblem } from '../lib/leetcode';
import {
  ACCEPTED_STATUS,
  isHookMessage,
  isQueuedPushResult,
  type BackgroundRequest,
  type DuplicateCheckResponse,
  type ProblemInfo,
  type PushResponse,
  type SubmissionResult,
} from '../lib/messages';
import { DEFAULT_MESSAGE_TEMPLATE, renderCommitMessage } from '../lib/naming';
import { getSettings } from '../lib/storage';
import { openCommitDialog, type CommitDraft, type CommitOutcome } from './dialog';
import { outcomeToast, showToast, trackPush } from './toast';

async function push(problem: ProblemInfo, submission: SubmissionResult, draft: CommitDraft): Promise<CommitOutcome> {
  const request: BackgroundRequest = { type: 'push', payload: { problem, submission, ...draft } };
  const response = (await chrome.runtime.sendMessage(request)) as PushResponse | undefined;
  if (!response) return { ok: false, error: 'LeetLink did not respond. Reload the page and try again.' };
  return response.ok ? { ok: true, commitUrl: response.commitUrl } : response;
}

/** Path of an identical file already in the repository, or null (also when the check fails). */
async function findCommittedCopy(problem: ProblemInfo, code: string): Promise<string | null> {
  const request: BackgroundRequest = { type: 'checkDuplicate', payload: { problem, code } };
  const response = (await chrome.runtime.sendMessage(request)) as DuplicateCheckResponse | undefined;
  return response?.ok ? response.duplicatePath : null;
}

async function handleSubmission(submission: SubmissionResult): Promise<void> {
  const settings = await getSettings();
  const accepted = submission.statusCode === ACCEPTED_STATUS;
  if (!accepted && settings.pushMode === 'accepted') return;

  const problem = await fetchProblem(submission.titleSlug);
  const message = renderCommitMessage(settings.messageTemplate || DEFAULT_MESSAGE_TEMPLATE, { problem, submission });

  if (!settings.confirmBeforeCommit) {
    // Identical code is skipped rather than committed again.
    trackPush(message, push(problem, submission, { message, notes: null, allowDuplicate: false }));
    return;
  }

  const details = [submission.statusMsg, submission.lang, submission.runtime, submission.memory].filter(Boolean);
  await openCommitDialog({
    heading: `${problem.frontendId}. ${problem.title}`,
    subheading: details.join(' · '),
    defaultMessage: message,
    notesByDefault: settings.notesByDefault,
    duplicateCheck: findCommittedCopy(problem, submission.code).catch(() => null),
    onCommit: (draft) => push(problem, submission, draft),
  });
}

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.source !== window || event.origin !== location.origin) return;
  if (!isHookMessage(event.data)) return;
  handleSubmission(event.data.payload).catch((err: unknown) => {
    console.error('[LeetLink] Could not handle submission:', err);
  });
});

// A push queued earlier finished in the background.
chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (sender.id !== chrome.runtime.id || !isQueuedPushResult(message)) return false;
  const { response } = message;
  showToast(outcomeToast(message.label, response.ok ? { ok: true, commitUrl: response.commitUrl } : response));
  return false;
});
