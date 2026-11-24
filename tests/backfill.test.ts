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
  tabs: { query, create, sendMessage },
});

const { countSolved, startImport } = await import('../src/background/backfill');

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
