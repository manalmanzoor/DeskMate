import { SystemMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { scan_folder } from "../tools/fileTools.js";
import { DESKTOP_PATH, PROTECTED_FOLDERS } from "../config.js";
import { ProposePlanSchema } from "../plan/schema.js";
import { validatePlan } from "../plan/validator.js";
import { listPreferenceRules, listProtectedFolderPaths } from "../memory/preferences.js";

// The LLM is forced (via tool_choice) to respond by calling this one tool,
// so its output is always structured JSON matching MoveSchema — never
// free-form text we'd have to hope was parseable.
const proposePlanTool = tool(async (args) => JSON.stringify(args), {
  name: "propose_plan",
  description: "Propose the full set of file moves to organize the Desktop.",
  schema: ProposePlanSchema,
});

const MAX_ATTEMPTS = 3;

// Asks the LLM to group the Desktop's top-level items into a Plan, then
// validates it with our own deterministic code (validatePlan). If the
// output is malformed OR fails validation, we send the concrete problem
// back to the model and let it try again — up to MAX_ATTEMPTS total.
//
// Returns { moves, errors }. `errors` is only non-empty if every attempt
// failed — in that case `moves` is empty and nothing should be executed.
export async function proposeOrganizePlan(model) {
  const listing = await scan_folder(DESKTOP_PATH);
  const itemLines = listing.items.map((i) => `- ${i.name} (${i.type})`).join("\n");

  const rules = await listPreferenceRules();
  const extraProtected = await listProtectedFolderPaths();
  const allProtected = [...PROTECTED_FOLDERS, ...extraProtected];

  const rulesText = rules.length
    ? `\n\nThe user has stated these standing rules — you must follow them:\n${rules
        .map((r) => `- ${r}`)
        .join("\n")}`
    : "";

  const systemText =
    `You are organizing the user's Desktop (${DESKTOP_PATH}). Group the items ` +
    "listed below into sensible categories BY MEANING (e.g. Uni Work, " +
    "Screenshots, Installers, Code, Docs) — not just by file extension. " +
    "For every item that should move, call propose_plan with one entry per " +
    "item: 'from' must be exactly the item's name prefixed with the Desktop " +
    `path (${DESKTOP_PATH}), 'to' must be a path inside a new or existing ` +
    "category subfolder of the Desktop, and 'category' is that category's name. " +
    "Leave out items that are already well-organized. Never propose moving " +
    `anything into or out of these protected paths: ${allProtected.join(", ")}.` +
    rulesText;

  const messages = [
    new SystemMessage(systemText),
    new HumanMessage(`Current top-level items on the Desktop:\n${itemLines}`),
  ];

  const modelWithTool = model.bindTools([proposePlanTool], {
    tool_choice: "propose_plan",
  });

  let lastErrors = ["Model never produced a plan."];

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const response = await modelWithTool.invoke(messages);
    messages.push(response);

    const call = (response.tool_calls ?? [])[0];
    if (!call) {
      lastErrors = ["Model did not call propose_plan."];
      messages.push(new HumanMessage("You must call the propose_plan tool. Try again."));
      continue;
    }

    const parsed = ProposePlanSchema.safeParse(call.args);
    if (!parsed.success) {
      lastErrors = [`Malformed plan: ${parsed.error.message}`];
      messages.push(
        new ToolMessage({
          content: `Your arguments didn't match the schema: ${parsed.error.message}. Call propose_plan again with corrected arguments.`,
          tool_call_id: call.id,
        })
      );
      continue;
    }

    const { valid, errors } = validatePlan(parsed.data.moves, extraProtected);
    if (valid) {
      return { moves: parsed.data.moves, errors: [] };
    }

    lastErrors = errors;
    messages.push(
      new ToolMessage({
        content:
          `That plan has problems:\n${errors.join("\n")}\n` +
          "Call propose_plan again, avoiding these issues.",
        tool_call_id: call.id,
      })
    );
  }

  return { moves: [], errors: lastErrors };
}
