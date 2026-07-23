import { ToolMessage } from "@langchain/core/messages";

// This is the hand-written tool-calling agent loop. LangChain's
// AgentExecutor would hide all of this behind one call — we write it out
// so every step is visible and explainable.
//
// The idea in plain words:
//   1. Send the conversation so far to the model.
//   2. If the model's reply asks to call one or more tools, actually run
//      those tools ourselves (the model never touches real code/files
//      directly — it only ever asks for a tool by name + arguments).
//   3. Feed each tool's result back into the conversation as a ToolMessage.
//   4. Send the updated conversation back to the model and repeat.
//   5. Stop as soon as the model replies with plain text and no tool calls
//      — that's the final answer.
//
// `modelWithTools` must already have tools bound via `.bindTools(tools)`.
// `tools` is the same array, used here to look up each tool by name so we
// can actually execute it.
export async function runAgentLoop(modelWithTools, tools, history) {
  const toolsByName = Object.fromEntries(tools.map((t) => [t.name, t]));

  const MAX_STEPS = 8; // safety cap so a confused model can't loop forever
  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await modelWithTools.invoke(history);
    history.push(response);

    const requestedCalls = response.tool_calls ?? [];
    if (requestedCalls.length === 0) {
      // No tool calls -> the model gave a final, plain-text answer.
      return response;
    }

    // The model may ask for several tools at once; run each one and report
    // its result back before letting the model continue.
    for (const call of requestedCalls) {
      const matchingTool = toolsByName[call.name];

      let resultText;
      if (!matchingTool) {
        resultText = `Error: no such tool "${call.name}"`;
      } else {
        try {
          // Groq sometimes sends `args: null` for a tool with an empty-object
          // schema (i.e. one that takes no arguments) instead of `{}`, which
          // fails Zod validation every single time and makes the model retry
          // forever. Normalize null/undefined args to {} before validating.
          resultText = await matchingTool.invoke(call.args ?? {});
        } catch (err) {
          resultText = `Error running ${call.name}: ${err.message}`;
        }
      }

      history.push(
        new ToolMessage({
          content: resultText,
          tool_call_id: call.id,
        })
      );
    }
    // Loop back around: the model now sees the tool results and either
    // asks for more tools or gives a final answer.
  }

  throw new Error("Agent loop exceeded MAX_STEPS without a final answer.");
}
