# DeskMate

A safe, local AI agent that organizes your real files. You talk to it in
plain language — "organize my Desktop", "find my resume", "what's on my
Desktop?" — and it acts, through a terminal **or** a small Windows tray app.

The one thing worth knowing before anything else: **the LLM never touches
your files.** It only ever proposes a plan; your own deterministic code
validates it, shows you a preview, and only executes after you confirm — with
an undo journal so every organize run can be reversed. See
[DESIGN.md](DESIGN.md) for the full architecture.

## One engine, two faces

DeskMate's actual file logic — the tools, the agent loop, the typed-plan
validator, the transactional executor, preferences, RAG — lives entirely
under `src/`, and doesn't know or care who's calling it. Two separate, thin
front ends call the exact same engine:

- **The terminal** (`index.js`) — a readline loop.
- **The tray app** (`electron/`) — an Electron main process that calls the
  engine over IPC and renders results in a small chat window.

Concretely: `src/agent/session.js` (`createSession` / `sendChatMessage`) and
`src/safety/runOrganize.js` (`confirm` takes the raw plan, not pre-rendered
text) are what both faces call. Neither face has its own copy of any file
logic — the terminal's `handleOrganize` formats the plan as text for a
readline prompt, `electron/main.js`'s `waitForUserConfirm` formats the same
plan as `{name, category}` pairs for a preview card with buttons, but both
are just presentation on top of the identical `runOrganize(model, {confirm})`
call, which runs the identical validator and executor either way. The Yes
button in the tray app is a nicer version of typing "yes" at the terminal —
never a shortcut around validation.

## Setup

Requires Node.js and a free [Groq](https://console.groq.com) API key.

```
npm install
cp .env.example .env
# then put your real key in .env: GROQ_API_KEY=gsk_...
```

## Screeshots
Before: 
<img width="633" height="329" alt="image" src="https://github.com/user-attachments/assets/1459c862-12ab-48d1-82be-961f23e61f74" />
<img width="184" height="278" alt="image" src="https://github.com/user-attachments/assets/e23c4361-7012-4fa5-8999-fca987593bc2" />
<img width="152" height="112" alt="image" src="https://github.com/user-attachments/assets/e273b43a-baad-4ece-894b-fab9eca36a60" />

<img width="640" height="251" alt="image" src="https://github.com/user-attachments/assets/bb483782-e7a0-41df-8e9f-aaed8fe2c537" />

## Running — terminal

```
npm start
```

## Running — tray app (dev mode)

```
npm run dev
```

No window opens immediately — look for a small blue circle in your system
tray (near the clock; check the "hidden icons" arrow if your tray auto-hides
icons). Left-click it to show/hide the chat window; right-click for **Show
DeskMate** / **Undo last organize** / **Quit**. Closing the window (X) or
clicking away just hides it — only **Quit** from the tray menu actually
exits.

## Building a real Windows app

```
npm run build
```

Produces two things in `dist-installer/`:

- **`DeskMate Setup <version>.exe`** — a normal Windows installer (Start
  Menu shortcut, uninstaller, lets you pick the install folder).
- **`DeskMate <version>.exe`** — a portable build, no installation needed,
  just double-click and run.

Since this isn't code-signed with a paid certificate, Windows SmartScreen
may warn on first launch ("Windows protected your PC") — click **More
info → Run anyway**. This is expected for a personally-built app, not a sign
of a problem.

**Where your data goes once installed:** the packaged app never writes
inside its own install folder (it may be read-only, and gets wiped on
update/uninstall) — it redirects the undo journal and preferences to your
own per-user AppData folder (`electron/main.js` sets this only when
`app.isPackaged` is true; `npm run dev` keeps using the project's own
`data/` folder, so both faces share state while you're developing).

**Your API key isn't bundled into the installer** — that would leak your
personal key into anything you share. The packaged app looks for a `.env`
file next to your user data first; drop one there with your real
`GROQ_API_KEY` after installing. In dev mode, it just uses the project's own
`.env` as before.

**Swapping in a real icon**: replace `electron/assets/icon.png` (window),
`electron/assets/tray-icon.png` (tray), and `electron/assets/icon.ico`
(Windows app/installer icon — needs to actually be a multi-resolution
`.ico`, not just a renamed `.png`) with your own art at the same filenames.

## What you can do

| Say this | What happens |
|---|---|
| `what's on my Desktop?` / `find my resume` | Real answers via read-only file tools |
| `organize my Desktop` | Groups items into categories, shows a preview, waits for confirmation, then moves files |
| `undo` | Reverses the most recent organize run, exactly |
| `never touch my flutter folder` | Saves a standing rule — enforced by the validator on every future organize, not just prompted |
| `what rules do you remember?` | Lists every saved rule |
| `index my notes folder` | Loads `.txt`/`.md`/`.pdf` files into a local vector store |
| `which document mentions X?` | Answers from the indexed documents, citing the filename |
| `exit` (terminal) / tray menu **Quit** | Quits |

## Testing

```
npm test
```

Runs against a throwaway temp folder tree, never your real Desktop — see
`test/` and the "Testing philosophy" section of [DESIGN.md](DESIGN.md).
Covers: the validator's rejection rules, a full move → undo cycle, the
mid-run-failure rollback path, and the LLM repair-retry loop (via a small
scripted fake model, no real API calls).

## Demo script

1. `what's on my Desktop right now?` — proves real file awareness
2. `organize my Desktop` → review the preview → confirm — the hero flow: plan → validate → preview → execute → journal
3. `undo` — transactional rollback
4. `never touch my <folder> folder`, then `organize` again — persistent, enforced preference
5. `index <a folder with notes>`, then ask a question about it — local RAG, cites the filename
6. `npm test` — a safety-critical file agent with a real test suite
7. Same flow, tray app: `npm run dev` → click the tray icon → same conversation, same plan preview, now with buttons

## Project layout

See [DESIGN.md](DESIGN.md#project-structure) for the full map of `src/`, and
the "One engine, two faces" section above for how `electron/` fits in.

## 👩‍💻 Author

**Manal Manzoor**

Software Engineering Student
COMSATS University Islamabad, Wah Campus

GitHub: https://github.com/manalmanzoor

If you found this project interesting, consider giving it a star!
