// Loads the page hook against a fake window and drives it with the same
// requests LeetCode makes when a solution is submitted.

import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { HookMessage } from '../src/lib/messages';

const posted: HookMessage[] = [];
const checkResponse = {
  state: 'SUCCESS',
  status_code: 10,
  status_msg: 'Accepted',
  lang: 'python3',
  status_runtime: '3 ms',
  status_memory: '17.4 MB',
};

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeAll(async () => {
  vi.stubGlobal('location', { href: 'https://leetcode.com/problems/two-sum/', origin: 'https://leetcode.com' });
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('postMessage', (message: HookMessage) => posted.push(message));
  vi.stubGlobal('XMLHttpRequest', class {});
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.includes('/submit/')) return new Response(JSON.stringify({ submission_id: 123 }));
    if (url.includes('/interpret_solution/')) return new Response(JSON.stringify({ interpret_id: 'runcode_1' }));
    return new Response(JSON.stringify(url.includes('/123/') ? checkResponse : { state: 'PENDING' }));
  });
  await import('../src/content/hook');
});

describe('submission hook', () => {
  it('reports a judged submission once, with the submitted code', async () => {
    await fetch('/problems/two-sum/interpret_solution/', { method: 'POST', body: '{}' });
    await fetch('/problems/two-sum/submit/', {
      method: 'POST',
      body: JSON.stringify({ lang: 'python3', question_id: '1', typed_code: 'print(1)' }),
    });
    await fetch('/submissions/detail/123/check/');
    await fetch('/submissions/detail/123/check/');
    await flush();

    expect(posted).toHaveLength(1);
    expect(posted[0]?.payload).toMatchObject({
      submissionId: '123',
      titleSlug: 'two-sum',
      lang: 'python3',
      code: 'print(1)',
      statusCode: 10,
      statusMsg: 'Accepted',
      runtime: '3 ms',
      memory: '17.4 MB',
    });
  });

  it('ignores check results for submissions it did not see', async () => {
    const before = posted.length;
    await fetch('/submissions/detail/999/check/');
    await flush();
    expect(posted).toHaveLength(before);
  });
});
