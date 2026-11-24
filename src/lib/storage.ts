// Typed wrapper over chrome.storage. All persistent state goes through here;
// the background worker can be stopped at any time, so nothing is kept in memory.

import type { ProblemInfo, PushRequest } from './messages';

export type PushMode = 'accepted' | 'all';

export interface Settings {
  /** GitHub fine-grained personal access token. Never logged. */
  token: string;
  owner: string;
  repo: string;
  /** Branch to push to. Empty means the repository's default branch. */
  branch: string;
  pushMode: PushMode;
  confirmBeforeCommit: boolean;
  /** Commit message template. Empty means the built-in default. */
  messageTemplate: string;
  /** Whether the commit dialog opens with the notes box shown. */
  notesByDefault: boolean;
  /**
   * What to do when the connected repository already has problem folders:
   * `keep` adds only missing submissions on import, `connect` skips importing.
   * Empty until the user chooses. Existing files are never changed either way.
   */
  existingRepoChoice: ExistingRepoChoice | '';
}

export type ExistingRepoChoice = 'keep' | 'connect';

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  token: '',
  owner: '',
  repo: '',
  branch: '',
  pushMode: 'accepted',
  confirmBeforeCommit: true,
  messageTemplate: '',
  notesByDefault: false,
  existingRepoChoice: '',
};

const SETTINGS_KEY = 'settings';

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const value = stored[SETTINGS_KEY] as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...value };
}

export async function updateSettings(changes: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...changes };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export function isConnected(settings: Settings): boolean {
  return Boolean(settings.token && settings.owner && settings.repo);
}

/** A push that failed for a temporary reason and will be tried again. */
export interface QueuedPush {
  id: string;
  request: PushRequest;
  /** Failed attempts so far. */
  attempts: number;
  /** Unix time in milliseconds of the next attempt. */
  nextAttemptAt: number;
  lastError: string;
  createdAt: number;
}

const QUEUE_KEY = 'retryQueue';

export async function getRetryQueue(): Promise<QueuedPush[]> {
  const stored = await chrome.storage.local.get(QUEUE_KEY);
  const value = stored[QUEUE_KEY] as QueuedPush[] | undefined;
  return Array.isArray(value) ? value : [];
}

export async function setRetryQueue(queue: readonly QueuedPush[]): Promise<void> {
  await chrome.storage.local.set({ [QUEUE_KEY]: queue });
}

/** One past accepted submission, collected from LeetCode and ready to commit. */
export interface ImportItem {
  submissionId: string;
  problem: ProblemInfo;
  lang: string;
  code: string;
  /** When it was submitted, Unix time in ms. */
  timestamp: number;
  runtime: string | null;
  memory: string | null;
}

export type ImportStatus = 'idle' | 'collecting' | 'importing' | 'paused' | 'done' | 'cancelled' | 'error';

/** Progress of importing past submissions. Small, so it is rewritten after every step. */
export interface ImportState {
  status: ImportStatus;
  /** Where collecting from LeetCode's submission list got to. */
  collect: { offset: number; lastKey: string | null; scanned: number; done: boolean };
  /** Items collected so far (stored separately, see getImportItems). */
  total: number;
  /** Index of the next item to commit. */
  next: number;
  pushed: number;
  skipped: number;
  error: string | null;
  /** Unix time in ms before which no work should start (rate limits, retries). */
  waitUntil: number;
  updatedAt: number;
}

export const IDLE_IMPORT: Readonly<ImportState> = {
  status: 'idle',
  collect: { offset: 0, lastKey: null, scanned: 0, done: false },
  total: 0,
  next: 0,
  pushed: 0,
  skipped: 0,
  error: null,
  waitUntil: 0,
  updatedAt: 0,
};

const IMPORT_STATE_KEY = 'importState';
const IMPORT_ITEMS_KEY = 'importItems';

export async function getImportState(): Promise<ImportState> {
  const stored = await chrome.storage.local.get(IMPORT_STATE_KEY);
  const value = stored[IMPORT_STATE_KEY] as Partial<ImportState> | undefined;
  return { ...IDLE_IMPORT, ...value };
}

export async function updateImportState(changes: Partial<ImportState>): Promise<ImportState> {
  const next = { ...(await getImportState()), ...changes, updatedAt: Date.now() };
  await chrome.storage.local.set({ [IMPORT_STATE_KEY]: next });
  return next;
}

export async function getImportItems(): Promise<ImportItem[]> {
  const stored = await chrome.storage.local.get(IMPORT_ITEMS_KEY);
  const value = stored[IMPORT_ITEMS_KEY] as ImportItem[] | undefined;
  return Array.isArray(value) ? value : [];
}

export async function setImportItems(items: readonly ImportItem[]): Promise<void> {
  await chrome.storage.local.set({ [IMPORT_ITEMS_KEY]: items });
}
