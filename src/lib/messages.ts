// Message shapes shared between the page hook, the content script and the
// background worker.

/** Final result of a judged submission, as captured from LeetCode's requests. */
export interface SubmissionResult {
  submissionId: string;
  titleSlug: string;
  /** LeetCode language slug, e.g. `python3`, `cpp`. */
  lang: string;
  code: string;
  /** 10 means Accepted. */
  statusCode: number;
  /** Human readable status, e.g. `Accepted`, `Wrong Answer`. */
  statusMsg: string;
  /** e.g. `3 ms`, or null when LeetCode does not report one. */
  runtime: string | null;
  /** e.g. `17.4 MB`, or null when LeetCode does not report one. */
  memory: string | null;
  /** Unix time in milliseconds. */
  timestamp: number;
}

export const ACCEPTED_STATUS = 10;

/** Posted from the main-world hook to the isolated content script. */
export interface HookMessage {
  source: 'leetlink-hook';
  type: 'submission';
  payload: SubmissionResult;
}

export function isHookMessage(value: unknown): value is HookMessage {
  if (typeof value !== 'object' || value === null) return false;
  const msg = value as Partial<HookMessage>;
  return msg.source === 'leetlink-hook' && msg.type === 'submission' && typeof msg.payload === 'object';
}
