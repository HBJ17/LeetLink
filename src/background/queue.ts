// Retry queue for pushes that failed for a temporary reason (offline, rate
// limit, GitHub server error). The queue lives in chrome.storage so it
// survives the worker being stopped and browser restarts; an alarm wakes the
// worker when the next item is due.
//
// Each item keeps the original request. The file name is worked out again on
// every attempt, so a retry never overwrites something pushed in the meantime.

import type { PushRequest, PushResponse } from '../lib/messages';
import { getRetryQueue, setLastPush, setRetryQueue, type QueuedPush } from '../lib/storage';
import { pushSubmission } from './push';

export const RETRY_ALARM = 'leetlink-retry';

/** Wait before each retry, in minutes. The last value repeats. */
const BACKOFF_MINUTES = [1, 5, 15, 60];
const MINUTE = 60_000;

/** Called with the final outcome of a queued push (success or a failure that will not be retried). */
export type QueueListener = (item: QueuedPush, response: PushResponse) => void;

/** Pushes and remembers a success, so the popup can show the last push. */
async function attempt(request: PushRequest): Promise<PushResponse> {
  const response = await pushSubmission(request);
  if (response.ok) {
    await setLastPush({ message: request.message, commitUrl: response.commitUrl, path: response.path, at: Date.now() });
  }
  return response;
}

export function backoffDelay(attempts: number): number {
  const index = Math.min(Math.max(attempts, 1), BACKOFF_MINUTES.length) - 1;
  return (BACKOFF_MINUTES[index] ?? 60) * MINUTE;
}

function nextAttempt(attempts: number, notBefore: number | undefined, now: number): number {
  return Math.max(now + backoffDelay(attempts), notBefore ?? 0);
}

// Queue reads and writes are serialized so overlapping alarm runs and new
// failures cannot overwrite each other's changes.
let pending: Promise<unknown> = Promise.resolve();

function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = pending.then(task, task);
  pending = run.catch(() => undefined);
  return run;
}

async function scheduleAlarm(queue: readonly QueuedPush[]): Promise<void> {
  const next = Math.min(...queue.map((item) => item.nextAttemptAt));
  if (queue.length && Number.isFinite(next)) {
    await chrome.alarms.create(RETRY_ALARM, { when: Math.max(next, Date.now() + 1000) });
  } else {
    await chrome.alarms.clear(RETRY_ALARM);
  }
}

/** Adds a failed push to the queue. Returns the queued item. */
export function enqueue(request: PushRequest, failure: Extract<PushResponse, { ok: false }>): Promise<QueuedPush> {
  return serialized(async () => {
    const now = Date.now();
    const item: QueuedPush = {
      id: `${request.submission.submissionId}-${now}`,
      request,
      attempts: 1,
      nextAttemptAt: nextAttempt(1, failure.notBefore, now),
      lastError: failure.error,
      createdAt: now,
    };
    const queue = [...(await getRetryQueue()), item];
    await setRetryQueue(queue);
    await scheduleAlarm(queue);
    return item;
  });
}

/**
 * Retries every item that is due, oldest first. Items that succeed, or fail in
 * a way retrying will not fix, leave the queue and are reported to `onDone`.
 */
export function processQueue(onDone: QueueListener = () => undefined): Promise<void> {
  return serialized(async () => {
    const remaining: QueuedPush[] = [];
    const queue = [...(await getRetryQueue())].sort((a, b) => a.createdAt - b.createdAt);

    for (const item of queue) {
      if (item.nextAttemptAt > Date.now()) {
        remaining.push(item);
        continue;
      }
      const response = await attempt(item.request);
      if (!response.ok && response.retryable) {
        const attempts = item.attempts + 1;
        remaining.push({
          ...item,
          attempts,
          nextAttemptAt: nextAttempt(attempts, response.notBefore, Date.now()),
          lastError: response.error,
        });
      } else {
        onDone(item, response);
      }
    }

    await setRetryQueue(remaining);
    await scheduleAlarm(remaining);
  });
}

/**
 * Pushes now, queueing the request when the failure is temporary. A queued
 * failure comes back with `retryAt` set.
 */
export async function pushOrQueue(request: PushRequest): Promise<PushResponse> {
  const response = await attempt(request);
  if (response.ok || !response.retryable) return response;
  const item = await enqueue(request, response);
  return { ...response, retryAt: item.nextAttemptAt };
}

/** Makes every queued push due now and retries them, for the popup's "Retry now" button. */
export async function retryNow(onDone: QueueListener = () => undefined): Promise<void> {
  await serialized(async () => {
    const now = Date.now();
    await setRetryQueue((await getRetryQueue()).map((item) => ({ ...item, nextAttemptAt: now })));
  });
  await processQueue(onDone);
}
