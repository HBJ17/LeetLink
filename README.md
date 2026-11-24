<p align="center">
  <img src="icons/icon128.png" width="96" height="96" alt="LeetLink logo">
</p>

<h1 align="center">LeetLink</h1>

<p align="center">A browser extension that pushes your LeetCode submissions to a GitHub repository,<br>with your own commit messages and optional notes.</p>

---

## Features

- **Push on submit.** When a submission is judged, a dialog on the LeetCode page offers to commit it. Edit the commit message, add notes for a `README.md`, then **Commit** or **Skip**.
- **Every solution is kept.** Re-submitting creates a new numbered file (`two-sum_py_1.py`, `two-sum_py_2.py`, ...), so brute-force and optimized versions both stay. Nothing is ever overwritten or deleted.
- **Duplicate detection.** If the same code is already in the repository, the dialog says **Already committed** and defaults to Skip. The check compares Git content hashes, so no files are downloaded.
- **Works with existing repositories.** Problem folders made by other tools (`1-two-sum`, `0001-two-sum`, ...) are recognized, and new files go into them instead of a second folder.
- **Import past submissions.** Optionally import all of your past accepted submissions, each committed with its original submission date, oldest first. Pause, resume and cancel at any time; an interrupted import picks up where it stopped.
- **Reliable pushes.** Pushes that fail because you are offline or rate limited are queued and retried automatically. A toast links to each commit.
- **Configurable.** Accepted-only or all submissions, a commit message template, confirmation on or off, and a choice of branch.

## Repository layout

```
0001_two-sum/
  two-sum_py_1.py      every submission is kept
  two-sum_py_2.py
  README.md            only if you wrote notes
0020_valid-parentheses/
  valid-parentheses_cpp_1.cpp
```

In "All submissions" mode the result is part of the file name, for example `two-sum_py_wrong-answer_3.py`.

## Install

LeetLink is not in an extension store yet. To install it from source:

1. Install [Node.js](https://nodejs.org/) 22.12 or newer.
2. Clone this repository and build it:
   ```bash
   npm install
   npm run build
   ```
3. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the `dist` folder.

It works in Chrome and other Chromium browsers (Edge, Brave), version 111 or newer.

## Setup

The settings page opens after installing. You can reopen it from the toolbar popup.

1. **Create a GitHub token.** Go to GitHub, **Settings → Developer settings → Fine-grained personal access tokens → Generate new token**.
   - **Repository access:** *Only select repositories*, and pick the repository for your solutions.
   - **Permissions:** *Contents: Read and write*. Nothing else is needed.
2. **Connect the repository.** Paste the repository link (for example `https://github.com/you/leetcode`) and the token, then click **Check and save**. LeetLink checks that the token can write to the repository before saving anything.
3. If the repository already has solutions, choose whether to **keep them and add only what is missing**, or **just connect** without importing.
4. Optionally **import your past accepted submissions**. LeetLink shows how many problems you have solved and asks again before starting.

LeetLink uses your existing LeetCode session in the browser. It never asks for your LeetCode password.

## Commit messages

The default message is `{number}_{slug}_{result}`, for example `0001_two-sum_3ms`, or `0001_two-sum_wrong-answer` for a submission that did not pass. You can change the template in settings:

| Placeholder | Example |
|---|---|
| `{number}` | `0001` |
| `{id}` | `1` |
| `{slug}` | `two-sum` |
| `{title}` | `Two Sum` |
| `{difficulty}` | `Easy` |
| `{lang}` | `python3` |
| `{runtime}` | `3ms` |
| `{memory}` | `17.4MB` |
| `{status}` | `accepted`, `wrong-answer` |
| `{result}` | runtime when accepted, otherwise the result |

Imported submissions use `{number}_{slug}`, for example `0001_two-sum`.

## Importing past submissions

The import first reads your accepted submissions on a LeetCode tab (keep one open while it runs), then commits them one at a time, oldest first. Each commit is dated when you originally submitted the solution and uses your GitHub noreply address, so it counts on your contribution graph.

Requests are spaced out to stay inside GitHub's and LeetCode's limits, so a large history can take a while. If GitHub asks LeetLink to slow down, the import waits and continues on its own. Progress is saved after every submission, so closing the browser does not lose your place.

## Privacy

- Your GitHub token is stored only in this browser's extension storage (`chrome.storage.local`). It is sent only to `api.github.com` and is never logged.
- LeetLink talks only to `leetcode.com` and `api.github.com`. There is no server and no analytics.
- Use a fine-grained token limited to your solutions repository, so the extension cannot touch anything else.

## Limitations

- LeetCode's API is not public and may change without notice, which could break submission detection or the import until LeetLink is updated.
- `leetcode.cn` is not supported.
- A protected branch that rejects direct pushes cannot be used; choose another branch in settings or relax the rule.

## Development

```bash
npm install
npm run dev        # rebuild on changes, then reload the extension
npm test           # unit tests (Vitest)
npm run typecheck
npm run build      # typecheck and build into dist/
npm run package    # build and zip dist/ for upload to an extension store
```

```
src/
  background/   service worker: pushes, retry queue, import
  content/      LeetCode page: submission hook, commit dialog, toasts
  options/      settings page
  popup/        toolbar popup
  ui/           parts shared by the settings page and popup
  lib/          LeetCode and GitHub clients, naming, hashing, storage
tests/          unit tests
```

`src/lib/leetcode.ts` is the only file that knows LeetCode's endpoints, and `src/lib/github.ts` the only one that knows GitHub's.
