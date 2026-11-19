// Folder, file and commit message naming.
//
//   0001_two-sum/
//     two-sum_py_1.py
//     two-sum_py_2.py
//     README.md

import { ACCEPTED_STATUS, type ProblemInfo } from './messages';

interface LanguageInfo {
  /** Short tag used inside the file name. */
  tag: string;
  ext: string;
}

/** LeetCode language slug to file naming info. */
export const LANGUAGES: Readonly<Record<string, LanguageInfo>> = {
  bash: { tag: 'sh', ext: 'sh' },
  c: { tag: 'c', ext: 'c' },
  cpp: { tag: 'cpp', ext: 'cpp' },
  csharp: { tag: 'cs', ext: 'cs' },
  dart: { tag: 'dart', ext: 'dart' },
  elixir: { tag: 'ex', ext: 'ex' },
  erlang: { tag: 'erl', ext: 'erl' },
  golang: { tag: 'go', ext: 'go' },
  java: { tag: 'java', ext: 'java' },
  javascript: { tag: 'js', ext: 'js' },
  kotlin: { tag: 'kt', ext: 'kt' },
  mssql: { tag: 'sql', ext: 'sql' },
  mysql: { tag: 'sql', ext: 'sql' },
  oraclesql: { tag: 'sql', ext: 'sql' },
  php: { tag: 'php', ext: 'php' },
  postgresql: { tag: 'sql', ext: 'sql' },
  python: { tag: 'py', ext: 'py' },
  python3: { tag: 'py', ext: 'py' },
  pythondata: { tag: 'py', ext: 'py' },
  racket: { tag: 'rkt', ext: 'rkt' },
  ruby: { tag: 'rb', ext: 'rb' },
  rust: { tag: 'rs', ext: 'rs' },
  scala: { tag: 'scala', ext: 'scala' },
  swift: { tag: 'swift', ext: 'swift' },
  typescript: { tag: 'ts', ext: 'ts' },
};

export function languageInfo(lang: string): LanguageInfo {
  const known = LANGUAGES[lang];
  if (known) return known;
  const fallback = slugify(lang) || 'txt';
  return { tag: fallback, ext: 'txt' };
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `1` becomes `0001`. Non-numeric ids (contest or interview problems) are slugified. */
export function paddedId(frontendId: string): string {
  return /^\d+$/.test(frontendId) ? frontendId.padStart(4, '0') : slugify(frontendId);
}

export function folderName(problem: Pick<ProblemInfo, 'frontendId' | 'titleSlug'>): string {
  return `${paddedId(problem.frontendId)}_${problem.titleSlug}`;
}

/** Status label for non-accepted submissions, e.g. `wrong-answer`. Null when accepted. */
export function statusLabel(statusCode: number, statusMsg: string): string | null {
  return statusCode === ACCEPTED_STATUS ? null : slugify(statusMsg) || 'unknown';
}

export function solutionFileName(
  titleSlug: string,
  lang: string,
  sequence: number,
  status: string | null = null,
): string {
  const { tag, ext } = languageInfo(lang);
  const statusPart = status ? `_${status}` : '';
  return `${titleSlug}_${tag}${statusPart}_${sequence}.${ext}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Next free sequence number for a language, given the file names already in
 * the problem folder. Numbering is shared across statuses so it never repeats.
 */
export function nextSequence(existing: readonly string[], titleSlug: string, lang: string): number {
  const { tag, ext } = languageInfo(lang);
  const pattern = new RegExp(
    `^${escapeRegExp(titleSlug)}_${escapeRegExp(tag)}(?:_[a-z0-9-]+)?_(\\d+)\\.${escapeRegExp(ext)}$`,
  );
  let max = 0;
  for (const name of existing) {
    const n = Number(pattern.exec(name)?.[1] ?? 0);
    if (n > max) max = n;
  }
  return max + 1;
}

/** `3 ms` becomes `3ms`. */
export function compactRuntime(runtime: string | null): string | null {
  if (!runtime) return null;
  const compact = runtime.replace(/\s+/g, '');
  return compact || null;
}

/** Default live commit message, e.g. `0001_two-sum_3ms` or `0001_two-sum_wrong-answer`. */
export function defaultCommitMessage(
  problem: Pick<ProblemInfo, 'frontendId' | 'titleSlug'>,
  runtime: string | null,
  status: string | null = null,
): string {
  const base = folderName(problem);
  if (status) return `${base}_${status}`;
  const rt = compactRuntime(runtime);
  return rt ? `${base}_${rt}` : base;
}
