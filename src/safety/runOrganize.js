import { proposeOrganizePlan } from "../agent/organize.js";
import { executePlan } from "./executor.js";

// Plain-text rendering of a plan, grouped by category — used by the
// terminal face. Exported so index.js can format it itself; the engine
// hands back structured `moves`, each face decides how to display them.
export function formatPreview(moves) {
  const byCategory = new Map();
  for (const move of moves) {
    const list = byCategory.get(move.category) ?? [];
    list.push(move);
    byCategory.set(move.category, list);
  }

  const lines = [];
  for (const [category, items] of byCategory) {
    lines.push(`\n${category} (${items.length}):`);
    for (const item of items) {
      lines.push(`  ${item.from} -> ${item.to}`);
    }
  }
  return lines.join("\n");
}

// Runs the full stage 2-5 pipeline from the architecture: Agent (LLM
// proposes, the plan is already validated inside proposeOrganizePlan) ->
// Preview + Confirm -> Executor + Journal.
//
// `confirm(moves)` must return a boolean (or Promise<boolean>) — real usage
// wires it to a readline prompt (terminal) or a preview card with Yes/Cancel
// buttons (Electron); tests can pass an auto-yes/auto-no stub with no UI
// involved. Passing the raw `moves` (not pre-rendered text) is what lets
// each face render its own nicer preview without any file logic living in
// the UI layer.
export async function runOrganize(model, { confirm }) {
  const { moves, errors } = await proposeOrganizePlan(model);

  if (errors.length > 0) {
    return { status: "invalid", errors };
  }

  if (moves.length === 0) {
    return { status: "nothing-to-do" };
  }

  const approved = await confirm(moves);
  if (!approved) {
    return { status: "cancelled", moves };
  }

  const run = await executePlan(moves);
  return { status: "done", run };
}
