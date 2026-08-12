import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { appendDecision } from "./decisions.js";
import { why } from "./why.js";

test("why uses the current state-setting event for staleness, not later rationale", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-why-"));
  const home = await mkdtemp(path.join(os.tmpdir(), "linger-why-home-"));
  const currentEvidence = await capture(root, { projectId: "p", sessionId: "s", turnId: "t1", role: "user", content: "Choose file storage", sourceAgent: "test", timestamp: "2026-01-01T00:00:00.000Z" });
  const rationaleEvidence = await capture(root, { projectId: "p", sessionId: "s", turnId: "t2", role: "user", content: "Portability remains useful", sourceAgent: "test", timestamp: "2026-03-01T00:00:00.000Z" });
  await appendDecision(root, { projectId: "p", topic: "storage", aliases: ["database"], kind: "decision", status: "current", statement: "Use files", source: "user_explicit", confidence: 1, evidenceRefs: [currentEvidence!.event_id], timestamp: "2026-01-01T00:00:00.000Z" });
  await appendDecision(root, { projectId: "p", topic: "storage", kind: "rationale", status: "proposed", statement: "Portability rationale", source: "user_explicit", confidence: 1, evidenceRefs: [rationaleEvidence!.event_id], timestamp: "2026-03-01T00:00:00.000Z" });

  const result = await why(root, { projectId: "p", topic: "database", now: new Date("2026-04-01T00:00:00.000Z"), home });
  assert.equal(result.classification, "exact_trail");
  assert.equal(result.current_state, "Use files");
  assert.equal(result.staleness?.current_event_age_days, 90);
  assert.equal(result.staleness?.possibly_stale, true);
  assert.equal(result.staleness?.last_topic_activity_at, "2026-03-01T00:00:00.000Z");
  assert.equal(result.staleness?.last_state_setting_event_at, "2026-01-01T00:00:00.000Z");
  assert.ok(result.staleness?.warning_flags.includes("capture_may_have_missed_updates"));
});

test("why makes future timestamps and missing evidence unknown", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-why-"));
  const home = await mkdtemp(path.join(os.tmpdir(), "linger-why-home-"));
  const evidence = await capture(root, { projectId: "p", sessionId: "s", turnId: "t1", role: "user", content: "Future runtime choice", sourceAgent: "test" });
  await appendDecision(root, { projectId: "p", topic: "runtime", kind: "decision", status: "current", statement: "Use Node", source: "user_explicit", confidence: 1, evidenceRefs: [evidence!.event_id], timestamp: "2027-01-01T00:00:00.000Z" });
  await appendDecision(root, { projectId: "p", topic: "adapter", kind: "decision", status: "current", statement: "Use hooks", source: "user_explicit", confidence: 1, evidenceRefs: ["evt_missing"], timestamp: "2026-01-01T00:00:00.000Z" });

  const future = await why(root, { projectId: "p", topic: "runtime", now: new Date("2026-12-31T00:00:00.000Z"), home });
  assert.equal(future.staleness?.staleness_status, "unknown");
  assert.equal(future.staleness?.possibly_stale, null);
  assert.ok(future.staleness?.warning_flags.includes("future_timestamp"));

  const missing = await why(root, { projectId: "p", topic: "adapter", now: new Date("2026-04-01T00:00:00.000Z"), home });
  assert.equal(missing.classification, "incomplete_trail");
  assert.equal(missing.staleness?.staleness_status, "unknown");
  assert.ok(missing.warning_flags.includes("missing_source"));
});
