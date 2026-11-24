// Import orchestration against fake chrome APIs.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportState } from '../src/lib/storage';

const store: Record<string, unknown> = {};
const sendMessage = vi.fn(async (_tabId: number, _message: unknown): Promise<unknown> => ({ ok: true }));
const query = vi.fn(async (): Promise<{ id: number; discarded: boolean }[]> => [{ id: 7, discarded: false }]);
const create = vi.fn(async () => ({ id: 9 }));

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: store[key] }),
      set: async (items: Record<string, unknown>) => Object.assign(store, items),
    },
  },
  alarms: { create: vi.fn(async () => undefined), clear: vi.fn(async () => true) },
  tabs: { query, create, sendMessage },
});

const { cancelImport, countSolved, pauseImport, resumeImport, startImport } = await import('../src/background/backfill');

function state(): ImportState {
  return store['importState'] as ImportState;
}

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  store['settings'] = { token: 't', owner: 'me', repo: 'solutions' };
  sendMessage.mockClear();
  query.mockClear();
  create.mockClear();
});

describe('countSolved', () => {
  it('asks the open LeetCode tab', async () => {
    sendMessage.mockResolvedValueOnce({ ok: true, username: 'hbj', solved: 42 });
    expect(await countSolved()).toEqual({ ok: true, username: 'hbj', solved: 42 });
    expect(sendMessage).toHaveBeenCalledWith(7, { type: 'leetcodeSolvedCount' });
    expect(create).not.toHaveBeenCalled();
  });

  it('opens LeetCode in the background when no tab is open', async () => {
    query.mockResolvedValueOnce([]);
    sendMessage.mockResolvedValueOnce({ ok: true, username: 'hbj', solved: 1 });
    await countSolved();
    expect(create).toHaveBeenCalledWith({ url: 'https://leetcode.com/problemset/', active: false });
    expect(sendMessage).toHaveBeenCalledWith(9, { type: 'leetcodeSolvedCount' });
  });
});

describe('startImport', () => {
  it('refuses without a connected repository', async () => {
    store['settings'] = {};
    expect(await startImport()).toEqual({ ok: false, error: 'Connect a repository in LeetLink settings first.' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('resets earlier progress and starts collecting on the LeetCode tab', async () => {
    store['importItems'] = [{ submissionId: 'old' }];
    store['importState'] = { status: 'done', next: 5, total: 5 };

    expect(await startImport()).toEqual({ ok: true });
    expect(store['importItems']).toEqual([]);
    expect(state()).toMatchObject({ status: 'collecting', next: 0, total: 0 });
    // The collect request goes out after startImport replies.
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(7, { type: 'leetcodeCollect' }));
  });

  it('does not restart an import that is already running', async () => {
    store['importState'] = { status: 'collecting', total: 3 };
    expect(await startImport()).toEqual({ ok: true });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(state()).toMatchObject({ total: 3 });
  });
});

describe('pause, resume and cancel', () => {
  it('pauses a running import', async () => {
    store['importState'] = { status: 'importing', next: 2, total: 5 };
    await pauseImport();
    expect(state()).toMatchObject({ status: 'paused', next: 2 });
  });

  it('leaves a finished import alone when asked to pause', async () => {
    store['importState'] = { status: 'done' };
    await pauseImport();
    expect(state().status).toBe('done');
  });

  it('resumes collecting on the LeetCode tab when it was paused while reading', async () => {
    store['importState'] = { status: 'paused', collect: { offset: 40, lastKey: 'k', scanned: 40, done: false }, total: 12 };
    expect(await resumeImport()).toEqual({ ok: true });
    expect(state()).toMatchObject({ status: 'collecting', total: 12 });
    expect(sendMessage).toHaveBeenCalledWith(7, { type: 'leetcodeCollect' });
  });

  it('cancels and frees the stored submissions', async () => {
    store['importState'] = { status: 'paused', pushed: 3 };
    store['importItems'] = [{ submissionId: '1' }];
    await cancelImport();
    expect(state()).toMatchObject({ status: 'cancelled', pushed: 3 });
    expect(store['importItems']).toEqual([]);
  });
});

describe('resumeIfInterrupted while collecting', () => {
  it('asks the open LeetCode tab to continue when collecting has stalled', async () => {
    const { resumeIfInterrupted } = await import('../src/background/backfill');
    store['importState'] = { status: 'collecting', updatedAt: Date.now() - 5 * 60_000, collect: { done: false } };
    await resumeIfInterrupted();
    expect(sendMessage).toHaveBeenCalledWith(7, { type: 'leetcodeCollect' });
  });

  it('leaves collecting alone while it is still making progress', async () => {
    const { resumeIfInterrupted } = await import('../src/background/backfill');
    store['importState'] = { status: 'collecting', updatedAt: Date.now() - 10_000, collect: { done: false } };
    await resumeIfInterrupted();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('waits for a LeetCode tab instead of opening one unasked', async () => {
    const { resumeIfInterrupted } = await import('../src/background/backfill');
    query.mockResolvedValueOnce([]);
    store['importState'] = { status: 'collecting', updatedAt: Date.now() - 5 * 60_000, collect: { done: false } };
    await resumeIfInterrupted();
    expect(create).not.toHaveBeenCalled();
    expect(state()).toMatchObject({ status: 'collecting', error: 'Open leetcode.com in a tab to continue.' });
  });
});
