// Toolbar popup: the connected repository and the import entry point.

import { repoWebUrl } from '../lib/github';
import { getSettings, isConnected } from '../lib/storage';
import { mountImportPanel } from '../ui/import-panel';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

function openSettings(): void {
  void chrome.runtime.openOptionsPage();
  window.close();
}

async function render(): Promise<void> {
  const settings = await getSettings();
  const repo = byId<HTMLElement>('repo');

  if (!isConnected(settings)) {
    const text = document.createElement('p');
    text.className = 'muted';
    text.textContent = 'No repository connected yet.';
    const connect = document.createElement('button');
    connect.type = 'button';
    connect.className = 'primary';
    connect.textContent = 'Connect a repository';
    connect.addEventListener('click', openSettings);
    repo.replaceChildren(text, connect);
    return;
  }

  const label = document.createElement('p');
  label.className = 'muted';
  label.textContent = 'Pushing to';
  const name = document.createElement('p');
  name.className = 'repo-name';
  const link = document.createElement('a');
  link.href = repoWebUrl(settings);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = `${settings.owner}/${settings.repo}`;
  name.append(link);
  repo.replaceChildren(label, name);

  byId<HTMLElement>('import-section').hidden = false;
  mountImportPanel(byId<HTMLElement>('import'), { prompt: 'Import your past accepted submissions?' });
}

byId<HTMLButtonElement>('settings').addEventListener('click', openSettings);
void render();
