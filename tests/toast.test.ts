import { describe, expect, it } from 'vitest';
import { outcomeToast } from '../src/content/toast';

const label = '0001_two-sum_3ms';

describe('outcomeToast', () => {
  it('links to the commit after a push', () => {
    expect(outcomeToast(label, { ok: true, commitUrl: 'https://github.com/me/r/commit/c1' })).toEqual({
      kind: 'pushed',
      title: 'Pushed',
      detail: label,
      link: { href: 'https://github.com/me/r/commit/c1', text: 'View commit' },
    });
  });

  it('reports a skipped duplicate', () => {
    expect(outcomeToast(label, { ok: false, error: 'x', duplicatePath: '0001_two-sum/a.py' })).toEqual({
      kind: 'skipped',
      title: 'Skipped',
      detail: 'Already committed as 0001_two-sum/a.py.',
    });
  });

  it('reports a queued retry with the reason and time', () => {
    const retryAt = new Date(2026, 0, 1, 13, 30).getTime();
    const toast = outcomeToast(label, { ok: false, error: 'Network error. Check your connection.', retryAt });
    expect(toast.kind).toBe('queued');
    expect(toast.title).toBe('Queued for retry');
    expect(toast.detail).toContain('Network error. Check your connection.');
    expect(toast.detail).toMatch(/try again at .*30/);
  });

  it('reports other failures as errors', () => {
    expect(outcomeToast(label, { ok: false, error: 'GitHub token is invalid or expired.' })).toEqual({
      kind: 'error',
      title: 'Push failed',
      detail: 'GitHub token is invalid or expired.',
    });
  });
});
