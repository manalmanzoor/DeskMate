import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Confirmed by inspecting the actual filesystem (not OneDrive-redirected):
// C:\Users\<you>\Desktop
// Overridable via DESKMATE_DESKTOP_PATH so the test harness can point this
// at a throwaway temp folder instead of a real Desktop.
export const DESKTOP_PATH = process.env.DESKMATE_DESKTOP_PATH
  ? path.resolve(process.env.DESKMATE_DESKTOP_PATH)
  : path.join(os.homedir(), "Desktop");

// This file lives at <project>/src/config.js, so its own folder's parent is
// the project root — used to store DeskMate's own data outside the Desktop
// tree it organizes, regardless of which directory `npm start` is run from.
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Also overridable, so tests never read/write the real journal or preferences.
export const DATA_DIR = process.env.DESKMATE_DATA_DIR
  ? path.resolve(process.env.DESKMATE_DATA_DIR)
  : path.join(PROJECT_ROOT, "data");

export const JOURNAL_PATH = path.join(DATA_DIR, "undo-journal.json");
export const PREFERENCES_PATH = path.join(DATA_DIR, "preferences.json");

// Folders that organize() must never move, or move anything out of.
// The project's own folder is included by default since it can live on the
// Desktop itself (as it does here) — we never want to reorganize ourselves.
export const PROTECTED_FOLDERS = [PROJECT_ROOT];
