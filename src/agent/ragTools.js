import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { indexFolder, queryNotes, getIndexedFolder } from "../rag/store.js";

export const ragTools = [
  tool(
    async ({ folderPath }) => {
      const result = await indexFolder(folderPath);
      return (
        `Indexed ${result.fileCount} file(s) from "${result.folder}" into ` +
        `${result.chunkCount} chunks. You can now ask questions about them.`
      );
    },
    {
      name: "index_folder",
      description:
        "Index a folder's .txt/.md/.pdf files into a local vector store so questions can be asked " +
        "about their contents. Call this when the user asks to 'index' a folder (e.g. 'index my " +
        "SE-notes folder'). Resolve the folder name to its full absolute path first (e.g. by calling " +
        "scan_folder on the Desktop) before calling this.",
      schema: z.object({
        folderPath: z.string().describe("Absolute path to the folder to index."),
      }),
    }
  ),

  tool(
    async ({ query }) => {
      if (!getIndexedFolder()) {
        return "No folder has been indexed yet. Ask me to index a folder first.";
      }
      const results = await queryNotes(query);
      if (results.length === 0) return "No relevant content found in the indexed documents.";
      return results.map((r, i) => `${i + 1}. [${r.source}] ${r.content}`).join("\n\n");
    },
    {
      name: "search_notes",
      description:
        "Search the currently indexed documents for content relevant to a question. Always cite " +
        "the source filename (shown in brackets in the results) when answering from these.",
      schema: z.object({
        query: z.string().describe("The question or topic to search the indexed documents for."),
      }),
    }
  ),
];
