import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// process.env must be set BEFORE config.js is ever imported in this process,
// so every config-dependent module below is loaded dynamically (not with a
// static top-of-file import) — static imports are hoisted and would run
// before this setup code has a chance to point DESKTOP_PATH at a temp dir.
let tempDir;
let DESKTOP_PATH;
let validatePlan;

before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "deskmate-validator-test-"));
  process.env.DESKMATE_DESKTOP_PATH = tempDir;
  process.env.DESKMATE_DATA_DIR = path.join(tempDir, ".deskmate-data");

  ({ DESKTOP_PATH } = await import("../src/config.js"));
  ({ validatePlan } = await import("../src/plan/validator.js"));

  await fs.writeFile(path.join(DESKTOP_PATH, "photo.png"), "fake image bytes");
  await fs.writeFile(path.join(DESKTOP_PATH, "existing-destination.txt"), "already here");
  await fs.mkdir(path.join(DESKTOP_PATH, "Secrets"));
  await fs.writeFile(path.join(DESKTOP_PATH, "Secrets", "diary.txt"), "shh");
});

after(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

test("a valid, in-scope move passes", () => {
  const { valid, errors } = validatePlan([
    { from: path.join(DESKTOP_PATH, "photo.png"), to: path.join(DESKTOP_PATH, "Images", "photo.png"), category: "Images" },
  ]);
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});

test("rejects a source that isn't a direct child of the Desktop", () => {
  const nested = path.join(DESKTOP_PATH, "Secrets", "diary.txt");
  const { valid, errors } = validatePlan([
    { from: nested, to: path.join(DESKTOP_PATH, "Docs", "diary.txt"), category: "Docs" },
  ]);
  assert.equal(valid, false);
  assert.match(errors[0], /Out of scope/);
});

test("rejects a destination outside the Desktop", () => {
  const { valid, errors } = validatePlan([
    { from: path.join(DESKTOP_PATH, "photo.png"), to: path.join(os.tmpdir(), "photo.png"), category: "Images" },
  ]);
  assert.equal(valid, false);
  assert.match(errors[0], /Out of scope/);
});

test("rejects a plan that touches an explicitly protected folder", () => {
  const protectedPath = path.join(DESKTOP_PATH, "Secrets");
  const { valid, errors } = validatePlan(
    [{ from: protectedPath, to: path.join(DESKTOP_PATH, "Archive", "Secrets"), category: "Archive" }],
    [protectedPath]
  );
  assert.equal(valid, false);
  assert.match(errors[0], /Protected/);
});

test("rejects a source file that doesn't actually exist", () => {
  const { valid, errors } = validatePlan([
    { from: path.join(DESKTOP_PATH, "ghost.txt"), to: path.join(DESKTOP_PATH, "Docs", "ghost.txt"), category: "Docs" },
  ]);
  assert.equal(valid, false);
  assert.match(errors[0], /Missing source/);
});

test("rejects a no-op move (from === to)", () => {
  const samePath = path.join(DESKTOP_PATH, "photo.png");
  const { valid, errors } = validatePlan([{ from: samePath, to: samePath, category: "Images" }]);
  assert.equal(valid, false);
  assert.match(errors[0], /No-op/);
});

test("rejects a destination that already exists on disk", () => {
  const { valid, errors } = validatePlan([
    {
      from: path.join(DESKTOP_PATH, "photo.png"),
      to: path.join(DESKTOP_PATH, "existing-destination.txt"),
      category: "Images",
    },
  ]);
  assert.equal(valid, false);
  assert.match(errors[0], /Collision/);
});

test("rejects two different items proposed to land at the same destination", async () => {
  await fs.writeFile(path.join(DESKTOP_PATH, "second.png"), "more fake bytes");
  const dest = path.join(DESKTOP_PATH, "Images", "merged.png");
  const { valid, errors } = validatePlan([
    { from: path.join(DESKTOP_PATH, "photo.png"), to: dest, category: "Images" },
    { from: path.join(DESKTOP_PATH, "second.png"), to: dest, category: "Images" },
  ]);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => /Collision/.test(e)));
});
