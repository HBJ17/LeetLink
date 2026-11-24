// Import of past accepted submissions. Collecting happens on a LeetCode tab
// (see content/history.ts); this module starts it and tracks its state.

import type { ImportCountResponse, SimpleResponse } from '../lib/messages';
import {
  getImportState,
  getSettings,
  IDLE_IMPORT,
  isConnected,
  setImportItems,
  updateImportState,
} from '../lib/storage';
import { askLeetCodeTab } from './leetcode-tab';

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** How many problems the signed-in LeetCode user has solved, for the confirmation prompt. */
export async function countSolved(): Promise<ImportCountResponse> {
  try {
    return await askLeetCodeTab<ImportCountResponse>({ type: 'leetcodeSolvedCount' }, true);
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }
}

/** Starts a fresh import. Does nothing when one is already running. */
export async function startImport(): Promise<SimpleResponse> {
  if (!isConnected(await getSettings())) {
    return { ok: false, error: 'Connect a repository in LeetLink settings first.' };
  }
  const state = await getImportState();
  if (state.status === 'collecting' || state.status === 'importing') return { ok: true };

  await setImportItems([]);
  await updateImportState({ ...IDLE_IMPORT, status: 'collecting' });
  askLeetCodeTab<SimpleResponse>({ type: 'leetcodeCollect' }, true)
    .then((reply) => {
      if (!reply.ok) return updateImportState({ status: 'error', error: reply.error });
      return undefined;
    })
    .catch((err: unknown) => updateImportState({ status: 'error', error: errorText(err) }));
  return { ok: true };
}
