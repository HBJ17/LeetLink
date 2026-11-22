import { describe, expect, it } from 'vitest';
import {
  defaultCommitMessage,
  folderName,
  nextSequence,
  renderCommitMessage,
  solutionFileName,
  statusLabel,
  type MessageContext,
} from '../src/lib/naming';

const problem = { frontendId: '1', title: 'Two Sum', titleSlug: 'two-sum', difficulty: 'Easy' };
const accepted = { lang: 'python3', runtime: '3 ms', memory: '17.4 MB', statusCode: 10, statusMsg: 'Accepted' };
const wrongAnswer = { ...accepted, runtime: null, memory: null, statusCode: 11, statusMsg: 'Wrong Answer' };
const noRuntime = { ...accepted, runtime: null };

function context(submission: MessageContext['submission']): MessageContext {
  return { problem, submission };
}

describe('folder and file names', () => {
  it('pads numeric problem ids', () => {
    expect(folderName(problem)).toBe('0001_two-sum');
    expect(folderName({ frontendId: '1234', titleSlug: 'x' })).toBe('1234_x');
  });

  it('slugifies non-numeric ids', () => {
    expect(folderName({ frontendId: 'LCP 01', titleSlug: 'x' })).toBe('lcp-01_x');
  });

  it('builds solution file names with a sequence and optional status', () => {
    expect(solutionFileName('two-sum', 'python3', 1)).toBe('two-sum_py_1.py');
    expect(solutionFileName('two-sum', 'cpp', 2, 'wrong-answer')).toBe('two-sum_cpp_wrong-answer_2.cpp');
  });

  it('falls back to .txt for unknown languages', () => {
    expect(solutionFileName('two-sum', 'brainfork', 1)).toBe('two-sum_brainfork_1.txt');
  });

  it('labels only non-accepted statuses', () => {
    expect(statusLabel(10, 'Accepted')).toBeNull();
    expect(statusLabel(11, 'Wrong Answer')).toBe('wrong-answer');
    expect(statusLabel(14, 'Time Limit Exceeded')).toBe('time-limit-exceeded');
  });
});

describe('nextSequence', () => {
  it('starts at 1 in an empty folder', () => {
    expect(nextSequence([], 'two-sum', 'java')).toBe(1);
  });

  it('continues after the highest number for the language, across statuses', () => {
    const existing = ['two-sum_py_1.py', 'two-sum_py_wrong-answer_3.py', 'two-sum_cpp_7.cpp', 'README.md'];
    expect(nextSequence(existing, 'two-sum', 'python3')).toBe(4);
    expect(nextSequence(existing, 'two-sum', 'cpp')).toBe(8);
  });

  it('treats python and python3 as the same language', () => {
    expect(nextSequence(['two-sum_py_2.py'], 'two-sum', 'python')).toBe(3);
  });
});

describe('commit messages', () => {
  it('uses runtime for accepted submissions by default', () => {
    expect(defaultCommitMessage(context(accepted))).toBe('0001_two-sum_3ms');
  });

  it('uses the status for other submissions by default', () => {
    expect(defaultCommitMessage(context(wrongAnswer))).toBe('0001_two-sum_wrong-answer');
  });

  it('drops a missing runtime with its separator', () => {
    expect(defaultCommitMessage(context(noRuntime))).toBe('0001_two-sum');
  });

  it('fills custom templates', () => {
    expect(renderCommitMessage('Solve {id}. {title} ({difficulty}, {lang})', context(accepted))).toBe(
      'Solve 1. Two Sum (Easy, python3)',
    );
    expect(renderCommitMessage('{slug} {status}', context(accepted))).toBe('two-sum accepted');
  });

  it('cleans up empty placeholders at the edges and in the middle', () => {
    expect(renderCommitMessage('{runtime} - {slug}', context(noRuntime))).toBe('two-sum');
    expect(renderCommitMessage('{slug} {runtime} {memory} done', context(wrongAnswer))).toBe('two-sum done');
  });

  it('keeps unknown placeholders as typed', () => {
    expect(renderCommitMessage('{slug}_{unknown}', context(accepted))).toBe('two-sum_{unknown}');
  });

  it('falls back to the default when the template renders empty', () => {
    expect(renderCommitMessage('{runtime}', context(noRuntime))).toBe('0001_two-sum');
  });
});
