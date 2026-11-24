// Toolbar popup: the connected repository, the last push, pushes waiting to
// be retried, and the import of past submissions. Updates live from storage.

import { repoWebUrl } from '../lib/github';
import type { BackgroundRequest } from '../lib/messages';
import {
  getLastPush,
  getRetryQueue,
  getSettings,
  isConnected,
  type LastPush,
  type QueuedPush,
  type Settings,
} from '../lib/storage';
import { mountImportPanel } from '../ui/import-panel';
import { timeAgo } from '../ui/time';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function externalLink(href: string, text: string): HTMLAnchorElement {
  const link = el('a', '', text);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function openSettings(): void {
  void chrome.runtime.openOptionsPage();
  window.close();
}

function clock(time: number): string {
  return new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderRepo(settings: Settings): void {
  const repo = byId<HTMLElement>('repo');
  if (!isConnected(settings)) {
    const connect = el('button', 'primary', 'Connect a repository');
    connect.type = 'button';
    connect.addEventListener('click', openSettings);
    repo.replaceChildren(el('p', 'muted', 'No repository connected yet.'), connect);
    return;
  }

  const name = el('p', 'repo-name');
  name.append(externalLink(repoWebUrl(settings), `${settings.owner}/${settings.repo}`));
  const branch = settings.branch ? `branch ${settings.branch}` : 'default branch';
  const mode = settings.pushMode === 'all' ? 'All submissions' : 'Accepted only';
  const confirm = settings.confirmBeforeCommit ? 'asks before each commit' : 'commits automatically';
  repo.replaceChildren(el('p', 'muted', 'Pushing to'), name, el('p', 'muted small', `${branch} · ${mode} · ${confirm}`));
}

function renderLastPush(last: LastPush | null): void {
  const section = byId<HTMLElement>('last-push-section');
  section.hidden = false;
  const container = byId<HTMLElement>('last-push');
  if (!last) {
    container.replaceChildren(el('p', 'muted', 'Nothing pushed yet. Submit a solution on LeetCode.'));
    return;
  }
  const meta = el('p', 'muted small');
  meta.append(`${timeAgo(last.at)} · `, externalLink(last.commitUrl, 'View commit'));
  container.replaceChildren(el('p', 'mono', last.message), meta);
}

function renderQueue(queue: readonly QueuedPush[]): void {
  const section = byId<HTMLElement>('queue-section');
  section.hidden = queue.length === 0;
  if (!queue.length) return;

  const next = Math.min(...queue.map((item) => item.nextAttemptAt));
  const latest = [...queue].sort((a, b) => b.createdAt - a.createdAt)[0];
  const retry = el('button', 'secondary', 'Retry now');
  retry.type = 'button';
  retry.addEventListener('click', () => {
    retry.disabled = true;
    retry.textContent = 'Retrying...';
    const request: BackgroundRequest = { type: 'retryQueueNow' };
    void chrome.runtime.sendMessage(request).finally(() => {
      retry.disabled = false;
      retry.textContent = 'Retry now';
    });
  });

  byId<HTMLElement>('queue').replaceChildren(
    el('p', '', `${queue.length} ${queue.length === 1 ? 'push' : 'pushes'} waiting. Next try at ${clock(next)}.`),
    el('p', 'muted small', latest ? latest.lastError : ''),
    retry,
  );
}

async function render(): Promise<void> {
  const settings = await getSettings();
  renderRepo(settings);
  if (!isConnected(settings)) return;

  renderLastPush(await getLastPush());
  renderQueue(await getRetryQueue());
  byId<HTMLElement>('import-section').hidden = false;
  mountImportPanel(byId<HTMLElement>('import'), { prompt: 'Import your past accepted submissions?' });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes['lastPush']) void getLastPush().then(renderLastPush);
    if (changes['retryQueue']) void getRetryQueue().then(renderQueue);
  });
}

byId<HTMLButtonElement>('settings').addEventListener('click', openSettings);
void render();
