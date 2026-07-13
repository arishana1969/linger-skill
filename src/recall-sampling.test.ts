import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initVault } from "./vault.js";
import { recallSamplingReport, recordRecallAttempt, recordRecallFeedback } from "./recall-sampling.js";
import type { RecallPackage } from "./recall.js";

const emptyRecall: RecallPackage = {
  classification: "no_reliable_memory_found",
  hits: [],
  candidates: { topics: [], decisions: [], tags: [], time_ranges: [] },
  truncated: false,
  total_characters: 0
};

test("records redacted recall attempts and append-only feedback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-recall-sampling-"));
  await initVault(root);
  const attempt = await recordRecallAttempt(root, {
    projectId: "p",
    query: "find api_key=super-secret-value",
    result: emptyRecall
  });
  assert.equal(attempt.query_sensitivity, "secret");
  assert.doesNotMatch(attempt.query, /super-secret-value/);
  await recordRecallFeedback(root, {
    projectId: "p",
    attemptId: attempt.attempt_id,
    outcome: "missed",
    rawLocated: "yes",
    decisionTrailUsed: false,
    note: "raw event existed but lexical recall missed"
  });
  const report = await recallSamplingReport(root, "p");
  assert.equal(report.total_attempts, 1);
  assert.equal(report.unresolved_attempts, 0);
  assert.equal(report.classifications.no_reliable_memory_found, 1);
  assert.equal(report.outcomes.missed, 1);
  assert.equal(report.raw_located_yes, 1);
});

test("reports unresolved attempts until feedback arrives", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-recall-sampling-"));
  await initVault(root);
  const attempt = await recordRecallAttempt(root, { projectId: "p", query: "database choice", result: emptyRecall });
  assert.equal((await recallSamplingReport(root, "p")).unresolved_attempts, 1);
  await recordRecallFeedback(root, { projectId: "p", attemptId: attempt.attempt_id, outcome: "useful", decisionTrailUsed: true });
  const report = await recallSamplingReport(root, "p");
  assert.equal(report.unresolved_attempts, 0);
  assert.equal(report.decision_trail_used, 1);
});

test("redacts secrets from feedback notes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-recall-sampling-"));
  await initVault(root);
  const attempt = await recordRecallAttempt(root, { projectId: "p", query: "credential issue", result: emptyRecall });
  const feedback = await recordRecallFeedback(root, { projectId: "p", attemptId: attempt.attempt_id, outcome: "wrong", note: "password=do-not-persist-this" });
  assert.doesNotMatch(feedback.note ?? "", /do-not-persist-this/);
  assert.match(feedback.note ?? "", /REDACTED/);
});
