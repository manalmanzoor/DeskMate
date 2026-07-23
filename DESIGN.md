# DeskMate — Design

DeskMate is a local, terminal AI agent that organizes real files on your
Desktop. The one idea the whole codebase is built around:

> The LLM only ever **proposes** a plan. It never touches the filesystem
> directly. Deterministic, unit-tested code **validates** that plan and
> **executes** it — with a rollback journal so it can always be undone.

Everything below exists to make that sentence true.

## The pipeline

Every file-changing request (`organize my Desktop`) flows through five
stages. The LLM only ever touches the first one.

```
1. Request   you type "organize my Desktop"
2. Agent     LLM reads the Desktop listing, calls propose_plan (AI)
3. Validator pure code checks the plan: scope, protected paths,
             missing sources, collisions                        (code)
4. Preview   shown to you in the terminal, waits for "yes"       (code)
5. Executor  moves files, writes every move to an undo journal   (code)
```

Stages 3–5 never involve the model. They are plain, synchronous(-ish)
JavaScript, fully covered by `test/`.

## The hand-written agent loop (`src/agent/loop.js`)

Read-only chat ("what's on my Desktop?", preferences, RAG questions) uses a
tool-calling loop written out by hand instead of hidden behind LangChain's
`AgentExecutor`:

1. Send the conversation so far to the model.
2. If the reply asks for one or more tools, run them ourselves and feed the
   results back as `ToolMessage`s.
3. Repeat until the model replies with plain text — that's the final answer.
4. A `MAX_STEPS` cap (8) stops a confused model from looping forever.

One real bug this surfaced during development: Groq sends `args: null`
(not `{}`) for a tool with an empty-argument schema (`list_preferences`),
which fails Zod validation every time and makes the model retry forever.
Fixed by normalizing `call.args ?? {}` before invoking any tool — this
protects every current and future zero-argument tool, not just that one.

## Typed Plan + validation (`src/plan/`)

`src/plan/schema.js` defines the Plan shape with Zod — an array of
`{ from, to, category }`. `src/agent/organize.js` forces the model to
respond by calling a single `propose_plan` tool (via `tool_choice`), so the
output is always structured JSON, never free text to hopefully parse.

`src/plan/validator.js` (`validatePlan`) is pure and synchronous-in-spirit
(its only I/O is read-only `fs.existsSync` checks). It rejects a plan for:

- **Out of scope** — `from` isn't a direct child of the Desktop, or `to`
  isn't inside the Desktop tree. Organize never reaches into a project
  folder's internals.
- **Protected** — `from`/`to` touches a protected path (see below).
- **Missing source** — `from` doesn't actually exist (catches a hallucinated
  filename that was never in the real listing).
- **No-op** — `from === to`.
- **Collision** — the destination already exists on disk, or two different
  items in the same plan both target the same destination.

If the model's output is malformed JSON **or** fails validation,
`proposeOrganizePlan` sends the concrete problem back to the model and lets
it retry — up to 3 attempts total, covering both failure modes with the same
loop.

## Transactional executor + undo (`src/safety/`)

Only two low-level file operations exist anywhere in this codebase:
`create_folder` and `move_file`. **There is no delete function.** Undo is
implemented purely by moving things back.

`executePlan` treats a whole organize run as one transaction: if any single
move fails partway through (a real case hit during development — Windows
refusing a rename because something else, usually VS Code's file watcher or
antivirus, had the folder open), everything already moved in that run is
rolled back, and any folders the run had created — now empty again — are
recursively removed. `removeIfEmptyRecursive` calls `fs.rmdir`, which
Node/Windows refuses on a non-empty directory, so this cleanup step
physically cannot delete real content.

Every successful run is appended to `data/undo-journal.json` as
`{ timestamp, moves: [{ from, to, category }] }`. `undo` reverses the most
recent entry and pops it off.

## Protected folders — static and preference-based

Two layers, both enforced by the same `validatePlan` check:

1. **Static**: `PROTECTED_FOLDERS` in `src/config.js` always includes
   DeskMate's own project root, so it never reorganizes itself even though
   it can live directly on the Desktop.
2. **Preference-based**: when you tell DeskMate "never touch my X folder",
   `save_preference` can optionally record a `protectFolderName`. This gets
   merged into the validator's protected-folder check on every future
   organize — not just mentioned in the prompt and hoped for. A rule like
   this is a deterministic guarantee, same as the built-in protections.

## Preference memory (`src/memory/preferences.js`)

Preferences persist as a flat JSON array (`data/preferences.json`). There is
deliberately no separate "classify this message" LLM call — `save_preference`
and `list_preferences` are just two more tools in the same general chat
agent loop, exactly like `search_files`. The model already decides when to
call a tool; remembering a rule is just one more choice it can make.

## Mini-RAG (`src/rag/store.js`)

`index_folder` recursively collects `.txt`/`.md`/`.pdf` files (PDFs via
`@langchain/community`'s `PDFLoader`), splits them into ~500-character
chunks, and embeds them locally (`Xenova/all-MiniLM-L6-v2` via
`@huggingface/transformers` — no API key, no per-call cost) into an
in-memory vector store. `search_notes` returns the top matches with source
filename and similarity score; the system prompt tells the model to always
cite the filename when answering from these. Indexing a new folder replaces
whatever was indexed before — only one "notes" folder is active at a time.

## Testing philosophy (`test/`)

The LLM's categorization judgment isn't something you can unit test
meaningfully — it's inherently qualitative. What the safety pitch actually
depends on is deterministic, and that's exactly what's tested, with zero
real API calls:

- **`validator.test.js`** — every rejection rule in `validatePlan`, against
  a real temp folder tree.
- **`executor-undo.test.js`** — a full real move → undo cycle (files land
  in the right categories, an untouched folder stays untouched, undo
  restores byte-for-byte), plus the mid-run-failure rollback + empty-folder
  cleanup path.
- **`organize-repair.test.js`** — the retry-with-repair loop, using a small
  scripted fake model (not the real Groq API) that returns malformed JSON,
  then a schema-valid-but-unsafe plan, then a good one — proving the repair
  loop actually recovers, deterministically and for free.

`DESKMATE_DESKTOP_PATH` / `DESKMATE_DATA_DIR` env vars (`src/config.js`)
exist solely so tests can point the whole pipeline at a throwaway temp
directory instead of a real Desktop.

## Project structure

```
index.js                    terminal loop, command routing, system prompt
electron/                   the tray-app face (see below) — plain CommonJS,
                             own package.json ("type": "commonjs"), talks to
                             the same src/ engine over IPC
  main.js                    tray, window, IPC handlers, packaged-app data/env redirect
  preload.js                 contextBridge — the renderer's only door to main
  renderer/                  chat UI: message list, plan preview card, buttons
  assets/                    icon.png / tray-icon.png / icon.ico (placeholders)
src/config.js                paths, protected folders (env-overridable for tests)
src/agent/
  chat.js                    Groq model factory
  session.js                 shared: createSession / sendChatMessage — used by BOTH faces
  loop.js                    hand-written tool-calling agent loop
  tools.js                   read-only file tools (scan/search/stats/recent)
  preferenceTools.js         save_preference / list_preferences
  ragTools.js                index_folder / search_notes
  organize.js                LLM plan proposal + repair-retry + validation
  deskReport.js               post-organize summary
src/plan/
  schema.js                  Zod Plan shape
  validator.js                deterministic plan checks
src/safety/
  executor.js                  create_folder / move_file, transactional apply
  journal.js                   undo journal read/write
  undo.js                      reverse the most recent run
  runOrganize.js                propose -> preview/confirm -> execute orchestration (confirm receives raw moves, not rendered text, so each face renders its own)
src/memory/preferences.js     standing rules, persisted to JSON
src/tools/fileTools.js        raw read-only filesystem functions
src/rag/store.js              local embeddings, chunking, vector store
test/                         validator, executor/undo, organize-repair
```

## Known limitations

- A move can still fail mid-run due to an OS-level file lock (antivirus,
  search indexing, an editor's file watcher). This is handled safely
  (rolled back, reported clearly) but can't be prevented in advance.
- `undo` only reverses the single most recent organize run — it's a pop,
  not a full history browser.
- Only one folder can be RAG-indexed at a time; indexing a new one replaces
  the last.
- `organize` only ever considers items that are direct children of the
  Desktop — it doesn't reach inside existing project folders.
