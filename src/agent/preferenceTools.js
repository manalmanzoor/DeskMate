import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { addPreference, listPreferenceRules } from "../memory/preferences.js";

// These plug into the same hand-written agent loop as the read-only file
// tools (see loop.js) — no separate "extract a rule" LLM call is needed.
// The chat model already decides when a message states a rule, same as it
// decides when to call search_files; it just calls save_preference instead.
export const preferenceTools = [
  tool(
    async ({ rule, protectFolderName }) => {
      await addPreference({ rule, protectFolderName });
      return `Saved: "${rule}"${
        protectFolderName ? ` (folder "${protectFolderName}" is now protected)` : ""
      }`;
    },
    {
      name: "save_preference",
      description:
        "Save a standing rule the user states about how their Desktop should be organized " +
        "(e.g. 'always put screenshots in Screenshots', 'never touch my K-dramas folder'). " +
        "Call this whenever the user states such a rule in plain language.",
      schema: z.object({
        rule: z.string().describe("The rule restated clearly and concisely."),
        protectFolderName: z
          .string()
          .optional()
          .describe(
            "If the rule says to never touch/move a specific named folder on the Desktop, " +
              "give just that folder's name here so it gets permanently protected. Omit for " +
              "rules that are just organizing/categorization preferences."
          ),
      }),
    }
  ),

  tool(
    async () => {
      const rules = await listPreferenceRules();
      return rules.length
        ? rules.map((r, i) => `${i + 1}. ${r}`).join("\n")
        : "No rules saved yet.";
    },
    {
      name: "list_preferences",
      description: "List every standing rule/preference the user has previously saved.",
      schema: z.object({}),
    }
  ),
];
