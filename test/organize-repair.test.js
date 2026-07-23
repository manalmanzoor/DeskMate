import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let tempDir;
let DESKTOP_PATH;
let proposeOrganizePlan;

before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "deskmate-organize-test-"));
  process.env.DESKMATE_DESKTOP_PATH = tempDir;
  process.env.DESKMATE_DATA_DIR = path.join(tempDir, ".deskmate-data");

  ({ DESKTOP_PATH } = await import("../src/config.js"));
  ({ proposeOrganizePlan } = await import("../src/agent/organize.js"));

  await fs.writeFile(path.join(DESKTOP_PATH, "notes.txt"), "some notes");
});

after(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

// A minimal stand-in for a LangChain chat model with tools bound. Each call
// to bindTools(...).invoke(...) returns the next scripted response, so we
// can deterministically test the retry-with-repair loop in organize.js
// without ever calling the real Groq API.
function makeScriptedModel(scriptedArgsSequence) {
  let callIndex = 0;
  return {
    bindTools() {
      return {
        invoke: async () => {
          const args = scriptedArgsSequence[callIndex];
          callIndex += 1;
          if (args === undefined) return { tool_calls: [] };
          return { tool_calls: [{ name: "propose_plan", args, id: `fake-call-${callIndex}` }] };
        },
      };
    },
  };
}

test("recovers from a malformed tool call by retrying", async () => {
  const model = makeScriptedModel([
    { moves: [{ from: path.join(DESKTOP_PATH, "notes.txt") }] }, // missing required 'to'/'category'
    {
      moves: [
        {
          from: path.join(DESKTOP_PATH, "notes.txt"),
          to: path.join(DESKTOP_PATH, "Docs", "notes.txt"),
          category: "Docs",
        },
      ],
    },
  ]);

  const { moves, errors } = await proposeOrganizePlan(model);
  assert.deepEqual(errors, []);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].category, "Docs");
});

test("recovers from a schema-valid but unsafe plan by retrying", async () => {
  const model = makeScriptedModel([
    {
      // Schema-valid JSON, but validatePlan will reject it: destination is
      // outside the Desktop entirely.
      moves: [
        {
          from: path.join(DESKTOP_PATH, "notes.txt"),
          to: path.join(os.tmpdir(), "notes.txt"),
          category: "Docs",
        },
      ],
    },
    {
      moves: [
        {
          from: path.join(DESKTOP_PATH, "notes.txt"),
          to: path.join(DESKTOP_PATH, "Docs", "notes.txt"),
          category: "Docs",
        },
      ],
    },
  ]);

  const { moves, errors } = await proposeOrganizePlan(model);
  assert.deepEqual(errors, []);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].to, path.join(DESKTOP_PATH, "Docs", "notes.txt"));
});

test("gives up after repeated bad plans and returns errors instead of a plan", async () => {
  const alwaysBroken = [
    { moves: [{ from: "not-even-a-real-path" }] },
    { moves: [{ from: "still-broken" }] },
    { moves: [{ from: "still-broken-again" }] },
  ];
  const model = makeScriptedModel(alwaysBroken);

  const { moves, errors } = await proposeOrganizePlan(model);
  assert.equal(moves.length, 0);
  assert.ok(errors.length > 0);
});
