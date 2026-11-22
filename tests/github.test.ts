import { describe, expect, it } from 'vitest';
import { parseRepoLink } from '../src/lib/github';

describe('parseRepoLink', () => {
  it.each([
    ['https://github.com/HBJ17/LeetLink', 'HBJ17/LeetLink'],
    ['https://github.com/HBJ17/LeetLink.git', 'HBJ17/LeetLink'],
    ['github.com/HBJ17/LeetLink/tree/main', 'HBJ17/LeetLink'],
    ['git@github.com:HBJ17/LeetLink.git', 'HBJ17/LeetLink'],
    ['HBJ17/LeetLink', 'HBJ17/LeetLink'],
    ['  https://www.github.com/a/b?tab=readme  ', 'a/b'],
  ])('reads %s', (input, expected) => {
    const ref = parseRepoLink(input);
    expect(ref && `${ref.owner}/${ref.repo}`).toBe(expected);
  });

  it.each(['https://gitlab.com/a/b', 'HBJ17', '', 'https://github.com/', 'a b/c'])('rejects %j', (input) => {
    expect(parseRepoLink(input)).toBeNull();
  });
});
