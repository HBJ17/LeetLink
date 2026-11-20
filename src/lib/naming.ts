// Folder, file and commit message naming.
//
//   0001_two-sum/
//     two-sum_py_1.py
//     two-sum_py_2.py
//     README.md

import { ACCEPTED_STATUS, type ProblemInfo, type SubmissionResult } from './messages';

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

/** Placeholders a commit message template can use, with what each one becomes. */
export const TEMPLATE_PLACEHOLDERS: Readonly<Record<string, string>> = {
  number: 'Problem number, zero padded (0001)',
  id: 'Problem number as shown on LeetCode (1)',
  slug: 'Problem slug (two-sum)',
  title: 'Problem title (Two Sum)',
  difficulty: 'Easy, Medium or Hard',
  lang: 'Language (python3)',
  runtime: 'Runtime (3ms)',
  memory: 'Memory (17.4MB)',
  status: 'Result (accepted, wrong-answer)',
  result: 'Runtime when accepted, otherwise the result',
};

export const DEFAULT_MESSAGE_TEMPLATE = '{number}_{slug}_{result}';

export interface MessageContext {
  problem: Pick<ProblemInfo, 'frontendId' | 'title' | 'titleSlug' | 'difficulty'>;
  submission: Pick<SubmissionResult, 'lang' | 'runtime' | 'memory' | 'statusCode' | 'statusMsg'>;
}

/** Marks a placeholder that had no value while the template is being cleaned up. */
const EMPTY = '\u0000';
/** One or more empty placeholders plus the separators around and between them. */
const EMPTY_WITH_SEPARATORS = /([ _.:|-]*)\u0000(?:[ _.:|-]*\u0000)*([ _.:|-]*)/g;

/**
 * Fills a commit message template, e.g. `{number}_{slug}_{result}` becomes
 * `0001_two-sum_3ms`. A placeholder with no value is dropped along with the
 * separator next to it, so a missing runtime gives `0001_two-sum`.
 * Unknown placeholders are left as typed.
 */
export function renderCommitMessage(template: string, context: MessageContext): string {
  const { problem, submission } = context;
  const status = statusLabel(submission.statusCode, submission.statusMsg);
  const runtime = compactRuntime(submission.runtime);
  const values: Record<string, string | null> = {
    number: paddedId(problem.frontendId),
    id: problem.frontendId,
    slug: problem.titleSlug,
    title: problem.title,
    difficulty: problem.difficulty,
    lang: submission.lang,
    runtime,
    memory: compactRuntime(submission.memory),
    status: status ?? 'accepted',
    result: status ?? runtime,
  };

  const filled = template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? values[key] || EMPTY : match,
  );
  const cleaned = filled
    .replace(EMPTY_WITH_SEPARATORS, (match: string, before: string, after: string, offset: number) => {
      const atEdge = offset === 0 || offset + match.length === filled.length;
      if (atEdge) return '';
      return before && after ? before : before || after;
    })
    .split(EMPTY)
    .join('')
    .trim();
  return cleaned || renderCommitMessage(DEFAULT_MESSAGE_TEMPLATE, context);
}

/** Commit message from the default template, e.g. `0001_two-sum_3ms` or `0001_two-sum_wrong-answer`. */
export function defaultCommitMessage(context: MessageContext): string {
  return renderCommitMessage(DEFAULT_MESSAGE_TEMPLATE, context);
}
