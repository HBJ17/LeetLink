// Isolated-world content script. Receives judged submissions from the page
// hook and loads problem details.

import { fetchProblem } from '../lib/leetcode';
import { isHookMessage, type SubmissionResult } from '../lib/messages';

async function handleSubmission(submission: SubmissionResult): Promise<void> {
  const problem = await fetchProblem(submission.titleSlug);
  console.info('[LeetLink] Submission judged:', `${problem.frontendId}. ${problem.title}`, submission.statusMsg);
}

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.source !== window || event.origin !== location.origin) return;
  if (!isHookMessage(event.data)) return;
  handleSubmission(event.data.payload).catch((err: unknown) => {
    console.error('[LeetLink] Could not handle submission:', err);
  });
});
