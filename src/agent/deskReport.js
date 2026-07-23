// A small, warm summary printed after a successful organize. Deliberately
// tiny — the engineering (validator, transactional executor, undo journal)
// is the actual point; this is just a friendly receipt on top of it.
export function buildDeskReport(run) {
  const byCategory = new Map();
  for (const move of run.moves) {
    byCategory.set(move.category, (byCategory.get(move.category) ?? 0) + 1);
  }

  const categoryLines = [...byCategory.entries()]
    .map(([category, count]) => `  - ${category}: ${count} item${count === 1 ? "" : "s"}`)
    .join("\n");

  const categoryWord = byCategory.size === 1 ? "category" : "categories";

  return (
    `\nDesk Report\n` +
    `Moved ${run.moves.length} item${run.moves.length === 1 ? "" : "s"} into ${byCategory.size} ${categoryWord}:\n` +
    `${categoryLines}\n` +
    `Your Desktop looks better already. Say "undo" if you change your mind.\n`
  );
}
