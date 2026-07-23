import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  scan_folder,
  file_stats,
  search_files,
  recent_files,
} from "../tools/fileTools.js";
import { DESKTOP_PATH } from "../config.js";

// Each entry here pairs a Zod input schema (what the LLM must fill in to
// call the tool) with the real read-only function that does the work.
// This is the ONLY set of tools the LLM can call in Phase 2 — none of them
// can write, move, or delete anything.

export const fileTools = [
  tool(
    async ({ folderPath }) => JSON.stringify(await scan_folder(folderPath)),
    {
      name: "scan_folder",
      description:
        "List the immediate contents (files and subfolders) of a folder. " +
        `Defaults to the Desktop (${DESKTOP_PATH}) if no path is given.`,
      schema: z.object({
        folderPath: z
          .string()
          .optional()
          .describe("Absolute folder path. Omit to use the Desktop."),
      }),
    }
  ),

  tool(async ({ targetPath }) => JSON.stringify(await file_stats(targetPath)), {
    name: "file_stats",
    description: "Get size, created/modified dates for one specific file or folder.",
    schema: z.object({
      targetPath: z.string().describe("Absolute path to a file or folder."),
    }),
  }),

  tool(
    async ({ nameOrKeyword, folderPath }) =>
      JSON.stringify(await search_files(nameOrKeyword, folderPath)),
    {
      name: "search_files",
      description:
        "Recursively search a folder tree for files whose name contains a keyword " +
        `(case-insensitive). Defaults to searching the Desktop (${DESKTOP_PATH}).`,
      schema: z.object({
        nameOrKeyword: z.string().describe("Keyword to look for in file names."),
        folderPath: z
          .string()
          .optional()
          .describe("Absolute folder path to search under. Omit to use the Desktop."),
      }),
    }
  ),

  tool(
    async ({ days, folderPath }) =>
      JSON.stringify(await recent_files(days, folderPath)),
    {
      name: "recent_files",
      description:
        "Recursively list files modified within the last N days. " +
        `Defaults to the Desktop (${DESKTOP_PATH}).`,
      schema: z.object({
        days: z.number().optional().describe("How many days back to look. Defaults to 7."),
        folderPath: z
          .string()
          .optional()
          .describe("Absolute folder path to search under. Omit to use the Desktop."),
      }),
    }
  ),
];
