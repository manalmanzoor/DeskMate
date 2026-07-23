import { z } from "zod";

// The typed shape the LLM's output must match. This is the contract between
// the AI (which only ever produces this JSON) and everything downstream
// (validator, preview, executor) which only ever consumes it.
export const MoveSchema = z.object({
  from: z.string().describe("Absolute path of an existing top-level Desktop item."),
  to: z.string().describe("Absolute destination path inside a category subfolder of the Desktop."),
  category: z.string().describe("Category name this item was grouped into, e.g. 'Screenshots'."),
});

export const ProposePlanSchema = z.object({
  moves: z.array(MoveSchema),
});
