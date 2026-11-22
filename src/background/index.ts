// Background service worker. Handles requests from content scripts.
// It can be stopped whenever it is idle, so it keeps no state in memory.

import type { BackgroundRequest, DuplicateCheckResponse, PushResponse } from '../lib/messages';
import { findCommittedCopy, pushSubmission } from './push';

function isBackgroundRequest(value: unknown): value is BackgroundRequest {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return type === 'push' || type === 'checkDuplicate';
}

function handle(request: BackgroundRequest): Promise<PushResponse | DuplicateCheckResponse> {
  switch (request.type) {
    case 'push':
      return pushSubmission(request.payload);
    case 'checkDuplicate':
      return findCommittedCopy(request.payload);
  }
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) void chrome.runtime.openOptionsPage();
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
