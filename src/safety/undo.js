import fs from "node:fs/promises";
import path from "node:path";
import { readJournal, writeJournal } from "./journal.js";

// Reverses the most recent organize run by moving every file back to where
// it came from, then removes that run from the journal. No file is ever
// deleted — undo is just move_file run in reverse.
export async function undoLastRun() {
  const journal = await readJournal();
  if (journal.length === 0) {
    return { undone: false, reason: "Nothing to undo." };
  }

  const lastRun = journal[journal.length - 1];

  for (const move of [...lastRun.moves].reverse()) {
    await fs.mkdir(path.dirname(move.from), { recursive: true });
    await fs.rename(move.to, move.from);
  }

  journal.pop();
  await writeJournal(journal);

  return { undone: true, run: lastRun };
}
