// Handles the import requests the background worker sends to a LeetCode tab:
// the solved-problem count for the confirmation prompt, and collecting past
// accepted submissions.

import { fetchSolvedCount } from '../lib/leetcode';
import type { BackgroundRequest, ImportCountResponse, LeetCodeTabRequest, SimpleResponse } from '../lib/messages';
import { getImportState, updateImportState } from '../lib/storage';
import { collectAcceptedHistory } from './history';

let collecting = false;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function collect(): Promise<void> {
  if (collecting) return;
  collecting = true;
  try {
    const result = await collectAcceptedHistory({
      // Stop when the import is paused or cancelled from the popup or settings page.
      shouldStop: async () => (await getImportState()).status !== 'collecting',
    });
    if (result === 'done') {
      await updateImportState({ status: 'importing' });
      const done: BackgroundRequest = { type: 'importCollected' };
      await chrome.runtime.sendMessage(done);
    }
  } catch (err) {
    await updateImportState({ status: 'error', error: `Could not read your LeetCode submissions: ${errorText(err)}` });
  } finally {
    collecting = false;
  }
}

export function handleLeetCodeTabRequest(
  request: LeetCodeTabRequest,
  sendResponse: (response: ImportCountResponse | SimpleResponse) => void,
): boolean {
  switch (request.type) {
    case 'leetcodeSolvedCount':
      fetchSolvedCount()
        .then(({ username, solved }) => sendResponse({ ok: true, username, solved }))
        .catch((err: unknown) => sendResponse({ ok: false, error: errorText(err) }));
      return true;
    case 'leetcodeCollect':
      // Reply at once; collecting takes minutes and reports through storage.
      void collect();
      sendResponse({ ok: true });
      return false;
  }
}
