// Retry queue against fake chrome.storage and chrome.alarms.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PushRequest, PushResponse } from '../src/lib/messages';
import type { QueuedPush } from '../src/lib/storage';

const store: Record<string, unknown> = {};
const alarms = { create: vi.fn(async () => undefined), clear: vi.fn(async () => true) };
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: store[key] }),
      set: async (items: Record<string, unknown>) => Object.assign(store, items),
    },
  },
  alarms,
});

const pushSubmission = vi.fn<(req: PushRequest) => Promise<PushResponse>>();
vi.mock('../src/background/push', () => ({ pushSubmission: (req: PushRequest) => pushSubmission(req) }));

const { backoffDelay, processQueue, pushOrQueue, retryNow } = await import('../src/background/queue');

const MINUTE = 60_000;
const START = new Date('2026-01-01T12:00:00Z').getTime();

function request(id: string): PushRequest {
  return {
    problem: { frontendId: '1', title: 'Two Sum', titleSlug: 'two-sum', difficulty: 'Easy', topicTags: [] },
    submission: {
      submissionId: id,
      titleSlug: 'two-sum',
      lang: 'python3',
      code: 'pass',
      statusCode: 10,
      statusMsg: 'Accepted',
      runtime: null,
      memory: null,
      timestamp: 0,
    },
    message: '0001_two-sum',
    notes: null,
    allowDuplicate: false,
  };
}

const offline: PushResponse = { ok: false, error: 'Network error. Check your connection.', retryable: true };
const pushed: PushResponse = { ok: true, commitUrl: 'https://github.com/me/r/commit/c1', path: '0001_two-sum/a.py' };

function queue(): QueuedPush[] {
  return (store['retryQueue'] as QueuedPush[] | undefined) ?? [];
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  for (const key of Object.keys(store)) delete store[key];
  pushSubmission.mockReset();
  alarms.create.mockClear();
  alarms.clear.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('backoffDelay', () => {
  it('waits 1, 5, 15, then 60 minutes', () => {
    expect([1, 2, 3, 4, 5, 9].map(backoffDelay)).toEqual([1, 5, 15, 60, 60, 60].map((m) => m * MINUTE));
  });
});

describe('pushOrQueue', () => {
  it('returns successful pushes without queueing', async () => {
    pushSubmission.mockResolvedValue(pushed);
    expect(await pushOrQueue(request('1'))).toEqual(pushed);
    expect(queue()).toEqual([]);
  });

  it('does not queue failures that retrying cannot fix', async () => {
    const denied: PushResponse = { ok: false, error: 'GitHub token is invalid or expired.' };
    pushSubmission.mockResolvedValue(denied);
    expect(await pushOrQueue(request('1'))).toEqual(denied);
    expect(queue()).toEqual([]);
  });

  it('queues temporary failures and sets an alarm', async () => {
    pushSubmission.mockResolvedValue(offline);
    const response = await pushOrQueue(request('1'));

    expect(response).toMatchObject({ ok: false, retryAt: START + MINUTE });
    expect(queue()).toHaveLength(1);
    expect(queue()[0]).toMatchObject({ attempts: 1, nextAttemptAt: START + MINUTE, lastError: offline.error });
    expect(alarms.create).toHaveBeenLastCalledWith('leetlink-retry', { when: START + MINUTE });
  });

  it('waits for a rate limit reset when it is later than the backoff', async () => {
    const reset = START + 30 * MINUTE;
    pushSubmission.mockResolvedValue({ ok: false, error: 'Rate limited', retryable: true, notBefore: reset });
    expect(await pushOrQueue(request('1'))).toMatchObject({ retryAt: reset });
  });
});

describe('processQueue', () => {
  it('leaves items that are not due yet', async () => {
    pushSubmission.mockResolvedValue(offline);
    await pushOrQueue(request('1'));
    pushSubmission.mockClear();

    await processQueue();
    expect(pushSubmission).not.toHaveBeenCalled();
    expect(queue()).toHaveLength(1);
  });

  it('backs off again when a retry fails, and reports success once it works', async () => {
    pushSubmission.mockResolvedValue(offline);
    await pushOrQueue(request('1'));

    vi.setSystemTime(START + MINUTE);
    await processQueue();
    expect(queue()[0]).toMatchObject({ attempts: 2, nextAttemptAt: START + MINUTE + 5 * MINUTE });

    const done = vi.fn();
    pushSubmission.mockResolvedValue(pushed);
    vi.setSystemTime(START + 6 * MINUTE);
    await processQueue(done);

    expect(queue()).toEqual([]);
    expect(done).toHaveBeenCalledWith(expect.objectContaining({ attempts: 2 }), pushed);
    expect(alarms.clear).toHaveBeenCalledWith('leetlink-retry');
  });

  it('drops items that fail for good and reports why', async () => {
    pushSubmission.mockResolvedValue(offline);
    await pushOrQueue(request('1'));

    const duplicate: PushResponse = { ok: false, error: 'Already committed as a.py.', duplicatePath: '0001_two-sum/a.py' };
    pushSubmission.mockResolvedValue(duplicate);
    vi.setSystemTime(START + MINUTE);
    const done = vi.fn();
    await processQueue(done);

    expect(queue()).toEqual([]);
    expect(done).toHaveBeenCalledWith(expect.anything(), duplicate);
  });

  it('retries oldest first and keeps every item when called twice at once', async () => {
    pushSubmission.mockResolvedValue(offline);
    await pushOrQueue(request('a'));
    vi.setSystemTime(START + 1000);
    await pushOrQueue(request('b'));

    const order: string[] = [];
    pushSubmission.mockImplementation(async (req) => {
      order.push(req.submission.submissionId);
      return offline;
    });
    vi.setSystemTime(START + 2 * MINUTE);
    await Promise.all([processQueue(), processQueue()]);

    expect(order).toEqual(['a', 'b']);
    expect(queue().map((item) => item.request.submission.submissionId)).toEqual(['a', 'b']);
  });
});

describe('dashboard data', () => {
  it('remembers the last successful push', async () => {
    pushSubmission.mockResolvedValue(pushed);
    await pushOrQueue(request('1'));
    expect(store['lastPush']).toEqual({ message: '0001_two-sum', commitUrl: 'https://github.com/me/r/commit/c1', path: '0001_two-sum/a.py', at: START });
  });

  it('does not record failed pushes', async () => {
    pushSubmission.mockResolvedValue(offline);
    await pushOrQueue(request('1'));
    expect(store['lastPush']).toBeUndefined();
  });

  it('retries every queued push at once on request', async () => {
    pushSubmission.mockResolvedValue(offline);
    await pushOrQueue(request('a'));
    await pushOrQueue(request('b'));
    pushSubmission.mockResolvedValue(pushed);

    const done = vi.fn();
    await retryNow(done);
    expect(queue()).toEqual([]);
    expect(done).toHaveBeenCalledTimes(2);
    expect(store['lastPush']).toMatchObject({ commitUrl: pushed.ok ? pushed.commitUrl : '' });
  });
});
