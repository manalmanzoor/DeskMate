import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { createChatModel } from "./chat.js";
import { fileTools } from "./tools.js";
import { preferenceTools } from "./preferenceTools.js";
import { ragTools } from "./ragTools.js";
import { runAgentLoop } from "./loop.js";
import { DESKTOP_PATH } from "../config.js";

// The shared engine entry point for general chat (read-only file questions,
// preferences, RAG). Both faces — the terminal (index.js) and the Electron
// app (electron/main.js) — call exactly this, so there is only ever one
// place that assembles the model, the tool list, and the system prompt.
// Organize/undo are handled separately (src/safety/runOrganize.js,
// src/safety/undo.js) since each face previews/confirms differently.

export const chatTools = [...fileTools, ...preferenceTools, ...ragTools];

const SYSTEM_PROMPT_TEXT =
  "You are DeskMate, a helpful local assistant. You can look at (but never " +
  `directly modify) the user's files using your read-only tools. Their Desktop ` +
  `is at ${DESKTOP_PATH}. When the user states a standing rule about how their ` +
  "files should be organized (e.g. 'always put screenshots in Screenshots', " +
  "'never touch my K-dramas folder'), call save_preference to remember it — " +
  "if it names a specific folder to never touch, fill in protectFolderName too. " +
  "When asked what rules you remember, call list_preferences. When the user asks " +
  "to 'index' a folder, resolve its full path (e.g. via scan_folder) and call " +
  "index_folder; when they ask a question that could be about indexed documents, " +
  "call search_notes and always cite the source filename in your answer. Actual " +
  "file moves only ever happen through the separate 'organize' command, never from chat.";

// A session bundles the model (with tools bound) and its growing message
// history — the same "just resend a growing array" memory used since Phase 1.
export function createSession() {
  const model = createChatModel();
  const modelWithTools = model.bindTools(chatTools);
  const history = [new SystemMessage(SYSTEM_PROMPT_TEXT)];
  return { model, modelWithTools, history };
}

export async function sendChatMessage(session, userInput) {
  session.history.push(new HumanMessage(userInput));
  const finalReply = await runAgentLoop(session.modelWithTools, chatTools, session.history);
  return finalReply.content;
}
