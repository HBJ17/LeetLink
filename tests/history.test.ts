// Collecting past submissions against a fake LeetCode GraphQL endpoint.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportItem, ImportState } from '../src/lib/storage';

const store: Record<string, unknown> = {};
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: store[key] }),
      set: async (items: Record<string, unknown>) => Object.assign(store, items),
    },
  },
});
vi.stubGlobal('document', { cookie: 'csrftoken=abc' });

interface Row {
  id: string;
  titleSlug: string;
  statusDisplay: string;
  timestamp: string;
}

/** Pages of the fake submission list, newest first. */
let pages: Row[][] = [];
const calls: { operation: string; variables: Record<string, unknown> }[] = [];

vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
  const { query, variables } = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> };
  const operation = /query (\w+)/.exec(query)?.[1] ?? '';
  calls.push({ operation, variables });
  const json = (data: unknown) => new Response(JSON.stringify({ data }));

  if (operation === 'leetlinkSubmissionList') {
    // Each page starts at the total length of the pages before it.
    let index = 0;
    for (let start = 0; index < pages.length && start < Number(variables['offset']); index++) {
      start += pages[index]?.length ?? 0;
    }
    const rows = pages[index] ?? [];
    return json({
      submissionList: {
        lastKey: `key${index + 1}`,
        hasNext: index + 1 < pages.length,
        submissions: rows.map((r) => ({ ...r, title: r.titleSlug, lang: 'python3', runtime: '3 ms', memory: 'N/A' })),
      },
    });
  }
  if (operation === 'leetlinkSubmissionDetails') {
    return json({ submissionDetails: { code: `# code ${String(variables['submissionId'])}` } });
  }
  if (operation === 'leetlinkQuestion') {
    const slug = String(variables['titleSlug']);
    return json({
      question: { questionFrontendId: slug === 'two-sum' ? '1' : '20', title: slug, titleSlug: slug, difficulty: 'Easy', topicTags: [] },
    });
  }
  throw new Error(`unexpected ${operation}`);
});

const { collectAcceptedHistory } = await import('../src/content/history');
const { fetchSubmissionPage } = await import('../src/lib/leetcode');

const noSleep = async () => undefined;

function items(): ImportItem[] {
  return (store['importItems'] as ImportItem[] | undefined) ?? [];
}

function state(): ImportState {
  return store['importState'] as ImportState;
}

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  calls.length = 0;
  pages = [
    [
      { id: '30', titleSlug: 'two-sum', statusDisplay: 'Accepted', timestamp: '1700000300' },
      { id: '29', titleSlug: 'two-sum', statusDisplay: 'Wrong Answer', timestamp: '1700000200' },
    ],
    [
      { id: '20', titleSlug: 'valid-parentheses', statusDisplay: 'Accepted', timestamp: '1700000100' },
      { id: '10', titleSlug: 'two-sum', statusDisplay: 'Accepted', timestamp: '1700000000' },
    ],
  ];
});

describe('fetchSubmissionPage', () => {
  it('maps LeetCode rows and converts timestamps to ms', async () => {
    const page = await fetchSubmissionPage(0, 20, null);
    expect(page.hasNext).toBe(true);
    expect(page.submissions[0]).toEqual({
      submissionId: '30',
      titleSlug: 'two-sum',
      title: 'two-sum',
      lang: 'python3',
      accepted: true,
      timestamp: 1700000300000,
      runtime: '3 ms',
      memory: null,
    });
  });
});

describe('collectAcceptedHistory', () => {
  it('collects every accepted submission with code, oldest first', async () => {
    expect(await collectAcceptedHistory({ sleep: noSleep })).toBe('done');

    expect(items().map((i) => i.submissionId)).toEqual(['10', '20', '30']);
    expect(items()[0]).toMatchObject({ code: '# code 10', problem: { frontendId: '1', titleSlug: 'two-sum' } });
    expect(state()).toMatchObject({ total: 3, collect: { done: true, scanned: 4 } });
  });

  it('skips non-accepted submissions and looks up each problem once', async () => {
    await collectAcceptedHistory({ sleep: noSleep });
    const details = calls.filter((c) => c.operation === 'leetlinkSubmissionDetails').map((c) => c.variables['submissionId']);
    expect(details).not.toContain(29);
    expect(calls.filter((c) => c.operation === 'leetlinkQuestion')).toHaveLength(2);
  });

  it('spaces out requests', async () => {
    const sleep = vi.fn(async () => undefined);
    await collectAcceptedHistory({ sleep, delayMs: 1500 });
    expect(sleep).toHaveBeenCalledWith(1500);
    expect(sleep.mock.calls.length).toBeGreaterThanOrEqual(calls.length - 1);
  });

  it('stops when asked and continues from the saved position', async () => {
    let pagesDone = 0;
    const result = await collectAcceptedHistory({
      sleep: noSleep,
      onProgress: () => pagesDone++,
      shouldStop: () => pagesDone >= 1,
    });
    expect(result).toBe('stopped');
    expect(items().map((i) => i.submissionId)).toEqual(['30']);
    expect(state().collect).toMatchObject({ offset: 2, lastKey: 'key1', done: false });

    calls.length = 0;
    expect(await collectAcceptedHistory({ sleep: noSleep })).toBe('done');
    const firstList = calls.find((c) => c.operation === 'leetlinkSubmissionList');
    expect(firstList?.variables).toMatchObject({ offset: 2, lastKey: 'key1' });
    expect(items().map((i) => i.submissionId)).toEqual(['10', '20', '30']);
  });
});
