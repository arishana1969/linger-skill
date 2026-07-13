import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { handleHook } from "./hook-handler.js";
import { vaultPaths } from "./paths.js";
import { listJsonFiles } from "./vault.js";

test("hook redacts high-confidence secret before raw persistence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-hook-secret-"));
  const cwd = await mkdtemp(path.join(os.tmpdir(), "linger-hook-project-"));
  await handleHook(root, { hook_event_name: "UserPromptSubmit", session_id: "s", turn_id: "t", cwd, prompt: "password=correct-horse-battery-staple" }, "codex");
  const files = await listJsonFiles(vaultPaths(root).raw);
  const raw = await readFile(files[0]!, "utf8");
  assert.doesNotMatch(raw, /correct-horse/);
  assert.match(raw, /REDACTED/);
  assert.match(raw, /"sensitivity": "secret"/);
});

test("hook classifies contact data as sensitive without destructive redaction", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-hook-secret-"));
  const cwd = await mkdtemp(path.join(os.tmpdir(), "linger-hook-project-"));
  await handleHook(root, { hook_event_name: "UserPromptSubmit", session_id: "s", turn_id: "t", cwd, prompt: "contact person@example.com" }, "claude-code");
  const raw = await readFile((await listJsonFiles(vaultPaths(root).raw))[0]!, "utf8");
  assert.match(raw, /person@example.com/);
  assert.match(raw, /"sensitivity": "sensitive"/);
});
