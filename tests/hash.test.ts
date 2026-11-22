import { describe, expect, it } from 'vitest';
import { gitBlobSha } from '../src/lib/hash';

// Expected values come from `git hash-object --stdin`.
describe('gitBlobSha', () => {
  it.each([
    ['empty file', '', 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'],
    ['short text', 'hello\n', 'ce013625030ba8dba906f756967f9e9ca394464a'],
    [
      'a Python solution',
      'class Solution:\n    def twoSum(self, nums, target):\n        return []\n',
      'bdb9aeb8f849e97835170472abb9307c06a8bef6',
    ],
    ['multi-byte characters', '// héllo 你好 🙂\nint main() {}\n', 'cc8fcb6d7186881a9e0ed70e2dcb2017c12105b8'],
    ['CRLF line endings, kept as is', 'a\r\nb\r\n', 'c30dea8a3641ea99b125d04d599d843712292759'],
  ])('matches git for %s', async (_label, content, expected) => {
    expect(await gitBlobSha(content)).toBe(expected);
  });
});
