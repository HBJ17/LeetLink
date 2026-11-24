// Commit dialog shown over the LeetCode page. Lives in a Shadow DOM so
// LeetCode's styles cannot leak in and ours cannot leak out.

export interface CommitDraft {
  message: string;
  /** Notes for README.md, or null for no README. */
  notes: string | null;
  /** True once the user has seen the "Already committed" warning and commits anyway. */
  allowDuplicate: boolean;
}

export type CommitOutcome =
  | { ok: true; commitUrl: string }
  /**
   * `duplicatePath` is set when identical code is already committed there.
   * `retryAt` is set when the push was queued to be retried automatically.
   */
  | { ok: false; error: string; duplicatePath?: string; retryAt?: number };

export interface CommitDialogOptions {
  /** Shown as the dialog heading, e.g. `0001. Two Sum`. */
  heading: string;
  /** Short line under the heading, e.g. `Accepted · Python3 · 3 ms`. */
  subheading: string;
  defaultMessage: string;
  /** Open with the notes box shown instead of "No README". */
  notesByDefault?: boolean;
  /**
   * Resolves to the path of a file with identical code, or null. While it is
   * pending the dialog works normally; when it finds a copy, the dialog warns
   * and moves the default to Skip.
   */
  duplicateCheck?: Promise<string | null>;
  /** Performs the push. The dialog shows progress and the result. */
  onCommit: (draft: CommitDraft) => Promise<CommitOutcome>;
}

const HOST_ID = 'leetlink-commit-dialog';
const AUTO_CLOSE_MS = 5000;

const STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .backdrop {
    position: fixed; inset: 0; z-index: 2147483647;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0, 0, 0, 0.45);
    font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #f4f4f4;
  }
  .panel {
    width: min(480px, calc(100vw - 32px));
    background: #161616; border: 1px solid #2c2c2c; border-radius: 14px;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.5);
    padding: 20px;
  }
  header { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
  .brand { font-weight: 700; font-size: 13px; letter-spacing: 0.02em; color: #f4f4f4; }
  .brand b { color: #ffd600; }
  h2 { margin: 10px 0 2px; font-size: 17px; font-weight: 600; }
  .sub { margin: 0 0 16px; color: #9a9a9a; font-size: 13px; }
  label.field { display: block; font-size: 12px; color: #b5b5b5; margin: 0 0 6px; }
  input[type="text"], textarea {
    width: 100%; padding: 9px 11px;
    background: #0f0f0f; color: #f4f4f4;
    border: 1px solid #333; border-radius: 8px;
    font: 13px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace;
    outline: none;
  }
  input[type="text"]:focus, textarea:focus { border-color: #ffd600; }
  textarea { min-height: 120px; resize: vertical; margin-top: 8px; }
  .notes { margin-top: 16px; }
  .choice { display: flex; gap: 8px; }
  .choice button {
    flex: 1; padding: 7px 10px; border-radius: 8px; cursor: pointer;
    background: #0f0f0f; color: #cfcfcf; border: 1px solid #333; font: inherit; font-size: 13px;
  }
  .choice button[aria-pressed="true"] { border-color: #ffd600; color: #ffd600; }
  .status { min-height: 20px; margin: 14px 0 0; font-size: 13px; color: #9a9a9a; }
  .status.ok { color: #80ff9f; }
  .status.error { color: #ff7b7b; }
  .status a { color: #80ff9f; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
  .actions button {
    padding: 8px 16px; border-radius: 8px; cursor: pointer; font: inherit; font-weight: 600;
    border: 1px solid #333; background: transparent; color: #cfcfcf;
  }
  .actions button.primary { background: #ffd600; border-color: #ffd600; color: #161616; }
  .actions button:disabled { opacity: 0.5; cursor: default; }
  .duplicate {
    margin: 16px 0 0; padding: 10px 12px; border-radius: 8px;
    background: rgba(255, 214, 0, 0.08); border: 1px solid rgba(255, 214, 0, 0.35);
    color: #ffe680; font-size: 13px;
  }
  .duplicate code { font: 12px ui-monospace, SFMono-Regular, Consolas, monospace; color: #ffd600; word-break: break-all; }
  [hidden] { display: none !important; }
`;

const MARKUP = `
  <div class="backdrop" part="backdrop">
    <div class="panel" role="dialog" aria-modal="true" aria-labelledby="ll-heading">
      <header><span class="brand">Leet<b>Link</b></span></header>
      <h2 id="ll-heading"></h2>
      <p class="sub"></p>

      <label class="field" for="ll-message">Commit message</label>
      <input id="ll-message" type="text" spellcheck="false" autocomplete="off" />

      <div class="notes">
        <label class="field">README</label>
        <div class="choice" role="group">
          <button type="button" data-notes="none" aria-pressed="true">No README</button>
          <button type="button" data-notes="write" aria-pressed="false">Write notes</button>
        </div>
        <textarea id="ll-notes" placeholder="Approach, complexity, anything worth remembering..." hidden></textarea>
      </div>

      <p class="duplicate" role="alert" hidden></p>
      <p class="status" role="status"></p>

      <div class="actions">
        <button type="button" data-action="skip">Skip</button>
        <button type="button" data-action="commit" class="primary">Commit</button>
      </div>
    </div>
  </div>
`;

function query<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`LeetLink dialog is missing ${selector}`);
  return el;
}

/** Opens the commit dialog. Resolves when it closes. Only one dialog is shown at a time. */
export function openCommitDialog(options: CommitDialogOptions): Promise<void> {
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>${STYLES}</style>${MARKUP}`;

  const heading = query<HTMLHeadingElement>(shadow, 'h2');
  const sub = query<HTMLParagraphElement>(shadow, '.sub');
  const messageInput = query<HTMLInputElement>(shadow, '#ll-message');
  const notesInput = query<HTMLTextAreaElement>(shadow, '#ll-notes');
  const noneButton = query<HTMLButtonElement>(shadow, '[data-notes="none"]');
  const writeButton = query<HTMLButtonElement>(shadow, '[data-notes="write"]');
  const status = query<HTMLParagraphElement>(shadow, '.status');
  const skipButton = query<HTMLButtonElement>(shadow, '[data-action="skip"]');
  const commitButton = query<HTMLButtonElement>(shadow, '[data-action="commit"]');
  const backdrop = query<HTMLDivElement>(shadow, '.backdrop');
  const duplicateBanner = query<HTMLParagraphElement>(shadow, '.duplicate');

  heading.textContent = options.heading;
  sub.textContent = options.subheading;
  messageInput.value = options.defaultMessage;

  let writeNotes = false;
  let busy = false;
  let duplicatePath: string | null = null;
  /** Set once the user types or clicks, so a late warning does not steal focus. */
  let touched = false;

  /** Warns that identical code is already committed and makes Skip the default. */
  function showDuplicate(path: string): void {
    duplicatePath = path;
    const code = document.createElement('code');
    code.textContent = path;
    duplicateBanner.replaceChildren('Already committed as ', code, '. Committing again adds an identical copy.');
    duplicateBanner.hidden = false;
    commitButton.textContent = 'Commit anyway';
    commitButton.classList.remove('primary');
    skipButton.classList.add('primary');
    if (!touched && !busy) skipButton.focus();
  }

  function setNotesMode(write: boolean, focus = true): void {
    writeNotes = write;
    noneButton.setAttribute('aria-pressed', String(!write));
    writeButton.setAttribute('aria-pressed', String(write));
    notesInput.hidden = !write;
    if (write && focus) notesInput.focus();
  }

  setNotesMode(options.notesByDefault ?? false, false);

  function setStatus(text: string, kind: 'info' | 'ok' | 'error' = 'info'): void {
    status.className = kind === 'info' ? 'status' : `status ${kind}`;
    status.textContent = text;
  }

  return new Promise<void>((resolve) => {
    let closeTimer: number | undefined;

    function close(): void {
      if (closeTimer !== undefined) window.clearTimeout(closeTimer);
      host.remove();
      resolve();
    }

    async function commit(): Promise<void> {
      if (busy) return;
      const message = messageInput.value.trim();
      if (!message) {
        setStatus('Commit message cannot be empty.', 'error');
        messageInput.focus();
        return;
      }
      const notes = writeNotes && notesInput.value.trim() ? notesInput.value.trim() : null;

      busy = true;
      commitButton.disabled = true;
      skipButton.disabled = true;
      setStatus('Pushing to GitHub...');

      const outcome = await options
        .onCommit({ message, notes, allowDuplicate: duplicatePath !== null })
        .catch((err: unknown): CommitOutcome => ({ ok: false, error: String(err) }));

      busy = false;
      skipButton.disabled = false;
      if (outcome.ok) {
        status.className = 'status ok';
        status.textContent = 'Pushed. ';
        const link = document.createElement('a');
        link.href = outcome.commitUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'View commit';
        status.append(link);
        skipButton.textContent = 'Close';
        commitButton.hidden = true;
        closeTimer = window.setTimeout(close, AUTO_CLOSE_MS);
      } else if (outcome.retryAt !== undefined) {
        // Queued in the background: offering "Try again" here would queue it twice.
        setStatus(`${outcome.error} Saved; LeetLink will retry automatically.`);
        skipButton.textContent = 'Close';
        commitButton.hidden = true;
      } else if (outcome.duplicatePath) {
        // The push found a copy the early check missed. Warn, and let the next click commit anyway.
        commitButton.disabled = false;
        setStatus('');
        touched = false;
        showDuplicate(outcome.duplicatePath);
      } else {
        commitButton.disabled = false;
        commitButton.textContent = 'Try again';
        setStatus(outcome.error, 'error');
      }
    }

    noneButton.addEventListener('click', () => setNotesMode(false));
    writeButton.addEventListener('click', () => setNotesMode(true));
    skipButton.addEventListener('click', close);
    commitButton.addEventListener('click', () => void commit());
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop && !busy) close();
    });

    // Keep keystrokes away from LeetCode's editor shortcuts.
    for (const type of ['keydown', 'keyup', 'keypress'] as const) {
      host.addEventListener(type, (event) => event.stopPropagation());
    }
    host.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !busy) close();
      // Events are retargeted to the host outside the shadow root, so use the composed path.
      if (event.key === 'Enter' && event.composedPath()[0] === messageInput) void commit();
    });

    for (const type of ['keydown', 'pointerdown'] as const) {
      host.addEventListener(type, () => {
        touched = true;
      });
    }

    document.documentElement.append(host);
    messageInput.focus();
    messageInput.select();

    options.duplicateCheck
      ?.then((path) => {
        if (path && host.isConnected && duplicatePath === null) showDuplicate(path);
      })
      .catch(() => undefined);
  });
}
