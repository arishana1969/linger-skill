import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { processingDecision, recordProcessingRun } from "./processing-policy.js";

test("runs explicit work immediately and ordinary work at max wait", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-policy-"));
  const now = new Date("2026-01-01T01:00:00.000Z");
  await capture(root, { projectId: "p", sessionId: "s", turnId: "t", role: "user", content: "remember durable choice", sourceAgent: "test", explicit: true, timestamp: "2026-01-01T00:59:00.000Z" });
  assert.equal((await processingDecision(root, "p", "automatic", now)).reason, "explicit");
  const other = await mkdtemp(path.join(os.tmpdir(), "linger-policy-"));
  await capture(other, { projectId: "p", sessionId: "s", turnId: "t", role: "user", content: "ordinary durable discussion", sourceAgent: "test", timestamp: "2026-01-01T00:00:00.000Z" });
  assert.equal((await processingDecision(other, "p", "automatic", now)).reason, "max_wait");
});

test("enforces hourly run budget", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-policy-"));
  const now = new Date("2026-01-01T01:00:00.000Z");
  await capture(root, { projectId: "p", sessionId: "s", turnId: "t", role: "user", content: "ordinary pending event", sourceAgent: "test", timestamp: now.toISOString() });
  for (let index = 0; index < 4; index += 1) await recordProcessingRun(root, "p", new Date(now.getTime() - index * 1000));
  assert.equal((await processingDecision(root, "p", "automatic", now)).reason, "rate_limited");
  assert.equal((await processingDecision(root, "p", "manual", now)).reason, "manual");
});

test("exposes the automatic estimated-token budget", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-policy-"));
  await capture(root, { projectId: "p", sessionId: "s", turnId: "t", role: "user", content: "remember token budget", sourceAgent: "test", explicit: true });
  const decision = await processingDecision(root, "p", "automatic");
  assert.equal(decision.max_estimated_tokens, 16_000);
});
