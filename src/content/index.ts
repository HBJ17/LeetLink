// Isolated-world content script. Receives judged submissions from the page
// hook, loads problem details and opens the commit dialog.

import { fetchProblem } from '../lib/leetcode';
import {
  ACCEPTED_STATUS,
  isHookMessage,
  isLeetCodeTabRequest,
  isQueuedPushResult,
  type BackgroundRequest,
  type ProblemInfo,
  type PushPreview,
  type PushPreviewResponse,
  type PushResponse,
  type SubmissionResult,
} from '../lib/messages';
import { DEFAULT_MESSAGE_TEMPLATE, renderCommitMessage } from '../lib/naming';
import { getSettings } from '../lib/storage';
import { openCommitDialog, type CommitDraft, type CommitOutcome } from './dialog';
import { handleLeetCodeTabRequest } from './import-runner';
import { outcomeToast, showToast, trackPush } from './toast';

async function push(problem: ProblemInfo, submission: SubmissionResult, draft: CommitDraft): Promise<CommitOutcome> {
  const request: BackgroundRequest = { type: 'push', payload: { problem, submission, ...draft } };
  const response = (await chrome.runtime.sendMessage(request)) as PushResponse | undefined;
  if (!response) return { ok: false, error: 'LeetLink did not respond. Reload the page and try again.' };
  return response.ok ? { ok: true, commitUrl: response.commitUrl } : response;
}

/** Where the file would be saved and any identical copy, or null when the check fails. */
async function previewPush(problem: ProblemInfo, submission: SubmissionResult): Promise<PushPreview | null> {
  const request: BackgroundRequest = { type: 'previewPush', payload: { problem, submission } };
  const response = (await chrome.runtime.sendMessage(request)) as PushPreviewResponse | undefined;
  return response?.ok ? { targetPath: response.targetPath, duplicatePath: response.duplicatePath } : null;
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
    preview: previewPush(problem, submission).catch(() => null),
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

// Import requests from the background worker.
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !isLeetCodeTabRequest(message)) return false;
  return handleLeetCodeTabRequest(message, sendResponse);
});
