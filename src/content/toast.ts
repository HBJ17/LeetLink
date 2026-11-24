// Small status toast in the corner of the LeetCode page: shows a push in
// progress, then the commit link, a queued retry, a skip or an error. Only
// one toast is shown at a time; a new one replaces the old.

import type { CommitOutcome } from './dialog';

const HOST_ID = 'leetlink-toast';
const AUTO_CLOSE_MS = 6000;

const STYLES = `
  :host { all: initial; }
  .toast {
    position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
    display: flex; align-items: flex-start; gap: 10px;
    max-width: min(380px, calc(100vw - 40px));
    padding: 12px 14px; border-radius: 10px;
    background: #161616; border: 1px solid #2c2c2c; border-left: 3px solid #555; color: #f4f4f4;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
    font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .toast.pushed { border-left-color: #80ff9f; }
  .toast.queued { border-left-color: #ffd600; }
  .toast.error { border-left-color: #ff7b7b; }
  .body { flex: 1; min-width: 0; }
  .brand { font-weight: 700; }
  .brand b { color: #ffd600; }
  .title { margin-left: 6px; }
  .pushed .title { color: #80ff9f; }
  .queued .title { color: #ffe680; }
  .error .title { color: #ff7b7b; }
  .detail { margin-top: 2px; color: #b5b5b5; word-break: break-word; }
  a { color: #80ff9f; }
  button {
    padding: 0; border: 0; background: none; color: #9a9a9a;
    font: inherit; font-size: 16px; line-height: 1; cursor: pointer;
  }
  button:hover { color: #f4f4f4; }
`;

export type ToastKind = 'pending' | 'pushed' | 'queued' | 'skipped' | 'error';

export interface ToastContent {
  kind: ToastKind;
  title: string;
  detail?: string;
  link?: { href: string; text: string };
}

function clock(time: number): string {
  return new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Toast content for the result of a push. `label` names what was pushed. */
export function outcomeToast(label: string, outcome: CommitOutcome): ToastContent {
  if (outcome.ok) {
    return { kind: 'pushed', title: 'Pushed', detail: label, link: { href: outcome.commitUrl, text: 'View commit' } };
  }
  if (outcome.duplicatePath) {
    return { kind: 'skipped', title: 'Skipped', detail: `Already committed as ${outcome.duplicatePath}.` };
  }
  if (outcome.retryAt !== undefined) {
    return {
      kind: 'queued',
      title: 'Queued for retry',
      detail: `${outcome.error} LeetLink will try again at ${clock(outcome.retryAt)}.`,
    };
  }
  return { kind: 'error', title: 'Push failed', detail: outcome.error };
}

/** Shows a toast, replacing any toast already shown. Errors stay until dismissed. */
export function showToast(content: ToastContent): void {
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>${STYLES}</style>`;

  const toast = document.createElement('div');
  toast.className = `toast ${content.kind}`;
  toast.setAttribute('role', content.kind === 'error' ? 'alert' : 'status');

  const body = document.createElement('div');
  body.className = 'body';
  const heading = document.createElement('div');
  const brand = document.createElement('span');
  brand.className = 'brand';
  brand.append('Leet');
  const accent = document.createElement('b');
  accent.textContent = 'Link';
  brand.append(accent);
  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = content.title;
  heading.append(brand, title);
  body.append(heading);

  if (content.detail || content.link) {
    const detail = document.createElement('div');
    detail.className = 'detail';
    if (content.detail) detail.append(content.detail);
    if (content.link) {
      const link = document.createElement('a');
      link.href = content.link.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = content.link.text;
      detail.append(content.detail ? ' · ' : '', link);
    }
    body.append(detail);
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '×';
  close.addEventListener('click', () => host.remove());

  toast.append(body, close);
  shadow.append(toast);
  document.documentElement.append(host);

  if (content.kind !== 'error' && content.kind !== 'pending') {
    window.setTimeout(() => host.remove(), AUTO_CLOSE_MS);
  }
}

/** Shows "Pushing..." until `push` settles, then its result. */
export function trackPush(label: string, push: Promise<CommitOutcome>): void {
  showToast({ kind: 'pending', title: 'Pushing...', detail: label });
  void push
    .catch((err: unknown): CommitOutcome => ({ ok: false, error: String(err) }))
    .then((outcome) => showToast(outcomeToast(label, outcome)));
}
