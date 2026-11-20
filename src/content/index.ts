// Isolated-world content script. Receives judged submissions from the page
// hook, loads problem details and opens the commit dialog.

import { fetchProblem } from '../lib/leetcode';
import {
  ACCEPTED_STATUS,
  isHookMessage,
  type BackgroundRequest,
  type ProblemInfo,
  type PushResponse,
  type SubmissionResult,
} from '../lib/messages';
import { DEFAULT_MESSAGE_TEMPLATE, renderCommitMessage } from '../lib/naming';
import { getSettings } from '../lib/storage';
import { openCommitDialog, showPushNotice, type CommitOutcome } from './dialog';

async function push(problem: ProblemInfo, submission: SubmissionResult, message: string, notes: string | null): Promise<CommitOutcome> {
  const request: BackgroundRequest = { type: 'push', payload: { problem, submission, message, notes } };
  const response = (await chrome.runtime.sendMessage(request)) as PushResponse | undefined;
  if (!response) return { ok: false, error: 'LeetLink did not respond. Reload the page and try again.' };
  return response.ok ? { ok: true, commitUrl: response.commitUrl } : response;
}

async function handleSubmission(submission: SubmissionResult): Promise<void> {
  const settings = await getSettings();
  const accepted = submission.statusCode === ACCEPTED_STATUS;
  if (!accepted && settings.pushMode === 'accepted') return;

  const problem = await fetchProblem(submission.titleSlug);
  const message = renderCommitMessage(settings.messageTemplate || DEFAULT_MESSAGE_TEMPLATE, { problem, submission });

  if (!settings.confirmBeforeCommit) {
    showPushNotice(message, push(problem, submission, message, null));
    return;
  }

  const details = [submission.statusMsg, submission.lang, submission.runtime, submission.memory].filter(Boolean);
  await openCommitDialog({
    heading: `${problem.frontendId}. ${problem.title}`,
    subheading: details.join(' · '),
    defaultMessage: message,
    notesByDefault: settings.notesByDefault,
    onCommit: ({ message, notes }) => push(problem, submission, message, notes),
  });
}

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.source !== window || event.origin !== location.origin) return;
  if (!isHookMessage(event.data)) return;
  handleSubmission(event.data.payload).catch((err: unknown) => {
    console.error('[LeetLink] Could not handle submission:', err);
  });
});
