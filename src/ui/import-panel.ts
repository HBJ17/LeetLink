// Import panel shared by the popup and the settings page. Asks before doing
// anything, shows the solved-problem count for confirmation, then follows the
// import's progress from chrome.storage.

import type { BackgroundRequest, ImportCountResponse, SimpleResponse } from '../lib/messages';
import { getImportState, type ImportState } from '../lib/storage';
import './import-panel.css';

export interface ImportPanelOptions {
  /** Question shown before the user chooses to import. */
  prompt: string;
  /** Show a "Not now" button next to the first question. */
  allowDismiss?: boolean;
}

type Step = { kind: 'ask' } | { kind: 'dismissed' } | { kind: 'counting' } | { kind: 'confirm'; text: string } | { kind: 'starting' };

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

/** Renders the import panel into `container` and keeps it up to date. */
export function mountImportPanel(container: HTMLElement, options: ImportPanelOptions): void {
  let step: Step = { kind: 'ask' };
  let state: ImportState | null = null;

  async function count(): Promise<void> {
    step = { kind: 'counting' };
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
    const reply = await send<SimpleResponse>({ type: 'importStart' }).catch(
      (err: unknown): SimpleResponse => ({ ok: false, error: String(err) }),
    );
    step = { kind: 'ask' };
    if (!reply.ok) {
      render(reply.error);
      return;
    }
    render();
  }

  function renderRunning(current: ImportState): HTMLElement[] {
    if (current.status === 'collecting') {
      return [
        text('Reading your LeetCode submissions. Keep a LeetCode tab open.'),
        text(`${current.collect.scanned} scanned, ${current.total} accepted found.`, 'll-import-detail'),
      ];
    }
    return [text(`Importing ${current.next} / ${current.total}.`)];
  }

  function renderIdle(error?: string): HTMLElement[] {
    const nodes: HTMLElement[] = [];
    if (error) nodes.push(text(error, 'll-import-error'));
    switch (step.kind) {
      case 'counting':
        return [...nodes, text('Checking LeetCode...')];
      case 'starting':
        return [...nodes, text('Starting the import...')];
      case 'confirm': {
        const row = document.createElement('div');
        row.className = 'll-import-actions';
        row.append(button('Import', () => void start(), true), button('Not now', () => ((step = { kind: 'ask' }), render())));
        return [...nodes, text(step.text), row];
      }
      case 'dismissed':
        return [...nodes, button('Import past submissions', () => void count())];
      case 'ask': {
        const row = document.createElement('div');
        row.className = 'll-import-actions';
        row.append(button('Yes', () => void count(), true));
        if (options.allowDismiss) row.append(button('Not now', () => ((step = { kind: 'dismissed' }), render())));
        return [...nodes, text(options.prompt), row];
      }
    }
  }

  function render(error?: string): void {
    const running = state && (state.status === 'collecting' || state.status === 'importing');
    const nodes = running && state ? renderRunning(state) : renderIdle(error ?? (state?.status === 'error' ? state.error ?? undefined : undefined));
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
