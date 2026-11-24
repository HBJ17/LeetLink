// Background service worker. Handles requests from content scripts and
// retries queued pushes. It can be stopped whenever it is idle, so it keeps
// no state in memory.

import type {
  BackgroundRequest,
  ImportCountResponse,
  PushPreviewResponse,
  PushResponse,
  QueuedPushResult,
  SimpleResponse,
} from '../lib/messages';
import type { QueuedPush } from '../lib/storage';
import { cancelImport, countSolved, pauseImport, resumeImport, runImport, startImport } from './backfill';
import { previewPush } from './push';
import { processQueue, pushOrQueue, RETRY_ALARM } from './queue';

const REQUEST_TYPES: ReadonlySet<string> = new Set<BackgroundRequest['type']>([
  'push',
  'previewPush',
  'importCount',
  'importStart',
  'importCollected',
  'importPause',
  'importResume',
  'importCancel',
]);

function isBackgroundRequest(value: unknown): value is BackgroundRequest {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === 'string' && REQUEST_TYPES.has(type);
}

type BackgroundResponse = PushResponse | PushPreviewResponse | ImportCountResponse | SimpleResponse;

function handle(request: BackgroundRequest): Promise<BackgroundResponse> {
  switch (request.type) {
    case 'push':
      return pushOrQueue(request.payload);
    case 'previewPush':
      return previewPush(request.payload);
    case 'importCount':
      return countSolved();
    case 'importStart':
      return startImport();
    case 'importCollected':
      void runImport();
      return Promise.resolve({ ok: true });
    case 'importPause':
      return pauseImport();
    case 'importResume':
      return resumeImport();
    case 'importCancel':
      return cancelImport();
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
  (message: unknown, sender, sendResponse: (r: BackgroundResponse) => void) => {
    if (sender.id !== chrome.runtime.id || !isBackgroundRequest(message)) return false;

    handle(message)
      .then(sendResponse)
      .catch((err: unknown) => sendResponse({ ok: false, error: String(err) }));
    return true; // Keep the channel open for the async response.
  },
);
