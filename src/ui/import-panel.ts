// Import panel shared by the popup and the settings page. Asks before doing
// anything, shows the solved-problem count for confirmation, then follows the
// import's progress from chrome.storage, with Pause, Resume and Cancel.

import type { BackgroundRequest, ImportCountResponse, SimpleResponse } from '../lib/messages';
import { getImportState, type ImportState } from '../lib/storage';
import './import-panel.css';

export interface ImportPanelOptions {
  /** Question shown before the user chooses to import. */
  prompt: string;
  /** Show a "Not now" button next to the first question. */
  allowDismiss?: boolean;
}

type Step =
  | { kind: 'ask' }
  | { kind: 'dismissed' }
  | { kind: 'counting' }
  | { kind: 'confirm'; text: string }
  | { kind: 'starting' };

function send<T>(request: BackgroundRequest): Promise<T> {
  return chrome.runtime.sendMessage(request) as Promise<T>;
}

function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = label;
  el.className = primary ? 'll-import-button primary' : 'll-import-button';
  el.addEventListener('click', onClick);
  return el;
}

function text(content: string, className = 'll-import-text'): HTMLParagraphElement {
  const el = document.createElement('p');
  el.className = className;
  el.textContent = content;
  return el;
}

function actions(...buttons: HTMLButtonElement[]): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'll-import-actions';
  row.append(...buttons);
  return row;
}

/** Progress bar; `null` shows an indeterminate bar while the total is unknown. */
function progressBar(fraction: number | null, label: string): HTMLDivElement {
  const bar = document.createElement('div');
  bar.className = fraction === null ? 'll-import-bar indeterminate' : 'll-import-bar';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', label);
  if (fraction !== null) {
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
  }
  const fill = document.createElement('div');
  fill.className = 'll-import-fill';
  if (fraction !== null) fill.style.width = `${Math.min(100, Math.max(0, fraction * 100))}%`;
  bar.append(fill);
  return bar;
}

function summary(state: ImportState): string {
  const pushed = `${state.pushed} ${state.pushed === 1 ? 'submission' : 'submissions'} imported`;
  return state.skipped ? `${pushed}, ${state.skipped} already in the repository.` : `${pushed}.`;
}

/** Renders the import panel into `container` and keeps it up to date. */
export function mountImportPanel(container: HTMLElement, options: ImportPanelOptions): void {
  let step: Step = { kind: 'ask' };
  let state: ImportState | null = null;
  let error: string | undefined;

  async function request(message: BackgroundRequest): Promise<void> {
    const reply = await send<SimpleResponse>(message).catch(
      (err: unknown): SimpleResponse => ({ ok: false, error: String(err) }),
    );
    error = reply.ok ? undefined : reply.error;
    render();
  }

  async function count(): Promise<void> {
    step = { kind: 'counting' };
    error = undefined;
    render();
    const reply = await send<ImportCountResponse>({ type: 'importCount' }).catch(
      (err: unknown): ImportCountResponse => ({ ok: false, error: String(err) }),
    );
    step = reply.ok
      ? {
          kind: 'confirm',
          text: `Found ${reply.solved} solved ${reply.solved === 1 ? 'problem' : 'problems'} for ${reply.username}. Import them?`,
        }
      : { kind: 'confirm', text: `Could not count your solved problems (${reply.error}) Import your accepted submissions anyway?` };
    render();
  }

  async function start(): Promise<void> {
    step = { kind: 'starting' };
    render();
    await request({ type: 'importStart' });
    step = { kind: 'ask' };
    render();
  }

  function renderActive(current: ImportState): HTMLElement[] {
    const pause = button('Pause', () => void request({ type: 'importPause' }));
    const cancel = button('Cancel', () => void request({ type: 'importCancel' }));
    if (current.status === 'collecting') {
      return [
        text('Reading your LeetCode submissions. Keep a LeetCode tab open.'),
        progressBar(null, 'Reading submissions'),
        text(`${current.collect.scanned} scanned, ${current.total} accepted found.`, 'll-import-detail'),
        actions(pause, cancel),
      ];
    }
    const fraction = current.total ? current.next / current.total : 0;
    return [
      text(`Importing ${current.next} / ${current.total}`),
      progressBar(fraction, 'Import progress'),
      text(summary(current), 'll-import-detail'),
      actions(pause, cancel),
    ];
  }

  function renderPaused(current: ImportState): HTMLElement[] {
    const where = current.collect.done
      ? `Paused at ${current.next} / ${current.total}.`
      : `Paused while reading submissions (${current.total} found so far).`;
    return [
      text(where),
      progressBar(current.collect.done && current.total ? current.next / current.total : null, 'Import progress'),
      actions(
        button('Resume', () => void request({ type: 'importResume' }), true),
        button('Cancel', () => void request({ type: 'importCancel' })),
      ),
    ];
  }

  function renderIdle(current: ImportState | null): HTMLElement[] {
    const nodes: HTMLElement[] = [];
    const shownError = error ?? (current?.status === 'error' ? current.error ?? undefined : undefined);
    if (shownError) nodes.push(text(shownError, 'll-import-error'));
    if (current?.status === 'done' && step.kind === 'ask') {
      nodes.push(text(`Import finished. ${summary(current)}`));
      return [...nodes, actions(button('Import again', () => void count()))];
    }
    if (current?.status === 'cancelled' && step.kind === 'ask') {
      nodes.push(text(`Import cancelled. ${summary(current)}`));
      return [...nodes, actions(button('Start over', () => void count()))];
    }
    switch (step.kind) {
      case 'counting':
        return [...nodes, text('Checking LeetCode...')];
      case 'starting':
        return [...nodes, text('Starting the import...')];
      case 'confirm':
        return [
          ...nodes,
          text(step.text),
          actions(
            button('Import', () => void start(), true),
            button('Not now', () => {
              step = { kind: 'ask' };
              render();
            }),
          ),
        ];
      case 'dismissed':
        return [...nodes, actions(button('Import past submissions', () => void count()))];
      case 'ask': {
        const row = actions(button('Yes', () => void count(), true));
        if (options.allowDismiss) {
          row.append(
            button('Not now', () => {
              step = { kind: 'dismissed' };
              render();
            }),
          );
        }
        return [...nodes, text(options.prompt), row];
      }
    }
  }

  function render(): void {
    let nodes: HTMLElement[];
    if (state?.status === 'collecting' || state?.status === 'importing') nodes = renderActive(state);
    else if (state?.status === 'paused') nodes = renderPaused(state);
    else nodes = renderIdle(state);
    container.replaceChildren(...nodes);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes['importState']) return;
    void getImportState().then((next) => {
      state = next;
      render();
    });
  });

  void getImportState().then((current) => {
    state = current;
    render();
  });
}
