// The only module that knows LeetCode's endpoints. LeetCode's GraphQL API is
// undocumented, so every query lives here and nowhere else.
//
// Calls are made from the content script so they run on leetcode.com with the
// user's existing session.

import type { ProblemInfo } from './messages';

const GRAPHQL_URL = 'https://leetcode.com/graphql/';

export class LeetCodeError extends Error {
  override name = 'LeetCodeError';
}

function csrfToken(): string | null {
  const match = /(?:^|;\s*)csrftoken=([^;]+)/.exec(document.cookie);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = csrfToken();
  if (token) headers['x-csrftoken'] = token;

  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    throw new LeetCodeError(`LeetCode request failed (${response.status})`);
  }

  const json = (await response.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) {
    throw new LeetCodeError(json.errors.map((e) => e.message).join('; '));
  }
  if (!json.data) throw new LeetCodeError('LeetCode returned no data');
  return json.data;
}

const QUESTION_QUERY = `
  query leetlinkQuestion($titleSlug: String!) {
    question(titleSlug: $titleSlug) {
      questionFrontendId
      title
      titleSlug
      difficulty
      topicTags { name }
    }
  }
`;

interface QuestionData {
  question: {
    questionFrontendId: string;
    title: string;
    titleSlug: string;
    difficulty: string;
    topicTags: { name: string }[];
  } | null;
}

export async function fetchProblem(titleSlug: string): Promise<ProblemInfo> {
  const data = await graphql<QuestionData>(QUESTION_QUERY, { titleSlug });
  const q = data.question;
  if (!q) throw new LeetCodeError(`Problem "${titleSlug}" not found`);
  return {
    frontendId: q.questionFrontendId,
    title: q.title,
    titleSlug: q.titleSlug,
    difficulty: q.difficulty,
    topicTags: q.topicTags.map((t) => t.name),
  };
}

export function problemUrl(titleSlug: string): string {
  return `https://leetcode.com/problems/${titleSlug}/`;
}
