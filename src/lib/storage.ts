// Typed wrapper over chrome.storage. All persistent state goes through here;
// the background worker can be stopped at any time, so nothing is kept in memory.

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
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  token: '',
  owner: '',
  repo: '',
  branch: '',
  pushMode: 'accepted',
  confirmBeforeCommit: true,
  messageTemplate: '',
  notesByDefault: false,
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
