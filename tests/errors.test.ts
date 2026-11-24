// GitHub error handling. Error bodies follow the shape GitHub's REST API returns.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeGitHubError, isNotFastForward, isProtectedBranchError } from '../src/lib/github';
import { HttpError, isTransientError, RateLimitError, request } from '../src/lib/http';

function githubError(status: number, message: string): HttpError {
  return new HttpError(status, `${status}: ${message}`, { message, documentation_url: 'https://docs.github.com/rest' });
}

const repo = 'me/solutions';

describe('branch protection', () => {
  it.each([
    [422, 'Protected branch update failed for refs/heads/main.'],
    [409, 'Repository rule violations found\n\nChanges must be made through a pull request.'],
    [422, 'Required status check "build" is expected.'],
  ])('recognizes %i "%s"', (status, message) => {
    const err = githubError(status, message);
    expect(isProtectedBranchError(err)).toBe(true);
    expect(isNotFastForward(err)).toBe(false);
    expect(describeGitHubError(err, repo, 'main')).toBe(
      '"main" in me/solutions is protected, so LeetLink cannot push to it. Turn off the protection rule or choose another branch in LeetLink settings.',
    );
  });

  it('tells a moved branch apart from a protected one', () => {
    const err = githubError(422, 'Update is not a fast forward');
    expect(isNotFastForward(err)).toBe(true);
    expect(isProtectedBranchError(err)).toBe(false);
  });
});

describe('describeGitHubError', () => {
  it.each([
    [githubError(403, 'Repository was archived so is read-only.'), 'me/solutions is archived and read-only.'],
    [githubError(403, 'Resource not accessible by personal access token'), 'Give it Contents: Read and write permission'],
    [githubError(401, 'Bad credentials'), 'GitHub token is invalid or expired.'],
    [githubError(404, 'Not Found'), 'It may have been renamed or deleted'],
    [githubError(502, 'Server Error'), 'GitHub is having problems right now.'],
    [new HttpError(0, 'Network error. Check your connection.'), 'Network error. Check your connection.'],
  ])('explains %s', (err, expected) => {
    expect(describeGitHubError(err, repo)).toContain(expected);
  });

  it('only retries temporary failures', () => {
    expect(isTransientError(new HttpError(0, 'offline'))).toBe(true);
    expect(isTransientError(githubError(503, 'Service Unavailable'))).toBe(true);
    expect(isTransientError(new RateLimitError(null))).toBe(true);
    expect(isTransientError(githubError(422, 'Protected branch update failed'))).toBe(false);
    expect(isTransientError(githubError(401, 'Bad credentials'))).toBe(false);
  });
});

describe('rate limits', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function respondWith(status: number, body: unknown, headers: Record<string, string>): void {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(body), { status, headers }));
  }

  it('treats an exhausted primary limit as a rate limit with its reset time', async () => {
    respondWith(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1767268800' });
    const err = await request('https://api.github.com/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).resetAt?.getTime()).toBe(1767268800 * 1000);
  });

  it('treats a secondary limit as a rate limit and respects Retry-After', async () => {
    const before = Date.now();
    respondWith(403, { message: 'You have exceeded a secondary rate limit.' }, { 'retry-after': '60' });
    const err = await request('https://api.github.com/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).resetAt?.getTime()).toBeGreaterThanOrEqual(before + 60_000);
  });

  it('recognizes a secondary limit from its message alone', async () => {
    respondWith(403, { message: 'You have exceeded a secondary rate limit.' }, {});
    expect(await request('https://api.github.com/x').catch((e: unknown) => e)).toBeInstanceOf(RateLimitError);
  });

  it('keeps an ordinary 403 as a permission error', async () => {
    respondWith(403, { message: 'Resource not accessible by personal access token' }, {});
    const err = await request('https://api.github.com/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).not.toBeInstanceOf(RateLimitError);
  });
});
