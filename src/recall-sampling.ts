import path from "node:path";
import { assertSafeId, vaultPaths } from "./paths.js";

type LegacyRecallAttempt = {
  schema_version: 1;
  attempt_id: string;
  project_id: string;
};

type LegacyRecallFeedback = {
  schema_version: 1;
  feedback_id: string;
  attempt_id: string;
  project_id: string;
};

const CLASSIFICATIONS = new Set([
  "exact_record_found",
  "similar_record_found",
  "possible_match",
  "no_reliable_memory_found",
  "conflicting_memories_found",
  "unprocessed_raw_match"
]);

const RETRIEVAL_MODES = new Set(["deterministic", "hybrid", "deterministic_fallback"]);
const OUTCOMES = new Set(["useful", "partial", "wrong", "missed"]);
const RAW_LOCATED = new Set(["yes", "no", "unknown"]);
const FAILURE_CATEGORIES = new Set([
  "capture_missing",
  "project_mapping_mismatch",
  "processing_missing",
  "indexing_missing",
  "lexical_miss",
  "semantic_miss",
  "ranking_miss",
  "wrong_evidence",
  "unknown"
]);

/**
 * Validate legacy v0.x recall-sampling records without reviving their removed
 * product surface. Doctor and repair use this solely to preserve old Vaults.
 */
export function assertRecallSampleRecord(root: string, file: string, value: unknown): void {
  const relative = path.relative(path.join(vaultPaths(root).registry, "recall-samples"), file);
  const parts = relative.split(path.sep);
  if (parts.length === 3 && parts[1] === "attempts") {
    assertRecallAttempt(value);
    const expected = path.join(vaultPaths(root).registry, "recall-samples", value.project_id, "attempts", `${value.attempt_id}.json`);
    if (path.resolve(file) !== path.resolve(expected)) throw new Error("Invalid recall attempt path");
    return;
  }
  if (parts.length === 4 && parts[1] === "feedback") {
    assertRecallFeedback(value);
    const expected = path.join(vaultPaths(root).registry, "recall-samples", value.project_id, "feedback", value.attempt_id, `${value.feedback_id}.json`);
    if (path.resolve(file) !== path.resolve(expected)) throw new Error("Invalid recall feedback path");
    return;
  }
  throw new Error("Invalid recall sample path");
}

function assertRecallAttempt(value: unknown): asserts value is LegacyRecallAttempt {
  const item = record(value, "recall attempt");
  if (
    item.schema_version !== 1
    || typeof item.attempt_id !== "string"
    || typeof item.project_id !== "string"
    || typeof item.query !== "string"
    || typeof item.created_at !== "string"
  ) throw new Error("Invalid recall attempt");
  assertSafeId(item.attempt_id, "recall attempt id");
  assertSafeId(item.project_id, "project id");
  assertTimestamp(item.created_at, "recall attempt timestamp");
  if (!new Set(["normal", "sensitive", "secret"]).has(item.query_sensitivity as string)) throw new Error("Invalid recall attempt sensitivity");
  if (!CLASSIFICATIONS.has(item.classification as string)) throw new Error("Invalid recall attempt classification");
  if (!strings(item.hit_sources) || !strings(item.raw_refs)) throw new Error("Invalid recall attempt references");
  if (item.decision_topic !== undefined && typeof item.decision_topic !== "string") throw new Error("Invalid recall attempt decision topic");
  if (item.retrieval_mode !== undefined && !RETRIEVAL_MODES.has(item.retrieval_mode as string)) throw new Error("Invalid recall retrieval mode");
  if (item.capture_health !== undefined) assertCaptureHealth(item.capture_health);
}

function assertRecallFeedback(value: unknown): asserts value is LegacyRecallFeedback {
  const item = record(value, "recall feedback");
  if (
    item.schema_version !== 1
    || typeof item.feedback_id !== "string"
    || typeof item.attempt_id !== "string"
    || typeof item.project_id !== "string"
    || typeof item.created_at !== "string"
  ) throw new Error("Invalid recall feedback");
  assertSafeId(item.feedback_id, "recall feedback id");
  assertSafeId(item.attempt_id, "recall attempt id");
  assertSafeId(item.project_id, "project id");
  assertTimestamp(item.created_at, "recall feedback timestamp");
  if (!OUTCOMES.has(item.outcome as string) || !RAW_LOCATED.has(item.raw_located as string)) throw new Error("Invalid recall feedback values");
  if (typeof item.decision_trail_used !== "boolean") throw new Error("Invalid recall feedback values");
  if (item.note !== undefined && (typeof item.note !== "string" || item.note.length > 2000)) throw new Error("Invalid recall feedback note");
  if (item.failure_category !== undefined && !FAILURE_CATEGORIES.has(item.failure_category as string)) throw new Error("Invalid recall failure category");
  if (item.expected_evidence_refs !== undefined && !strings(item.expected_evidence_refs)) throw new Error("Invalid expected evidence refs");
}

function assertCaptureHealth(value: unknown): void {
  const item = record(value, "recall capture health");
  const states = new Set(["healthy", "degraded", "broken", "unknown", "paused"]);
  if (
    !states.has(item.overall as string)
    || !states.has(item.capture as string)
    || !states.has(item.pipeline as string)
    || !strings(item.reason_codes)
  ) throw new Error("Invalid recall capture health");
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value as Record<string, unknown>;
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}

function assertTimestamp(value: string, label: string): void {
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
  if (!iso.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(`Invalid ${label}`);
}
