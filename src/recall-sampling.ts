import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { assertReadableInside, assertWritableInside, atomicJson, readJson } from "./io.js";
import { assertSafeId, vaultPaths } from "./paths.js";
import { classifySensitivity, redactSecrets } from "./sensitivity.js";
import type { RecallPackage } from "./recall.js";

export type RecallFeedbackOutcome = "useful" | "partial" | "wrong" | "missed";
export type RawLocated = "yes" | "no" | "unknown";

export interface RecallAttempt {
  schema_version: 1;
  attempt_id: string;
  project_id: string;
  query: string;
  query_sensitivity: "normal" | "sensitive" | "secret";
  classification: RecallPackage["classification"];
  hit_sources: string[];
  raw_refs: string[];
  decision_topic?: string;
  created_at: string;
}

export interface RecallFeedback {
  schema_version: 1;
  feedback_id: string;
  attempt_id: string;
  project_id: string;
  outcome: RecallFeedbackOutcome;
  raw_located: RawLocated;
  decision_trail_used: boolean;
  note?: string;
  created_at: string;
}

export async function recordRecallAttempt(
  root: string,
  input: { projectId: string; query: string; result: RecallPackage },
  now = new Date()
): Promise<RecallAttempt> {
  const project = assertSafeId(input.projectId, "project id");
  const detected = classifySensitivity(input.query);
  const attempt: RecallAttempt = {
    schema_version: 1,
    attempt_id: `ra_${randomUUID().replaceAll("-", "")}`,
    project_id: project,
    query: detected.level === "secret" ? redactSecrets(input.query) : input.query,
    query_sensitivity: detected.level,
    classification: input.result.classification,
    hit_sources: [...new Set(input.result.hits.map(hit => hit.source))],
    raw_refs: [...new Set(input.result.hits.flatMap(hit => hit.raw_ref))],
    ...(input.result.decision_topic ? { decision_topic: input.result.decision_topic } : {}),
    created_at: now.toISOString()
  };
  const file = path.join(sampleRoot(root, project), "attempts", `${attempt.attempt_id}.json`);
  await assertWritableInside(root, file);
  await atomicJson(file, attempt);
  return attempt;
}

export async function recordRecallFeedback(
  root: string,
  input: {
    projectId: string;
    attemptId: string;
    outcome: RecallFeedbackOutcome;
    rawLocated?: RawLocated;
    decisionTrailUsed?: boolean;
    note?: string;
  },
  now = new Date()
): Promise<RecallFeedback> {
  const project = assertSafeId(input.projectId, "project id");
  const attemptId = assertSafeId(input.attemptId, "recall attempt id");
  if (!["useful", "partial", "wrong", "missed"].includes(input.outcome)) throw new Error("Invalid recall feedback outcome");
  const rawLocated = input.rawLocated ?? "unknown";
  if (!["yes", "no", "unknown"].includes(rawLocated)) throw new Error("Invalid raw-located value");
  if (input.note && input.note.length > 2000) throw new Error("Recall feedback note is too long");
  const attemptFile = path.join(sampleRoot(root, project), "attempts", `${attemptId}.json`);
  await assertReadableInside(root, attemptFile);
  const attempt = await readJson<RecallAttempt>(attemptFile);
  assertRecallAttempt(attempt);
  assertRecallAttemptPath(root, attemptFile, attempt);
  if (attempt.attempt_id !== attemptId || attempt.project_id !== project) throw new Error("Invalid recall attempt");
  const noteSensitivity = input.note ? classifySensitivity(input.note) : undefined;
  const note = input.note && noteSensitivity?.level === "secret" ? redactSecrets(input.note) : input.note;
  const feedback: RecallFeedback = {
    schema_version: 1,
    feedback_id: `rf_${randomUUID().replaceAll("-", "")}`,
    attempt_id: attemptId,
    project_id: project,
    outcome: input.outcome,
    raw_located: rawLocated,
    decision_trail_used: input.decisionTrailUsed ?? false,
    ...(note ? { note } : {}),
    created_at: now.toISOString()
  };
  const file = path.join(sampleRoot(root, project), "feedback", attemptId, `${feedback.feedback_id}.json`);
  await assertWritableInside(root, file);
  await atomicJson(file, feedback);
  return feedback;
}

export async function recallSamplingReport(root: string, projectId: string): Promise<{
  project_id: string;
  total_attempts: number;
  unresolved_attempts: number;
  classifications: Record<string, number>;
  outcomes: Record<string, number>;
  raw_located_yes: number;
  decision_trail_used: number;
}> {
  const project = assertSafeId(projectId, "project id");
  const base = sampleRoot(root, project);
  const attempts = await readAttempts(root, path.join(base, "attempts"));
  const feedback = await readFeedback(root, path.join(base, "feedback"));
  if (attempts.some(item => item.project_id !== project) || feedback.some(item => item.project_id !== project)) throw new Error("Recall sampling project mismatch");
  const attemptIds = new Set(attempts.map(item => item.attempt_id));
  if (feedback.some(item => !attemptIds.has(item.attempt_id))) throw new Error("Recall feedback references a missing attempt");
  const latest = new Map<string, RecallFeedback>();
  for (const item of feedback.sort((a, b) => a.created_at.localeCompare(b.created_at))) latest.set(item.attempt_id, item);
  return {
    project_id: project,
    total_attempts: attempts.length,
    unresolved_attempts: attempts.filter(attempt => !latest.has(attempt.attempt_id)).length,
    classifications: counts(attempts.map(attempt => attempt.classification)),
    outcomes: counts([...latest.values()].map(item => item.outcome)),
    raw_located_yes: [...latest.values()].filter(item => item.raw_located === "yes").length,
    decision_trail_used: [...latest.values()].filter(item => item.decision_trail_used).length
  };
}

function sampleRoot(root: string, project: string): string {
  return path.join(vaultPaths(root).registry, "recall-samples", project);
}

async function readAttempts(root: string, dir: string): Promise<RecallAttempt[]> {
  try {
    await assertReadableInside(root, dir);
    const names = (await readdir(dir)).filter(name => name.endsWith(".json")).sort();
    return await Promise.all(names.map(async name => {
      const file = path.join(dir, name);
      await assertReadableInside(root, file);
      const attempt = await readJson<unknown>(file);
      assertRecallAttempt(attempt);
      assertRecallAttemptPath(root, file, attempt);
      return attempt;
    }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readFeedback(root: string, dir: string): Promise<RecallFeedback[]> {
  try {
    await assertReadableInside(root, dir);
    const attempts = await readdir(dir, { withFileTypes: true });
    const result: RecallFeedback[] = [];
    for (const attempt of attempts.filter(item => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const attemptDir = path.join(dir, attempt.name);
      await assertReadableInside(root, attemptDir);
      const names = (await readdir(attemptDir)).filter(name => name.endsWith(".json")).sort();
      for (const name of names) {
        const file = path.join(attemptDir, name);
        await assertReadableInside(root, file);
        const item = await readJson<unknown>(file);
        assertRecallFeedback(item);
        assertRecallFeedbackPath(root, file, item);
        result.push(item);
      }
    }
    return result;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function counts(values: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
}

export function assertRecallAttempt(value: unknown): asserts value is RecallAttempt {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid recall attempt");
  const item = value as Record<string, unknown>;
  if (item.schema_version !== 1 || typeof item.attempt_id !== "string" || typeof item.project_id !== "string" || typeof item.query !== "string" || typeof item.created_at !== "string") throw new Error("Invalid recall attempt");
  assertSafeId(item.attempt_id, "recall attempt id");
  assertSafeId(item.project_id, "project id");
  assertIsoTimestamp(item.created_at, "recall attempt timestamp");
  if (!["normal", "sensitive", "secret"].includes(item.query_sensitivity as string)) throw new Error("Invalid recall attempt sensitivity");
  if (!["exact_record_found", "similar_record_found", "possible_match", "no_reliable_memory_found", "conflicting_memories_found", "unprocessed_raw_match"].includes(item.classification as string)) throw new Error("Invalid recall attempt classification");
  if (!Array.isArray(item.hit_sources) || !item.hit_sources.every(value => typeof value === "string") || !Array.isArray(item.raw_refs) || !item.raw_refs.every(value => typeof value === "string")) throw new Error("Invalid recall attempt references");
  if (item.decision_topic !== undefined && typeof item.decision_topic !== "string") throw new Error("Invalid recall attempt decision topic");
}

export function assertRecallFeedback(value: unknown): asserts value is RecallFeedback {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid recall feedback");
  const item = value as Record<string, unknown>;
  if (item.schema_version !== 1 || typeof item.feedback_id !== "string" || typeof item.attempt_id !== "string" || typeof item.project_id !== "string" || typeof item.created_at !== "string") throw new Error("Invalid recall feedback");
  assertSafeId(item.feedback_id, "recall feedback id");
  assertSafeId(item.attempt_id, "recall attempt id");
  assertSafeId(item.project_id, "project id");
  assertIsoTimestamp(item.created_at, "recall feedback timestamp");
  if (!["useful", "partial", "wrong", "missed"].includes(item.outcome as string) || !["yes", "no", "unknown"].includes(item.raw_located as string) || typeof item.decision_trail_used !== "boolean") throw new Error("Invalid recall feedback values");
  if (item.note !== undefined && (typeof item.note !== "string" || item.note.length > 2000)) throw new Error("Invalid recall feedback note");
}

export function assertRecallAttemptPath(root: string, file: string, attempt: RecallAttempt): void {
  const expected = path.join(sampleRoot(root, attempt.project_id), "attempts", `${attempt.attempt_id}.json`);
  if (path.resolve(file) !== path.resolve(expected)) throw new Error("Invalid recall attempt path");
}

export function assertRecallFeedbackPath(root: string, file: string, feedback: RecallFeedback): void {
  const expected = path.join(sampleRoot(root, feedback.project_id), "feedback", feedback.attempt_id, `${feedback.feedback_id}.json`);
  if (path.resolve(file) !== path.resolve(expected)) throw new Error("Invalid recall feedback path");
}

export function assertRecallSampleRecord(root: string, file: string, value: unknown): void {
  const relative = path.relative(path.join(vaultPaths(root).registry, "recall-samples"), file);
  const parts = relative.split(path.sep);
  if (parts.length === 3 && parts[1] === "attempts") {
    assertRecallAttempt(value);
    assertRecallAttemptPath(root, file, value);
    return;
  }
  if (parts.length === 4 && parts[1] === "feedback") {
    assertRecallFeedback(value);
    assertRecallFeedbackPath(root, file, value);
    return;
  }
  throw new Error("Invalid recall sample path");
}

function assertIsoTimestamp(value: unknown, label: string): void {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(`Invalid ${label}`);
}
