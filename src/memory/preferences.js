import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, PREFERENCES_PATH, DESKTOP_PATH } from "../config.js";

// Preferences persist as a flat JSON array on disk so they survive restarts.
// Each entry is { rule, protectFolderName, createdAt }. `protectFolderName`
// is only set for rules that name a specific folder to never touch — that's
// the one case that needs to become a deterministic, enforced guarantee
// rather than just something we hope the LLM remembers to respect.

export async function loadPreferences() {
  try {
    const raw = await fs.readFile(PREFERENCES_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function savePreferencesFile(prefs) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(PREFERENCES_PATH, JSON.stringify(prefs, null, 2), "utf-8");
}

export async function addPreference({ rule, protectFolderName }) {
  const prefs = await loadPreferences();
  prefs.push({
    rule,
    protectFolderName: protectFolderName || null,
    createdAt: new Date().toISOString(),
  });
  await savePreferencesFile(prefs);
  return prefs;
}

export async function listPreferenceRules() {
  const prefs = await loadPreferences();
  return prefs.map((p) => p.rule);
}

// Absolute paths for every folder a saved rule has asked to protect. These
// get merged into the validator's protected-folder check, in addition to
// just being mentioned in the LLM's prompt.
export async function listProtectedFolderPaths() {
  const prefs = await loadPreferences();
  return prefs
    .filter((p) => p.protectFolderName)
    .map((p) => path.join(DESKTOP_PATH, p.protectFolderName));
}
