import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { handleHook } from "./hook-handler.js";
import { processQueue } from "./processing.js";
import { search } from "./search.js";
import { projectId } from "./vault.js";

async function fixture(): Promise<{ root: string; cwd: string; project: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-hook-vault-"));
  const cwd = await mkdtemp(path.join(os.tmpdir(), "continuity-hook-project-"));
  return { root, cwd, project: await projectId(cwd) };
}

test("captures user and assistant turn from shared hook fields", async () => {
  const { root, cwd, project } = await fixture();
  const user = await handleHook(root, { hook_event_name: "UserPromptSubmit", session_id: "s1", turn_id: "t1", cwd, prompt: "记一下：暂时不做 MCP" }, "codex");
  const assistant = await handleHook(root, { hook_event_name: "Stop", session_id: "s1", turn_id: "t1", cwd, last_assistant_message: "已记录，先验证文件方案。" }, "codex");
  assert.ok(user.captured);
  assert.ok(assistant.captured);
  await processQueue(root);
  const hits = await search(root, { projectId: project, query: "不做 MCP" });
  assert.equal(hits[0]?.confidence, 1);
});

test("honors opt-out, marks secrets, and tolerates startup", async () => {
  const { root, cwd, project } = await fixture();
  const skipped = await handleHook(root, { hook_event_name: "UserPromptSubmit", session_id: "s1", cwd, prompt: "这个不要保存" }, "claude-code");
  assert.equal(skipped.skipped, "user_opt_out");
  await handleHook(root, { hook_event_name: "UserPromptSubmit", session_id: "s1", cwd, prompt: "API_KEY=top-secret" }, "claude-code");
  await processQueue(root);
  assert.equal((await search(root, { projectId: project, query: "top-secret", includeRaw: true })).length, 0);
  const startup = await handleHook(root, { hook_event_name: "SessionStart", session_id: "s1", cwd }, "claude-code");
  assert.equal(startup.processed, 0);
  assert.match(JSON.stringify(startup.output), /evidence/);
});
