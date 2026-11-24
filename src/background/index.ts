// Background service worker. Handles requests from content scripts and
// retries queued pushes. It can be stopped whenever it is idle, so it keeps
// no state in memory.

import type { BackgroundRequest, DuplicateCheckResponse, PushResponse, QueuedPushResult } from '../lib/messages';
import type { QueuedPush } from '../lib/storage';
import { findCommittedCopy } from './push';
import { processQueue, pushOrQueue, RETRY_ALARM } from './queue';

function isBackgroundRequest(value: unknown): value is BackgroundRequest {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return type === 'push' || type === 'checkDuplicate';
}

function handle(request: BackgroundRequest): Promise<PushResponse | DuplicateCheckResponse> {
  switch (request.type) {
    case 'push':
      return pushOrQueue(request.payload);
    case 'checkDuplicate':
      return findCommittedCopy(request.payload);
  }
}

/** Tells open LeetCode tabs how a queued push ended, so they can show it. */
async function announce(item: QueuedPush, response: PushResponse): Promise<void> {
  const message: QueuedPushResult = { type: 'queuedPushResult', label: item.request.message, response };
  const tabs = await chrome.tabs.query({ url: 'https://leetcode.com/*' });
  await Promise.all(
    tabs.map((tab) => (tab.id === undefined ? undefined : chrome.tabs.sendMessage(tab.id, message).catch(() => undefined))),
  );
}

function retryQueued(): void {
  processQueue((item, response) => void announce(item, response).catch(() => undefined)).catch((err: unknown) =>
    console.error('[LeetLink] Retry failed:', err),
  );
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) void chrome.runtime.openOptionsPage();
  retryQueued();
});

chrome.runtime.onStartup.addListener(retryQueued);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM) retryQueued();
});

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse: (r: PushResponse | DuplicateCheckResponse) => void) => {
    if (sender.id !== chrome.runtime.id || !isBackgroundRequest(message)) return false;

    handle(message)
      .then(sendResponse)
      .catch((err: unknown) => sendResponse({ ok: false, error: String(err) }));
    return true; // Keep the channel open for the async response.
  },
);
