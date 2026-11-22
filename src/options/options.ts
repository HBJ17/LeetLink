// Settings page. The repository and token are saved only once the token is
// confirmed to have write access; everything else saves on change.

import { GitHubClient, parseRepoLink, repoWebUrl } from '../lib/github';
import { ACCEPTED_STATUS } from '../lib/messages';
import { DEFAULT_MESSAGE_TEMPLATE, renderCommitMessage, TEMPLATE_PLACEHOLDERS, type MessageContext } from '../lib/naming';
import { scanRepository, type ProblemFolder } from '../lib/repo-scan';
import { getSettings, updateSettings, type ExistingRepoChoice, type Settings } from '../lib/storage';

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
const templateInput = byId<HTMLInputElement>('template');
const templatePreview = byId<HTMLElement>('template-preview');
const notesInputs = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="notesDefault"]'));

/** Sample submission for the template preview. */
const SAMPLE: MessageContext = {
  problem: { frontendId: '1', title: 'Two Sum', titleSlug: 'two-sum', difficulty: 'Easy' },
  submission: { lang: 'python3', runtime: '3 ms', memory: '17.4 MB', statusCode: ACCEPTED_STATUS, statusMsg: 'Accepted' },
};

function renderPlaceholders(): void {
  const list = byId<HTMLDListElement>('placeholders');
  for (const [key, description] of Object.entries(TEMPLATE_PLACEHOLDERS)) {
    const term = document.createElement('dt');
    const code = document.createElement('code');
    code.textContent = `{${key}}`;
    term.append(code);
    const detail = document.createElement('dd');
    detail.textContent = description;
    list.append(term, detail);
  }
}

function updatePreview(): void {
  templatePreview.textContent = renderCommitMessage(templateInput.value.trim() || DEFAULT_MESSAGE_TEMPLATE, SAMPLE);
}

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
  templateInput.value = settings.messageTemplate || DEFAULT_MESSAGE_TEMPLATE;
  for (const radio of notesInputs) radio.checked = (radio.value === 'write') === settings.notesByDefault;
  updatePreview();
}

/** Preferences save as soon as they change; they do not need the repository check. */
async function savePreferences(): Promise<void> {
  const mode = pushModeInputs.find((r) => r.checked)?.value;
  const template = templateInput.value.trim();
  await updateSettings({
    pushMode: mode === 'all' ? 'all' : 'accepted',
    confirmBeforeCommit: confirmInput.checked,
    // The default is stored as empty so a future change to it applies automatically.
    messageTemplate: template === DEFAULT_MESSAGE_TEMPLATE ? '' : template,
    notesByDefault: notesInputs.some((r) => r.checked && r.value === 'write'),
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
  const connected = `Connected to ${check.repository.fullName}. ${where} branch "${check.branch}".`;
  setStatus(connected, 'ok');
  if (check.empty) return;

  // Look for problem folders already in the repository, from LeetLink or another tool.
  setStatus(`${connected} Looking for existing solutions...`, 'ok');
  let folders: ProblemFolder[];
  try {
    folders = await findProblemFolders(new GitHubClient(token, owner, repo), check.branch);
  } catch {
    setStatus(`${connected} Could not scan the repository for existing solutions.`, 'ok');
    return;
  }
  if (!folders.length) {
    setStatus(connected, 'ok');
    return;
  }

  const choice = await askExistingRepoChoice(check.repository.fullName, folders, saved.existingRepoChoice);
  if (choice) await updateSettings({ existingRepoChoice: choice });
  const outcome =
    (choice ?? saved.existingRepoChoice) === 'connect'
      ? 'Only new submissions will be pushed.'
      : 'Existing files stay as they are; an import adds only what is missing.';
  setStatus(`${connected} ${countLabel(folders.length)} found. ${outcome}`, 'ok');
}

async function findProblemFolders(client: GitHubClient, branch: string): Promise<ProblemFolder[]> {
  const head = await client.getRef(branch);
  if (!head) return [];
  return (await scanRepository(client, await client.getCommitTree(head))).folders;
}

function countLabel(count: number): string {
  return count === 1 ? '1 problem folder' : `${count} problem folders`;
}

/**
 * Asks what to do with a repository that already has problem folders.
 * Resolves to the choice, or null when the dialog is dismissed.
 */
function askExistingRepoChoice(
  repoName: string,
  folders: readonly ProblemFolder[],
  current: ExistingRepoChoice | '',
): Promise<ExistingRepoChoice | null> {
  const dialog = byId<HTMLDialogElement>('existing-repo');
  byId<HTMLElement>('existing-repo-count').textContent = countLabel(folders.length);
  byId<HTMLElement>('existing-repo-name').textContent = repoName;

  const examples = byId<HTMLElement>('existing-repo-examples');
  examples.replaceChildren();
  folders.slice(0, 3).forEach((folder, i) => {
    if (i > 0) examples.append(', ');
    const code = document.createElement('code');
    code.textContent = folder.path;
    examples.append(code);
  });

  return new Promise((resolve) => {
    dialog.returnValue = '';
    dialog.addEventListener(
      'close',
      () => {
        const value = dialog.returnValue;
        resolve(value === 'keep' || value === 'connect' ? value : null);
      },
      { once: true },
    );
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>(`button[value="${current || 'keep'}"]`)?.focus();
  });
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

for (const input of [...pushModeInputs, confirmInput, templateInput, ...notesInputs]) {
  input.addEventListener('change', () => {
    savePreferences().catch((err: unknown) => setStatus(String(err), 'error'));
  });
}

templateInput.addEventListener('input', updatePreview);
templateInput.addEventListener('keydown', (event) => {
  // Enter would submit the repository form; save the template instead.
  if (event.key === 'Enter') {
    event.preventDefault();
    templateInput.blur();
  }
});

renderPlaceholders();
getSettings().then(render, (err: unknown) => setStatus(String(err), 'error'));
