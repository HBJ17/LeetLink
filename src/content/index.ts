// Isolated-world content script. Receives judged submissions from the page hook.

import { isHookMessage, type SubmissionResult } from '../lib/messages';

function handleSubmission(submission: SubmissionResult): void {
  console.info('[LeetLink] Submission judged:', submission.titleSlug, submission.statusMsg);
}

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.source !== window || event.origin !== location.origin) return;
  if (!isHookMessage(event.data)) return;
  handleSubmission(event.data.payload);
});
