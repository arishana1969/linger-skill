import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appendDecision, getDecisionTrail, listDecisionViews } from "./decisions.js";
import { initVault } from "./vault.js";

async function vault(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-decisions-"));
  await initVault(root);
  return root;
}

test("preserves A to B to A and derives current state", async () => {
  const root = await vault();
  const first = await appendDecision(root, { projectId: "p_test", topic: "storage", kind: "decision", status: "current", statement: "Use files", source: "user_explicit", confidence: 1, evidenceRefs: ["evt_1"], timestamp: "2026-01-01T00:00:00.000Z" });
  const second = await appendDecision(root, { projectId: "p_test", topic: "storage", kind: "decision", status: "current", statement: "Use SQLite", rationale: "Faster queries", source: "user_explicit", confidence: 1, evidenceRefs: ["evt_2"], supersedes: [first.event.event_id], timestamp: "2026-02-01T00:00:00.000Z" });
  await appendDecision(root, { projectId: "p_test", topic: "storage", kind: "correction", status: "current", statement: "Use files", rationale: "Portability matters more", source: "user_explicit", confidence: 1, evidenceRefs: ["evt_3"], supersedes: [second.event.event_id], timestamp: "2026-03-01T00:00:00.000Z" });
  const trail = await getDecisionTrail(root, "p_test", "storage");
  assert.deepEqual(trail?.events.map(event => event.statement), ["Use files", "Use SQLite", "Use files"]);
  assert.equal(trail?.view.current_state, "Use files");
  assert.equal(trail?.view.source_events.length, 3);
});

test("low confidence inference cannot override explicit current state", async () => {
  const root = await vault();
  await appendDecision(root, { projectId: "p_test", topic: "adapter", kind: "decision", status: "current", statement: "Rule-only", source: "user_explicit", confidence: 1, evidenceRefs: ["evt_1"] });
  await appendDecision(root, { projectId: "p_test", topic: "adapter", kind: "decision", status: "current", statement: "Full hooks", source: "agent_inferred", confidence: 0.5, evidenceRefs: ["evt_2"] });
  const views = await listDecisionViews(root, "p_test");
  assert.equal(views[0]?.current_state, "Rule-only");
});

test("requires evidence and detects conflicting explicit states", async () => {
  const root = await vault();
  await assert.rejects(appendDecision(root, { projectId: "p_test", topic: "x", kind: "idea", status: "proposed", statement: "X", source: "user_explicit", confidence: 1, evidenceRefs: [] }), /require evidence/);
  await appendDecision(root, { projectId: "p_test", topic: "runtime", kind: "decision", status: "current", statement: "Node", source: "user_explicit", confidence: 1, evidenceRefs: ["evt_1"] });
  const result = await appendDecision(root, { projectId: "p_test", topic: "runtime", kind: "decision", status: "current", statement: "Deno", source: "user_explicit", confidence: 1, evidenceRefs: ["evt_2"] });
  assert.equal(result.view.conflicts.length, 2);
});

test("rejects invalid decision enum values before persistence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-decisions-invalid-"));
  const base = { projectId: "p_test", topic: "runtime", kind: "decision" as const, status: "current" as const, statement: "Use Node", source: "user_explicit" as const, confidence: 1, evidenceRefs: ["evt_1"] };
  await assert.rejects(appendDecision(root, { ...base, kind: "guess" as never }), /Invalid decision kind/);
  await assert.rejects(appendDecision(root, { ...base, status: "active" as never }), /Invalid decision status/);
  await assert.rejects(appendDecision(root, { ...base, source: "imported" as never }), /Invalid decision source/);
  assert.deepEqual(await listDecisionViews(root, "p_test"), []);
});
