import fs from "node:fs/promises";
import path from "node:path";
import { appendJournalRun } from "./journal.js";

// Only two low-level file operations exist in this whole codebase: creating
// a folder and moving a file/folder. There is deliberately no delete
// function anywhere — undo is done by moving things back, never by erasing.

async function create_folder(folderPath) {
  // Returns the first path segment it had to create, or undefined if the
  // folder already existed — lets us tell "we made this" from "this was
  // already here" so rollback only cleans up what we actually created.
  return fs.mkdir(folderPath, { recursive: true });
}

async function move_file(from, to, createdFolders) {
  const firstCreated = await create_folder(path.dirname(to));
  if (firstCreated && createdFolders) createdFolders.push(firstCreated);
  await fs.rename(from, to);
}

// Recursively removes a directory ONLY if it (and everything under it) is
// empty. fs.rmdir refuses to remove a non-empty directory, so this can
// never delete real content — it just clears out empty scaffolding folders
// that a rolled-back run created and no longer needs.
async function removeIfEmptyRecursive(dirPath) {
  let entries;
  try {
    entries = await fs.readdir(dirPath);
  } catch {
    return; // not a directory, or already gone
  }
  for (const entry of entries) {
    await removeIfEmptyRecursive(path.join(dirPath, entry));
  }
  try {
    await fs.rmdir(dirPath);
  } catch {
    // not empty (contains real files) or already removed — leave it alone
  }
}

// Applies every move in a validated plan. If any single move fails partway
// through, everything already moved in this run is rolled back, and any
// folders this run created (and are now empty again) are cleaned up — so a
// failed organize leaves the Desktop exactly as it was before, never
// half-organized and never littered with empty category folders.
export async function executePlan(moves) {
  const completed = [];
  const createdFolders = [];

  try {
    for (const move of moves) {
      await move_file(move.from, move.to, createdFolders);
      completed.push({ from: move.from, to: move.to, category: move.category });
    }
  } catch (err) {
    for (const done of completed.reverse()) {
      try {
        await move_file(done.to, done.from);
      } catch {
        // best-effort rollback; original error is what we surface below
      }
    }
    for (const folder of createdFolders.reverse()) {
      await removeIfEmptyRecursive(folder);
    }
    throw err;
  }

  const run = { timestamp: new Date().toISOString(), moves: completed };
  await appendJournalRun(run);
  return run;
}
