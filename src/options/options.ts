// Settings page: connect a repository and token.

import { parseRepoLink, repoWebUrl } from '../lib/github';
import { getSettings, updateSettings, type Settings } from '../lib/storage';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

const form = byId<HTMLFormElement>('settings');
const repoInput = byId<HTMLInputElement>('repo');
const tokenInput = byId<HTMLInputElement>('token');
const branchInput = byId<HTMLInputElement>('branch');
const status = byId<HTMLParagraphElement>('status');
const saveButton = form.querySelector<HTMLButtonElement>('button[type="submit"]');

function setStatus(text: string, kind: 'info' | 'ok' | 'error' = 'info'): void {
  status.className = kind === 'info' ? 'status' : `status ${kind}`;
  status.textContent = text;
}

function render(settings: Settings): void {
  repoInput.value = settings.owner && settings.repo ? repoWebUrl(settings) : '';
  branchInput.value = settings.branch;
  tokenInput.value = '';
  tokenInput.placeholder = settings.token ? 'Saved. Leave blank to keep it.' : 'github_pat_...';
}

async function save(): Promise<void> {
  const ref = parseRepoLink(repoInput.value);
  if (!ref) {
    setStatus('Enter a GitHub repository link, for example https://github.com/you/leetcode.', 'error');
    repoInput.focus();
    return;
  }

  const current = await getSettings();
  const token = tokenInput.value.trim() || current.token;
  if (!token) {
    setStatus('Enter a personal access token.', 'error');
    tokenInput.focus();
    return;
  }

  const saved = await updateSettings({ owner: ref.owner, repo: ref.repo, token, branch: branchInput.value.trim() });
  render(saved);
  setStatus(`Connected to ${ref.owner}/${ref.repo}.`, 'ok');
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (saveButton) saveButton.disabled = true;
  save()
    .catch((err: unknown) => setStatus(err instanceof Error ? err.message : String(err), 'error'))
    .finally(() => {
      if (saveButton) saveButton.disabled = false;
    });
});

getSettings().then(render, (err: unknown) => setStatus(String(err), 'error'));
