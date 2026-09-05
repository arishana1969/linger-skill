import assert from "node:assert/strict";
import { access, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { handleHook } from "./hook-handler.js";
import { processQueue } from "./processing.js";
import { search } from "./search.js";
import { projectId } from "./vault.js";
import { sessionControlStatus, sessionControlToken } from "./session-control.js";

async function fixture(): Promise<{ root: string; cwd: string; project: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-hook-vault-"));
  const cwd = await mkdtemp(path.join(os.tmpdir(), "linger-hook-project-"));
  return { root, cwd, project: await projectId(cwd) };
}

test("captures user and assistant turn from shared hook fields", async () => {
  const { root, cwd, project } = await fixture();
  const user = await handleHook(root, { hook_event_name: "UserPromptSubmit", session_id: "s1", turn_id: "t1", cwd, prompt: "记一下：暂时不做 MCP" }, "codex", undefined, { node: "/trusted/node", cli: "/trusted/runtime/dist/cli.js", vault: root });
  const assistant = await handleHook(root, { hook_event_name: "Stop", session_id: "s1", turn_id: "t1", cwd, last_assistant_message: "已记录，先验证文件方案。" }, "codex");
  assert.ok(user.captured);
  assert.equal(user.processed, 1);
  assert.match(JSON.stringify(user.output), /already captured the current user event/);
  assert.match(JSON.stringify(user.output), /Treat the Linger save request as complete/);
  assert.match(JSON.stringify(user.output), /another Linger capture, process, decision-add, or correction/);
  assert.match(JSON.stringify(user.output), /Host-owned memory systems remain independent/);
  assert.doesNotMatch(JSON.stringify(user.output), /host-native auto-memory/);
  assert.match(JSON.stringify(user.output), /only permitted Linger follow-up write/);
  assert.match(JSON.stringify(user.output), /pending host enrichment/);
  assert.match(JSON.stringify(user.output), /Trusted Linger CLI locator/);
  assert.match(JSON.stringify(user.output), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.ok(assistant.captured);
  await processQueue(root);
  const hits = await search(root, { projectId: project, query: "不做 MCP" });
  assert.equal(hits[0]?.confidence, 0.6);
  assert.ok(hits[0]?.warning_flags.includes("partial_source"));
});

test("records a complete Codex live lifecycle only after both sides capture", async () => {
  const { root, cwd } = await fixture();
  const { verifiedCodexLifecycleSession } = await import("./lifecycle-evidence.js");
  const runtimeIdentity = "e".repeat(64);
  await handleHook(root, { hook_event_name: "SessionStart", session_id: "live-1", cwd, source: "startup" }, "codex", runtimeIdentity);
  await handleHook(root, { hook_event_name: "UserPromptSubmit", session_id: "live-1", turn_id: "turn-1", cwd, prompt: "remember live evidence" }, "codex", runtimeIdentity);
  assert.equal(await verifiedCodexLifecycleSession(root, [runtimeIdentity]), undefined);
  await handleHook(root, { hook_event_name: "Stop", session_id: "live-1", turn_id: "turn-1", cwd, last_assistant_message: "live evidence captured" }, "codex", runtimeIdentity);
  const completed = await verifiedCodexLifecycleSession(root, [runtimeIdentity]);
  assert.equal(completed?.session_id, "live-1");
});

test("runs event-driven processing at the 50KB threshold", async () => {
  const { root, cwd, project } = await fixture();
  const result = await handleHook(root, { hook_event_name: "UserPromptSubmit", session_id: "s1", turn_id: "large", cwd, prompt: `threshold-zephyr ${"x".repeat(52 * 1024)}` }, "codex");
  assert.equal(result.processed, 1);
  assert.match((await search(root, { projectId: project, query: "threshold-zephyr" }))[0]?.snippet ?? "", /threshold-zephyr/);
});

test("runs overdue work when a later hook event arrives", async () => {
  const { root, cwd, project } = await fixture();
  const { capture } = await import("./capture.js");
  await capture(root, { projectId: project, sessionId: "old", turnId: "old", role: "user", content: "overdue-zephyr durable note", sourceAgent: "test", timestamp: "2020-01-01T00:00:00.000Z" });
  const result = await handleHook(root, { hook_event_name: "UserPromptSubmit", session_id: "s1", turn_id: "new", cwd, prompt: "ordinary follow-up" }, "codex");
  assert.equal(result.processed, 2);
  assert.match((await search(root, { projectId: project, query: "overdue-zephyr" }))[0]?.snippet ?? "", /overdue-zephyr/);
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
  assert.doesNotMatch(JSON.stringify(startup.output), /already captured the current user event/);
  const ready = await handleHook(root, { hook_event_name: "SessionStart", session_id: "s2", cwd }, "claude-code", undefined,
    { node: process.execPath, cli: "/trusted/runtime/dist/cli.js", vault: root });
  assert.match(JSON.stringify(ready.output), /Trusted Linger CLI locator/);
});

test("captures Claude StopFailure output as partial evidence", async () => {
  const { root, cwd, project } = await fixture();
  const result = await handleHook(root, { hook_event_name: "StopFailure", session_id: "s1", turn_id: "partial", cwd, last_assistant_message: "partial-zephyr interrupted response" }, "claude-code");
  assert.ok(result.captured);
  await processQueue(root);
  const hit = (await search(root, { projectId: project, query: "partial-zephyr" }))[0]!;
  assert.ok(hit.warning_flags.includes("partial_source"));
});

test("session off is isolated, reversible, and stores no control message", async () => {
  const { root, cwd } = await fixture();
  const locator = { node: "/trusted/node", cli: "/trusted/runtime/dist/cli.js", vault: root };
  const token = sessionControlToken("codex", "session-a");
  const off = await handleHook(root, { hook_event_name: "UserPromptSubmit", session_id: "session-a", cwd, prompt: "$linger off" }, "codex", undefined, locator);
  assert.equal(off.skipped, "session_disabled");
  assert.equal((await sessionControlStatus(root, token)).capture, "off");
  assert.equal((await handleHook(root, { hook_event_name: "UserPromptSubmit", session_id: "session-a", cwd, prompt: "must not be stored" }, "codex")).skipped, "session_disabled");
  assert.ok((await handleHook(root, { hook_event_name: "UserPromptSubmit", session_id: "session-b", cwd, prompt: "other session remains active" }, "codex")).captured);
  const on = await handleHook(root, { hook_event_name: "UserPromptSubmit", session_id: "session-a", cwd, prompt: "$linger on" }, "codex", undefined, locator);
  assert.equal(on.skipped, "session_enabled");
  assert.equal((await sessionControlStatus(root, token)).capture, "on");
  assert.ok((await handleHook(root, { hook_event_name: "UserPromptSubmit", session_id: "session-a", cwd, prompt: "capture resumed" }, "codex")).captured);
});

test("unsupported, empty, malformed, and opt-out hook payloads create no Vault state", async () => {
  for (const input of [
    { hook_event_name: "UnknownEvent", cwd: "/tmp/attacker" },
    { hook_event_name: "SessionEnd", session_id: "unused-session", cwd: "/tmp/attacker" },
    { hook_event_name: "Stop", cwd: "/tmp/attacker", last_assistant_message: "" },
    { hook_event_name: "UserPromptSubmit", cwd: "/tmp/attacker", prompt: 42 as never },
    { hook_event_name: "UserPromptSubmit", cwd: "/tmp/attacker", prompt: "do not save this" }
  ]) {
    const root = await mkdtemp(path.join(os.tmpdir(), "linger-hook-zero-write-"));
    const result = await handleHook(root, input, "codex");
    assert.ok(result.skipped);
    await assert.rejects(access(path.join(root, "config.json")));
    await assert.rejects(access(path.join(root, "projects")));
  }
});
