// Runs in the page's main world. Wraps fetch and XMLHttpRequest so LeetCode's
// own submit and check calls can be observed, then hands the final judged
// result to the content script with window.postMessage.
//
// This file must stay self-contained: it only imports types and constants.

import type { HookMessage, SubmissionResult } from '../lib/messages';

interface PendingSubmission {
  titleSlug: string;
  lang: string;
  code: string;
}

const SUBMIT_PATH = /\/problems\/([^/]+)\/submit\/?$/;
const CHECK_PATH = /\/submissions\/detail\/(\d+)\/check\/?$/;

const pending = new Map<string, PendingSubmission>();
const reported = new Set<string>();

function pathOf(url: string): string {
  try {
    return new URL(url, location.href).pathname;
  } catch {
    return '';
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return null;
}

function onSubmit(url: string, requestBody: string | null, responseText: string): void {
  const match = SUBMIT_PATH.exec(pathOf(url));
  if (!match?.[1] || requestBody === null) return;

  const body = asRecord(parseJson(requestBody));
  const response = asRecord(parseJson(responseText));
  const submissionId = str(response?.['submission_id']);
  const lang = str(body?.['lang']);
  const code = str(body?.['typed_code']);
  if (!submissionId || !lang || code === null) return;

  pending.set(submissionId, { titleSlug: match[1], lang, code });
}

function onCheck(url: string, responseText: string): void {
  const match = CHECK_PATH.exec(pathOf(url));
  const submissionId = match?.[1];
  if (!submissionId) return;

  const submission = pending.get(submissionId);
  if (!submission || reported.has(submissionId)) return;

  const data = asRecord(parseJson(responseText));
  if (!data || data['state'] !== 'SUCCESS') return;

  const statusCode = typeof data['status_code'] === 'number' ? data['status_code'] : -1;
  const runtime = str(data['status_runtime']);
  const memory = str(data['status_memory']);
  const payload: SubmissionResult = {
    submissionId,
    titleSlug: submission.titleSlug,
    lang: str(data['lang']) ?? submission.lang,
    code: submission.code,
    statusCode,
    statusMsg: str(data['status_msg']) ?? 'Unknown',
    runtime: runtime && runtime !== 'N/A' ? runtime : null,
    memory: memory && memory !== 'N/A' ? memory : null,
    timestamp: Date.now(),
  };

  reported.add(submissionId);
  pending.delete(submissionId);
  const message: HookMessage = { source: 'leetlink-hook', type: 'submission', payload };
  window.postMessage(message, location.origin);
}

function inspect(url: string, requestBody: string | null, responseText: string): void {
  try {
    onSubmit(url, requestBody, responseText);
    onCheck(url, responseText);
  } catch {
    // Never let the hook break the page.
  }
}

function isInteresting(url: string): boolean {
  const path = pathOf(url);
  return SUBMIT_PATH.test(path) || CHECK_PATH.test(path);
}

// --- fetch -------------------------------------------------------------------

const originalFetch = window.fetch;

window.fetch = async function (this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input);
  if (!isInteresting(url)) return originalFetch.call(this, input, init);

  let requestBody: string | null = null;
  if (typeof init?.body === 'string') {
    requestBody = init.body;
  } else if (input instanceof Request && init?.body === undefined) {
    requestBody = await input.clone().text().catch(() => null);
  }

  const response = await originalFetch.call(this, input, init);
  response
    .clone()
    .text()
    .then((text) => inspect(url, requestBody, text))
    .catch(() => undefined);
  return response;
};

// --- XMLHttpRequest ----------------------------------------------------------

const requestUrls = new WeakMap<XMLHttpRequest, string>();
const originalOpen = XMLHttpRequest.prototype.open;
const originalSend = XMLHttpRequest.prototype.send;

XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]) {
  requestUrls.set(this, String(args[1]));
  return (originalOpen as (...a: unknown[]) => void).apply(this, args);
} as typeof XMLHttpRequest.prototype.open;

XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
  const url = requestUrls.get(this);
  if (url && isInteresting(url)) {
    const requestBody = typeof body === 'string' ? body : null;
    this.addEventListener('load', () => {
      if (this.responseType === '' || this.responseType === 'text') {
        inspect(url, requestBody, this.responseText);
      } else if (this.responseType === 'json') {
        inspect(url, requestBody, JSON.stringify(this.response));
      }
    });
  }
  return originalSend.call(this, body);
};
