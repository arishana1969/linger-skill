import assert from "node:assert/strict";
import { access, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { handleHook } from "./hook-handler.js";
import { healthReport, readLifecycleEvidence } from "./lifecycle-evidence.js";
import { processQueue } from "./processing.js";
import { setSetting } from "./settings.js";
import { setPaused } from "./vault.js";

test("managed hook writes one immutable lifecycle sequence and health is project-scoped", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-lifecycle-"));
  const cwd = await mkdtemp(path.join(os.tmpdir(), "linger-project-"));
  const result = await handleHook(root, {
    hook_event_name: "UserPromptSubmit",
    session_id: "session_one",
    turn_id: "turn_one",
    cwd,
    prompt: "remember lifecycle orchid"
  }, "codex", "a".repeat(64), { node: process.execPath, cli: path.join(cwd, "dist", "cli.js"), vault: root });
  assert.ok(result.captured);
  const project = (await import("./vault.js")).projectId;
  const projectId = await project(cwd);
  const records = await readLifecycleEvidence(root, projectId);
  assert.deepEqual(records.map(record => record.record_kind), ["hook_started", "capture_terminal", "hook_terminal"]);
  assert.equal(records.every(record => !("content" in record)), true);

  await processQueue(root, projectId);
  const health = await healthReport(root, { projectId, home: path.join(root, "empty-home") });
  assert.equal(health.capture_health.state, "healthy");
  assert.equal(health.pipeline_health.state, "healthy");
  assert.equal(health.overall.state, "healthy");
});

test("user opt-out leaves no Vault or lifecycle trace", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "linger-lifecycle-optout-"));
  const root = path.join(parent, "vault");
  const result = await handleHook(root, { hook_event_name: "UserPromptSubmit", session_id: "s", turn_id: "t", cwd: parent, prompt: "不要保存这一轮" }, "codex");
  assert.equal(result.skipped, "user_opt_out");
  await assert.rejects(access(root));
});

test("paused and evidence-off states are explicit without false active wording", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-lifecycle-policy-"));
  const cwd = await mkdtemp(path.join(os.tmpdir(), "linger-project-"));
  await setPaused(root, true);
  const paused = await handleHook(root, { hook_event_name: "UserPromptSubmit", session_id: "s", turn_id: "t", cwd, prompt: "remember paused" }, "claude-code");
  assert.equal(paused.skipped, "paused");
  assert.match(JSON.stringify(paused.output), /capture is paused/i);
  assert.doesNotMatch(JSON.stringify(paused.output), /Linger is active/);

  await setPaused(root, false);
  await setSetting(root, { scope: "global", key: "capture_health.operational_evidence", value: "off" });
  await handleHook(root, { hook_event_name: "UserPromptSubmit", session_id: "s2", turn_id: "t2", cwd, prompt: "remember without operational evidence" }, "claude-code");
  const projectId = await (await import("./vault.js")).projectId(cwd);
  assert.equal((await readLifecycleEvidence(root, projectId)).length, 3);
  const health = await healthReport(root, { projectId, home: path.join(root, "empty-home") });
  assert.equal(health.capture_health.state, "unknown");
  assert.deepEqual(health.capture_health.reason_codes, ["operational_evidence_disabled"]);
});
