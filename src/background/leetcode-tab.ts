// LeetCode only answers requests made with the user's session, so the import
// asks the content script on a leetcode.com tab to make them. This finds such
// a tab, opening one in the background when none is open.

import type { LeetCodeTabRequest } from '../lib/messages';

const LEETCODE_TABS = 'https://leetcode.com/*';
const START_URL = 'https://leetcode.com/problemset/';
const READY_ATTEMPTS = 30;
const READY_DELAY_MS = 500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** An open leetcode.com tab, or null. */
export async function findLeetCodeTab(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ url: LEETCODE_TABS });
  const tab = tabs.find((t) => t.id !== undefined && !t.discarded);
  return tab?.id ?? null;
}

async function openLeetCodeTab(): Promise<number> {
  const tab = await chrome.tabs.create({ url: START_URL, active: false });
  if (tab.id === undefined) throw new Error('Could not open LeetCode.');
  return tab.id;
}

/**
 * Sends `request` to the content script on a LeetCode tab and returns its
 * reply. With `open`, a tab is opened when none exists; without it, a missing
 * tab is an error. Waits for a newly opened tab's content script to load.
 */
export async function askLeetCodeTab<T>(request: LeetCodeTabRequest, open: boolean): Promise<T> {
  let tabId = await findLeetCodeTab();
  if (tabId === null) {
    if (!open) throw new Error('Open leetcode.com in a tab to continue.');
    tabId = await openLeetCodeTab();
  }

  for (let attempt = 1; ; attempt++) {
    try {
      return (await chrome.tabs.sendMessage(tabId, request)) as T;
    } catch {
      // The content script is not listening yet while the page loads.
      if (attempt >= READY_ATTEMPTS) throw new Error('LeetCode did not respond. Reload the LeetCode tab and try again.');
      await delay(READY_DELAY_MS);
    }
  }
}
