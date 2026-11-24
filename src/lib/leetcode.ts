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

// --- Submission history (used by the import) ---------------------------------

/** One row of the user's submission list. */
export interface HistorySubmission {
  submissionId: string;
  titleSlug: string;
  title: string;
  lang: string;
  accepted: boolean;
  /** Unix time in ms. */
  timestamp: number;
  runtime: string | null;
  memory: string | null;
}

export interface HistoryPage {
  submissions: HistorySubmission[];
  hasNext: boolean;
  lastKey: string | null;
}

const SUBMISSION_LIST_QUERY = `
  query leetlinkSubmissionList($offset: Int!, $limit: Int!, $lastKey: String) {
    submissionList(offset: $offset, limit: $limit, lastKey: $lastKey) {
      lastKey
      hasNext
      submissions { id title titleSlug statusDisplay lang runtime memory timestamp }
    }
  }
`;

interface SubmissionListData {
  submissionList: {
    lastKey: string | null;
    hasNext: boolean;
    submissions: {
      id: string;
      title: string;
      titleSlug: string;
      statusDisplay: string;
      lang: string;
      runtime: string | null;
      memory: string | null;
      timestamp: string;
    }[];
  } | null;
}

function display(value: string | null | undefined): string | null {
  return value && value !== 'N/A' ? value : null;
}

/** One page of the signed-in user's submissions, newest first. */
export async function fetchSubmissionPage(offset: number, limit: number, lastKey: string | null): Promise<HistoryPage> {
  const data = await graphql<SubmissionListData>(SUBMISSION_LIST_QUERY, { offset, limit, lastKey });
  const list = data.submissionList;
  if (!list) throw new LeetCodeError('LeetCode did not return your submissions. Are you signed in?');
  return {
    hasNext: list.hasNext,
    lastKey: list.lastKey,
    submissions: list.submissions.map((s) => ({
      submissionId: String(s.id),
      titleSlug: s.titleSlug,
      title: s.title,
      lang: s.lang,
      accepted: s.statusDisplay === 'Accepted',
      timestamp: Number(s.timestamp) * 1000,
      runtime: display(s.runtime),
      memory: display(s.memory),
    })),
  };
}

const SUBMISSION_DETAILS_QUERY = `
  query leetlinkSubmissionDetails($submissionId: Int!) {
    submissionDetails(submissionId: $submissionId) { code }
  }
`;

/** The code of one of the user's submissions. */
export async function fetchSubmissionCode(submissionId: string): Promise<string> {
  const data = await graphql<{ submissionDetails: { code: string } | null }>(SUBMISSION_DETAILS_QUERY, {
    submissionId: Number(submissionId),
  });
  if (!data.submissionDetails) throw new LeetCodeError(`Submission ${submissionId} was not found`);
  return data.submissionDetails.code;
}

const USER_STATUS_QUERY = `query leetlinkUserStatus { userStatus { username isSignedIn } }`;

const SOLVED_QUERY = `
  query leetlinkSolved($username: String!) {
    matchedUser(username: $username) {
      submitStatsGlobal { acSubmissionNum { difficulty count } }
    }
  }
`;

interface SolvedData {
  matchedUser: { submitStatsGlobal: { acSubmissionNum: { difficulty: string; count: number }[] } } | null;
}

/** The signed-in username and how many problems they have solved. */
export async function fetchSolvedCount(): Promise<{ username: string; solved: number }> {
  const status = await graphql<{ userStatus: { username: string; isSignedIn: boolean } }>(USER_STATUS_QUERY, {});
  if (!status.userStatus.isSignedIn) throw new LeetCodeError('Sign in to LeetCode first.');
  const { username } = status.userStatus;
  const data = await graphql<SolvedData>(SOLVED_QUERY, { username });
  const all = data.matchedUser?.submitStatsGlobal.acSubmissionNum.find((n) => n.difficulty === 'All');
  return { username, solved: all?.count ?? 0 };
}
