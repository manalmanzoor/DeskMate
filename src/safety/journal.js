import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, JOURNAL_PATH } from "../config.js";

// The journal is just a JSON file: an array of past organize "runs", each
// one holding the exact moves that were applied so they can be reversed.
// [{ timestamp, moves: [{ from, to }] }, ...]

export async function readJournal() {
  try {
    const raw = await fs.readFile(JOURNAL_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

export async function writeJournal(journal) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(JOURNAL_PATH, JSON.stringify(journal, null, 2), "utf-8");
}

export async function appendJournalRun(run) {
  const journal = await readJournal();
  journal.push(run);
  await writeJournal(journal);
}
