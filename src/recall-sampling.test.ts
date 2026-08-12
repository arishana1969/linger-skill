import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { assertRecallSampleRecord } from "./recall-sampling.js";

test("validates legacy recall samples without exposing removed write APIs", () => {
  const root = "/tmp/linger-legacy-vault";
  const attempt = {
    schema_version: 1,
    attempt_id: "ra_legacy",
    project_id: "p_legacy",
    query: "old query",
    query_sensitivity: "normal",
    classification: "no_reliable_memory_found",
    hit_sources: [],
    raw_refs: [],
    created_at: "2026-01-01T00:00:00.000Z"
  };
  const file = path.join(root, "registry", "recall-samples", "p_legacy", "attempts", "ra_legacy.json");
  assert.doesNotThrow(() => assertRecallSampleRecord(root, file, attempt));
  assert.throws(
    () => assertRecallSampleRecord(root, file, { ...attempt, project_id: "p_other" }),
    /Invalid recall attempt path/
  );
});
