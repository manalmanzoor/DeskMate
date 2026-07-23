import "dotenv/config";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createSession, sendChatMessage } from "./src/agent/session.js";
import { runOrganize, formatPreview } from "./src/safety/runOrganize.js";
import { undoLastRun } from "./src/safety/undo.js";
import { buildDeskReport } from "./src/agent/deskReport.js";

async function handleOrganize(model, rl) {
  const confirm = async (moves) => {
    console.log(`\nHere's the plan:${formatPreview(moves)}\n`);
    const answer = await rl.question("Proceed? (yes/no) > ");
    return answer.trim().toLowerCase().startsWith("y");
  };

  try {
    const result = await runOrganize(model, { confirm });

    switch (result.status) {
      case "invalid":
        console.log(`\nI couldn't come up with a safe plan:\n${result.errors.join("\n")}\n`);
        break;
      case "nothing-to-do":
        console.log("\nYour Desktop already looks organized — nothing to move.\n");
        break;
      case "cancelled":
        console.log("\nCancelled — nothing was changed.\n");
        break;
      case "done":
        console.log(buildDeskReport(result.run));
        break;
    }
  } catch (err) {
    // A move can fail mid-run (Windows file lock from antivirus/indexing/an
    // open handle, permissions, etc). executePlan already rolled back
    // everything it had moved and cleaned up any folders it created, so
    // nothing was left half-changed — but we must not let this crash the
    // whole session over one bad move.
    console.log(
      `\nOrganize failed partway through and was rolled back — nothing was changed.\n` +
      `Reason: ${err.message}\n` +
      "(This is usually Windows blocking a move because something else has that " +
      "file/folder open — try closing any program using it and run 'organize' again.)\n"
    );
  }
}

async function handleUndo() {
  const result = await undoLastRun();
  if (!result.undone) {
    console.log(`\n${result.reason}\n`);
  } else {
    console.log(`\nUndone — moved ${result.run.moves.length} item(s) back to where they were.\n`);
  }
}

async function main() {
  const session = createSession();

  const rl = readline.createInterface({ input: stdin, output: stdout });

  console.log(
    "DeskMate — chat, ask about files, state rules to remember, " +
    "'index <folder>' + ask about it, 'organize my Desktop', 'undo'. Type 'exit' to quit.\n"
  );

  while (true) {
    let userInput;
    try {
      userInput = await rl.question("you> ");
    } catch {
      break; // stdin closed (e.g. Ctrl+D or piped input ran out) — exit quietly
    }
    const normalized = userInput.trim().toLowerCase();
    if (normalized === "exit") break;

    try {
      if (normalized.startsWith("organize")) {
        await handleOrganize(session.model, rl);
        continue;
      }
      if (normalized === "undo") {
        await handleUndo();
        continue;
      }

      const reply = await sendChatMessage(session, userInput);

      console.log(`deskmate> ${reply}\n`);
    } catch (err) {
      // Defense in depth: no single turn (chat, organize, or undo) should be
      // able to take down the whole session.
      console.log(`\nSomething went wrong this turn: ${err.message}\n`);
    }
  }

  rl.close();
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
