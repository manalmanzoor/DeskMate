import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let tempDir;
let DESKTOP_PATH;
let executePlan;
let undoLastRun;
let readJournal;

before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "deskmate-executor-test-"));
  process.env.DESKMATE_DESKTOP_PATH = tempDir;
  process.env.DESKMATE_DATA_DIR = path.join(tempDir, ".deskmate-data");

  ({ DESKTOP_PATH } = await import("../src/config.js"));
  ({ executePlan } = await import("../src/safety/executor.js"));
  ({ undoLastRun } = await import("../src/safety/undo.js"));
  ({ readJournal } = await import("../src/safety/journal.js"));
});

after(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

async function exists(p) {
  return fs.access(p).then(() => true).catch(() => false);
}

test("organize moves files into category folders, then undo restores everything exactly", async () => {
  const a = path.join(DESKTOP_PATH, "a.txt");
  const b = path.join(DESKTOP_PATH, "b.png");
  const secret = path.join(DESKTOP_PATH, "Secrets");
  const secretFile = path.join(secret, "diary.txt");

  await fs.writeFile(a, "hello a");
  await fs.writeFile(b, "hello b");
  await fs.mkdir(secret);
  await fs.writeFile(secretFile, "shh");

  const moves = [
    { from: a, to: path.join(DESKTOP_PATH, "Docs", "a.txt"), category: "Docs" },
    { from: b, to: path.join(DESKTOP_PATH, "Images", "b.png"), category: "Images" },
  ];

  const run = await executePlan(moves);
  assert.equal(run.moves.length, 2);

  // Files landed in the right categories.
  assert.equal(await exists(path.join(DESKTOP_PATH, "Docs", "a.txt")), true);
  assert.equal(await exists(path.join(DESKTOP_PATH, "Images", "b.png")), true);
  assert.equal(await exists(a), false);
  assert.equal(await exists(b), false);

  // Protected/untouched folder was never part of the plan — still exactly as it was.
  assert.equal(await exists(secretFile), true);
  assert.equal(await fs.readFile(secretFile, "utf-8"), "shh");

  // Journal recorded the run.
  const journalAfterRun = await readJournal();
  assert.equal(journalAfterRun.length, 1);

  // Undo restores everything, byte for byte, and clears the journal entry.
  const undoResult = await undoLastRun();
  assert.equal(undoResult.undone, true);
  assert.equal(await exists(a), true);
  assert.equal(await exists(b), true);
  assert.equal(await fs.readFile(a, "utf-8"), "hello a");
  assert.equal(await fs.readFile(b, "utf-8"), "hello b");
  assert.equal(await exists(path.join(DESKTOP_PATH, "Docs", "a.txt")), false);

  const journalAfterUndo = await readJournal();
  assert.equal(journalAfterUndo.length, 0);
});

test("a mid-run failure rolls back completed moves and removes empty folders it created", async () => {
  const real = path.join(DESKTOP_PATH, "real.txt");
  await fs.writeFile(real, "still here");

  const categoryX = path.join(DESKTOP_PATH, "CategoryX");
  const categoryY = path.join(DESKTOP_PATH, "CategoryY");
  const nonexistent = path.join(DESKTOP_PATH, "this-file-does-not-exist.txt");

  const moves = [
    { from: real, to: path.join(categoryX, "real.txt"), category: "X" },
    { from: nonexistent, to: path.join(categoryY, "whatever.txt"), category: "Y" }, // fails: source missing
  ];

  await assert.rejects(() => executePlan(moves));

  // Rolled back: the real file is back where it started.
  assert.equal(await exists(real), true);

  // Cleaned up: both category folders (one used, one just created) are gone,
  // not left behind as empty clutter.
  assert.equal(await exists(categoryX), false);
  assert.equal(await exists(categoryY), false);

  // A failed run must never be recorded as if it succeeded.
  const journal = await readJournal();
  assert.equal(journal.length, 0);
});

test("undo with nothing to undo reports that clearly instead of erroring", async () => {
  const result = await undoLastRun();
  assert.equal(result.undone, false);
  assert.match(result.reason, /Nothing to undo/);
});
