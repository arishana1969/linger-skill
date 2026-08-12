import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rmdir, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appendDecision, listDecisionViews } from "./decisions.js";
import { capture } from "./capture.js";
import { doctor } from "./doctor.js";
import { appendMemoryControl, effectiveMemoryStates } from "./memory-events.js";
import { vaultPaths } from "./paths.js";
import { processQueue } from "./processing.js";
import { processingDecision, recordProcessingRun } from "./processing-policy.js";
import { quarantineInvalidFiles } from "./repair.js";
import { search } from "./search.js";
import { expandTerms, type TermRelation } from "./term-graph.js";
import { initVault } from "./vault.js";

test("filesystem-routing entry points reject unsafe project IDs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-path-security-"));
  await assert.rejects(search(root, { projectId: "../outside", query: "secret" }), /Invalid project id/);
  await assert.rejects(processQueue(root, "../outside"), /Invalid project id/);
  await assert.rejects(processingDecision(root, "../outside", "manual"), /Invalid project id/);
  await assert.rejects(recordProcessingRun(root, "../outside"), /Invalid project id/);
});

test("path-traversing queue identity is invalid, inert, and repairable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-path-security-"));
  await initVault(root);
  const p = vaultPaths(root);
  const file = path.join(p.queue, "p", "poison.json");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({
    schema_version: 1,
    task_id: "task_poison",
    event_id: "evt_poison",
    project_id: "../outside",
    priority: "explicit",
    status: "pending",
    attempts: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }));
  assert.deepEqual(await processQueue(root), { processed: 0, failed: 0 });
  assert.equal((await doctor(root)).errors.some(error => error.startsWith("invalid_queue:")), true);
  const repaired = await quarantineInvalidFiles(root);
  assert.equal(repaired.quarantined.some(item => item.includes("queue")), true);
  assert.equal((await doctor(root)).ok, true);
});

test("safe but cross-project queue identity cannot broaden a scoped processing run", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-path-security-"));
  const p = vaultPaths(root);
  const file = path.join(p.queue, "p_alpha", "task_cross.json");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({
    schema_version: 1, task_id: "task_cross", event_id: "evt_cross", project_id: "p_beta", priority: "explicit", status: "pending", attempts: 0,
    created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z"
  }));
  assert.deepEqual(await processQueue(root, "p_alpha"), { processed: 0, failed: 0 });
  assert.equal((await doctor(root)).errors.some(error => error.startsWith("invalid_queue:")), true);
});

test("cross-project processed record is excluded from recall and diagnosed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-path-security-"));
  await capture(root, { projectId: "p_alpha", sessionId: "s", turnId: "t", role: "user", content: "scope-sentinel durable note", sourceAgent: "test" });
  await processQueue(root, "p_alpha");
  const initial = await search(root, { projectId: "p_alpha", query: "scope-sentinel" });
  const file = path.join(vaultPaths(root).processed, "p_alpha", `${initial[0]!.source}.json`);
  const memory = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  memory.project_id = "p_beta";
  await writeFile(file, JSON.stringify(memory));
  assert.deepEqual(await search(root, { projectId: "p_alpha", query: "scope-sentinel" }), []);
  assert.equal((await doctor(root)).errors.some(error => error.startsWith("invalid_processed:")), true);
});

test("timestamps that could alter a decision filename are rejected before persistence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-path-security-"));
  await assert.rejects(appendDecision(root, {
    projectId: "p", topic: "runtime", kind: "decision", status: "current", statement: "Use Node", source: "user_explicit", confidence: 1,
    evidenceRefs: ["evt_visible"], timestamp: "2026-01-01T00:00:00.000Z/../../escape"
  }), /Invalid decision event timestamp/);
});

test("misplaced derived records cannot cross project scope and are repairable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-path-security-"));
  await initVault(root);
  const p = vaultPaths(root);
  const decision = await appendDecision(root, {
    projectId: "p_beta", topic: "runtime", kind: "decision", status: "current", statement: "Use Beta runtime", source: "user_explicit", confidence: 1,
    evidenceRefs: ["evt_beta"]
  });
  const control = await appendMemoryControl(root, { kind: "forget", project_id: "p_beta", target_memory_id: "mem_beta", evidence_refs: [] });
  const relation: TermRelation = {
    schema_version: 1, relation_id: "tr_beta", project_id: "p_beta", term_a: "db", term_b: "database",
    relation_type: "abbreviation", confidence: 0.9, context_tags: [], evidence_refs: ["evt_beta"],
    created_at: "2026-01-01T00:00:00.000Z", last_verified: "2026-01-01T00:00:00.000Z"
  };

  const wrongDecision = path.join(p.decisions, "p_alpha", decision.event.canonical_id);
  const wrongEvent = path.join(wrongDecision, "events", `${decision.event.timestamp.replaceAll(":", "-")}-${decision.event.event_id}.json`);
  const wrongView = path.join(wrongDecision, "current.json");
  const wrongControl = path.join(p.registry, "memory-events", "p_alpha", `${control.timestamp.replaceAll(":", "-")}-${control.event_id}.json`);
  const wrongRelation = path.join(p.registry, "term-graph", "p_alpha", `${relation.relation_id}.json`);
  for (const [file, value] of [[wrongEvent, decision.event], [wrongView, decision.view], [wrongControl, control], [wrongRelation, relation]] as const) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value));
  }

  assert.deepEqual(await listDecisionViews(root, "p_alpha"), []);
  assert.equal((await effectiveMemoryStates(root, "p_alpha")).size, 0);
  assert.equal((await expandTerms(root, "p_alpha", ["db"])).size, 0);
  const before = await doctor(root);
  assert.equal(before.errors.filter(error => /invalid_(decision|memory_control|term_relation):/.test(error)).length, 4);
  const repaired = await quarantineInvalidFiles(root);
  assert.equal(repaired.quarantined.length, 4);
  assert.equal((await doctor(root)).ok, true);
});

test("capture refuses a project directory symlink that would escape the Vault", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-path-security-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "linger-path-outside-"));
  await initVault(root);
  await symlink(outside, path.join(vaultPaths(root).raw, "p"));
  await assert.rejects(capture(root, { projectId: "p", sessionId: "s", turnId: "t", role: "user", content: "must stay inside vault", sourceAgent: "test" }), /escapes Vault through symlink/);
  assert.deepEqual(await readdir(outside), []);
});

test("pending staging refuses a symlinked pending project directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-path-security-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "linger-path-outside-"));
  await initVault(root);
  const pendingBase = path.join(vaultPaths(root).tmp, "pending");
  await mkdir(pendingBase, { recursive: true });
  await symlink(outside, path.join(pendingBase, "p"));
  await assert.rejects(capture(root, { projectId: "p", sessionId: "s", turnId: "t", role: "user", content: "pending must stay inside vault", sourceAgent: "test" }), /escapes Vault through symlink/);
  assert.deepEqual(await readdir(outside), []);
});

test("processing refuses a symlinked processed project directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-path-security-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "linger-path-outside-"));
  await capture(root, { projectId: "p", sessionId: "s", turnId: "t", role: "user", content: "processed must stay inside vault", sourceAgent: "test" });
  await symlink(outside, path.join(vaultPaths(root).processed, "p"));
  assert.deepEqual(await processQueue(root, "p"), { processed: 0, failed: 1 });
  assert.deepEqual(await readdir(outside), []);
});

test("decision writes refuse a symlinked project directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-path-security-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "linger-path-outside-"));
  await initVault(root);
  await symlink(outside, path.join(vaultPaths(root).decisions, "p"));
  await assert.rejects(appendDecision(root, { projectId: "p", topic: "runtime", kind: "decision", status: "current", statement: "stay inside", source: "user_explicit", confidence: 1, evidenceRefs: ["evt_visible"] }), /escapes Vault through symlink/);
  assert.deepEqual(await readdir(outside), []);
});

test("Vault initialization refuses a symlinked config file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-path-security-"));
  const outside = path.join(await mkdtemp(path.join(os.tmpdir(), "linger-path-outside-")), "outside.json");
  await initVault(root);
  const config = vaultPaths(root).config;
  await unlink(config);
  await writeFile(outside, "outside-bytes");
  await symlink(outside, config);
  await assert.rejects(initVault(root), /Write target is a symlink/);
  assert.equal(await readFile(outside, "utf8"), "outside-bytes");
});

test("Vault scans reject and repair a top-level data directory symlink without reading its target", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-path-security-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "linger-path-outside-"));
  await initVault(root);
  const raw = vaultPaths(root).raw;
  await rmdir(raw);
  const sentinel = path.join(outside, "outside.json");
  await writeFile(sentinel, JSON.stringify({ private: "outside-secret" }));
  await symlink(outside, raw);
  await assert.rejects(search(root, { projectId: "p", query: "outside-secret", includeRaw: true }), /Read path escapes Vault|symlink/);
  const before = await doctor(root);
  assert.equal(before.ok, false);
  assert.ok(before.errors.some(error => error.startsWith("invalid_raw:")));
  const repaired = await quarantineInvalidFiles(root);
  assert.ok(repaired.quarantined.some(file => file.includes("raw")));
  assert.equal(await readFile(sentinel, "utf8"), JSON.stringify({ private: "outside-secret" }));
  assert.equal((await doctor(root)).ok, true);
});
