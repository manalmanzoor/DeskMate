import path from "node:path";
import fs from "node:fs";
import { DESKTOP_PATH, PROTECTED_FOLDERS } from "../config.js";

// Pure, deterministic checks on a proposed plan. No LLM involved past this
// point — this function decides whether the plan is even allowed to run.
// Returns { valid, errors } and never touches the disk beyond read-only
// existence checks.
export function validatePlan(moves, extraProtectedFolders = []) {
  const errors = [];
  const destinationCounts = new Map();
  const allProtected = [...PROTECTED_FOLDERS, ...extraProtectedFolders];

  for (const move of moves) {
    const from = path.resolve(move.from);
    const to = path.resolve(move.to);

    // Scope: organize only ever touches items sitting directly on the
    // Desktop, never something nested inside a project folder etc.
    if (path.dirname(from) !== DESKTOP_PATH) {
      errors.push(`Out of scope: "${from}" is not a top-level Desktop item.`);
      continue;
    }
    if (to !== DESKTOP_PATH && !to.startsWith(DESKTOP_PATH + path.sep)) {
      errors.push(`Out of scope: destination "${to}" is outside the Desktop.`);
      continue;
    }

    // Protected folders — never move these, and never move anything INTO
    // them either (both cases would count as tampering with a protected path).
    const touchesProtected = allProtected.some(
      (p) => from === p || from.startsWith(p + path.sep) || to === p || to.startsWith(p + path.sep)
    );
    if (touchesProtected) {
      errors.push(`Protected: "${from}" involves a protected folder and cannot be moved.`);
      continue;
    }

    // The source must actually exist — catches a hallucinated filename that
    // was never really in the folder listing.
    if (!fs.existsSync(from)) {
      errors.push(`Missing source: "${from}" does not exist.`);
      continue;
    }

    if (from === to) {
      errors.push(`No-op: "${from}" is already at its destination.`);
      continue;
    }

    // Collision: destination path already occupied by something else on disk.
    if (fs.existsSync(to)) {
      errors.push(`Collision: destination "${to}" already exists.`);
    }

    // Collision: two different items both proposed to land at the same path.
    const count = (destinationCounts.get(to) ?? 0) + 1;
    destinationCounts.set(to, count);
    if (count > 1) {
      errors.push(`Collision: multiple items would move to "${to}".`);
    }
  }

  return { valid: errors.length === 0, errors };
}
