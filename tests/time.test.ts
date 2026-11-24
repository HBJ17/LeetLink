import { describe, expect, it } from 'vitest';
import { timeAgo } from '../src/ui/time';

const NOW = new Date('2026-06-01T12:00:00Z').getTime();
const MINUTE = 60_000;

describe('timeAgo', () => {
  it.each([
    [NOW - 20_000, 'just now'],
    [NOW - 5 * MINUTE, '5 min ago'],
    [NOW - 59 * MINUTE, '59 min ago'],
    [NOW - 3 * 60 * MINUTE, '3 h ago'],
  ])('formats %i', (time, expected) => {
    expect(timeAgo(time, NOW)).toBe(expected);
  });

  it('shows a date for anything older than a day', () => {
    const time = NOW - 3 * 24 * 60 * MINUTE;
    expect(timeAgo(time, NOW)).toBe(new Date(time).toLocaleDateString());
  });
});
