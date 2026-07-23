import fs from "node:fs/promises";
import path from "node:path";
import { DESKTOP_PATH } from "../config.js";

// All four functions here are READ-ONLY: they never write, move, or delete
// anything. That's what makes Phase 2 safe to wire up to the LLM before any
// safety/undo machinery exists.

const MAX_DEPTH = 6; // guard against runaway recursion into huge trees
const MAX_RESULTS = 200; // guard against flooding the LLM's context

// Real desktops have project folders full of dependency/build output that
// swamp search results with noise the user never asked about.
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "venv",
  ".venv",
  "__pycache__",
  "dist",
  "build",
  ".next",
]);

async function walk(rootPath, depth = 0, visit) {
  if (depth > MAX_DEPTH) return;

  let entries;
  try {
    entries = await fs.readdir(rootPath, { withFileTypes: true });
  } catch {
    return; // unreadable folder (permissions, junction, etc.) — just skip it
  }

  for (const entry of entries) {
    if (entry.isDirectory() && SKIP_DIR_NAMES.has(entry.name)) continue;

    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      await visit(fullPath, entry, depth);
      await walk(fullPath, depth + 1, visit);
    } else {
      await visit(fullPath, entry, depth);
    }
  }
}

// List the immediate contents of a folder (not recursive).
export async function scan_folder(folderPath = DESKTOP_PATH) {
  const entries = await fs.readdir(folderPath, { withFileTypes: true });

  const items = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(folderPath, entry.name);
      if (entry.isDirectory()) {
        return { name: entry.name, type: "folder" };
      }
      const stats = await fs.stat(fullPath);
      return {
        name: entry.name,
        type: "file",
        extension: path.extname(entry.name),
        sizeBytes: stats.size,
      };
    })
  );

  return { folder: folderPath, items };
}

// Get metadata about one specific file or folder.
export async function file_stats(targetPath) {
  const stats = await fs.stat(targetPath);
  return {
    path: targetPath,
    isDirectory: stats.isDirectory(),
    sizeBytes: stats.size,
    createdAt: stats.birthtime.toISOString(),
    modifiedAt: stats.mtime.toISOString(),
  };
}

// Recursively search a folder tree for files whose name contains a keyword
// (case-insensitive). Returns at most MAX_RESULTS matches.
export async function search_files(nameOrKeyword, folderPath = DESKTOP_PATH) {
  const keyword = nameOrKeyword.toLowerCase();
  const matches = [];

  await walk(folderPath, 0, async (fullPath, entry) => {
    if (matches.length >= MAX_RESULTS) return;
    if (entry.isDirectory()) return;
    if (entry.name.toLowerCase().includes(keyword)) {
      matches.push(fullPath);
    }
  });

  return { keyword: nameOrKeyword, folder: folderPath, matches };
}

// Recursively list files modified within the last N days.
export async function recent_files(days = 7, folderPath = DESKTOP_PATH) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const results = [];

  await walk(folderPath, 0, async (fullPath, entry) => {
    if (results.length >= MAX_RESULTS) return;
    if (entry.isDirectory()) return;
    let stats;
    try {
      stats = await fs.stat(fullPath);
    } catch {
      return;
    }
    if (stats.mtimeMs >= cutoff) {
      results.push({ path: fullPath, modifiedAt: stats.mtime.toISOString() });
    }
  });

  results.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
  return { days, folder: folderPath, files: results };
}
