// Settings page. The repository and token are saved only once the token is
// confirmed to have write access; pushing preferences save on change.

import { GitHubClient, parseRepoLink, repoWebUrl } from '../lib/github';
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
const pushModeInputs = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="pushMode"]'));
const confirmInput = byId<HTMLInputElement>('confirm');

function setStatus(text: string, kind: 'info' | 'ok' | 'error' = 'info'): void {
  status.className = kind === 'info' ? 'status' : `status ${kind}`;
  status.textContent = text;
}

function render(settings: Settings): void {
  repoInput.value = settings.owner && settings.repo ? repoWebUrl(settings) : '';
  branchInput.value = settings.branch;
  tokenInput.value = '';
  tokenInput.placeholder = settings.token ? 'Saved. Leave blank to keep it.' : 'github_pat_...';
  for (const radio of pushModeInputs) radio.checked = radio.value === settings.pushMode;
  confirmInput.checked = settings.confirmBeforeCommit;
}

/** Pushing preferences save as soon as they change; they do not need the repository check. */
async function savePreferences(): Promise<void> {
  const mode = pushModeInputs.find((r) => r.checked)?.value;
  await updateSettings({
    pushMode: mode === 'all' ? 'all' : 'accepted',
    confirmBeforeCommit: confirmInput.checked,
  });
  setStatus('Preferences saved.', 'ok');
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

  const branch = branchInput.value.trim();
  setStatus(`Checking access to ${ref.owner}/${ref.repo}...`);
  const check = await new GitHubClient(token, ref.owner, ref.repo).verifyAccess(branch);

  // Store the canonical owner/repo casing GitHub reports.
  const [owner = ref.owner, repo = ref.repo] = check.repository.fullName.split('/');
  const saved = await updateSettings({ owner, repo, token, branch });
  render(saved);

  const where = check.empty ? 'The repository is empty; the first push will create' : 'Pushing to';
  setStatus(`Connected to ${check.repository.fullName}. ${where} branch "${check.branch}".`, 'ok');
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

for (const input of [...pushModeInputs, confirmInput]) {
  input.addEventListener('change', () => {
    savePreferences().catch((err: unknown) => setStatus(String(err), 'error'));
  });
}

getSettings().then(render, (err: unknown) => setStatus(String(err), 'error'));
