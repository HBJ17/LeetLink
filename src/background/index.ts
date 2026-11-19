// Background service worker. Handles requests from content scripts.
// It can be stopped whenever it is idle, so it keeps no state in memory.

import type { BackgroundRequest, PushResponse } from '../lib/messages';
import { pushSubmission } from './push';

function isBackgroundRequest(value: unknown): value is BackgroundRequest {
  return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'push';
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (r: PushResponse) => void) => {
  if (sender.id !== chrome.runtime.id || !isBackgroundRequest(message)) return false;

  pushSubmission(message.payload)
    .then(sendResponse)
    .catch((err: unknown) => sendResponse({ ok: false, error: String(err) }));
  return true; // Keep the channel open for the async response.
});
