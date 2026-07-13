import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { assertWritableInside, atomicJson, readJson, withFileLock } from "./io.js";
import { completePending, stagePending } from "./pending.js";
import { assertSafeId, vaultPaths } from "./paths.js";
import { classifySensitivity, redactSecrets } from "./sensitivity.js";
import { assertRawEvent, assertSequenceState } from "./schema-validation.js";
import { assertRawRecordPath } from "./record-paths.js";
import type { QueueItem, RawEvent, Role, SavepointStatus } from "./types.js";
import { initVault } from "./vault.js";
import { findRecentEquivalentHookEvent } from "./hook-ownership.js";

export interface CaptureInput {
  projectId: string;
  sessionId: string;
  turnId: string;
  role: Role;
  content: string;
  sourceAgent: string;
  sourceModel?: string;
  savepointStatus?: SavepointStatus;
  explicit?: boolean;
  sensitivity?: "normal" | "sensitive" | "secret";
  timestamp?: string;
  reuseRecentHookCapture?: boolean;
}

const ROLES = new Set<Role>(["user", "assistant", "system"]);
const SAVEPOINT_STATUSES = new Set<SavepointStatus>(["pending", "complete", "partial"]);
const SENSITIVITIES = new Set(["normal", "sensitive", "secret"]);

export async function capture(root: string, input: CaptureInput): Promise<RawEvent | undefined> {
  if (!input.content.trim()) throw new Error("Content must not be empty");
  if (!ROLES.has(input.role)) throw new Error("Role must be user, assistant, or system");
  if (input.savepointStatus !== undefined && !SAVEPOINT_STATUSES.has(input.savepointStatus)) throw new Error("Savepoint status must be pending, complete, or partial");
  if (input.sensitivity !== undefined && !SENSITIVITIES.has(input.sensitivity)) throw new Error("Sensitivity must be normal, sensitive, or secret");
  const project = assertSafeId(input.projectId, "project id");
  const session = assertSafeId(input.sessionId, "session id");
  const turn = assertSafeId(input.turnId, "turn id");
  const config = await initVault(root);
  if (config.paused) return undefined;
  const detected = classifySensitivity(input.content);
  const sensitivity = strongerSensitivity(input.sensitivity ?? "normal", detected.level);
  const storedContent = detected.level === "secret" ? redactSecrets(input.content) : input.content;
  if (input.reuseRecentHookCapture) {
    const owned = await findRecentEquivalentHookEvent(root, { projectId: project, role: input.role, content: storedContent });
    if (owned) return owned;
  }
  const p = vaultPaths(root);
  const contentHash = createHash("sha256").update(storedContent).digest("hex");
  const dedupe = createHash("sha256").update(`${project}\0${session}\0${turn}\0${input.role}\0${contentHash}`).digest("hex").slice(0, 24);
  const eventId = `evt_${dedupe}`;
  const rawFile = path.join(p.raw, project, session, `${eventId}.json`);
  const expected = { eventId, project, session, turn, role: input.role, contentHash };
  const existing = await readExistingRaw(p, rawFile, expected);
  if (existing) return existing;

  return await withFileLock(path.join(p.tmp, `${project}.capture.lock`), async () => {
    const raced = await readExistingRaw(p, rawFile, expected);
    if (raced) return raced;
    const sequenceFile = path.join(p.registry, `${project}.sequence.json`);
    await assertWritableInside(p.root, sequenceFile);
    let current = 0;
    try { const state = await readJson<unknown>(sequenceFile); assertSequenceState(state); current = state.value; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const timestamp = input.timestamp ?? new Date().toISOString();
    const event: RawEvent = {
      schema_version: 1, event_id: eventId, session_id: session, project_id: project, seq_id: current + 1, turn_id: turn,
      role: input.role, timestamp, source_agent: input.sourceAgent, source_model: input.sourceModel, content: storedContent,
      content_hash: contentHash, savepoint_status: input.savepointStatus ?? "complete", capture_status: "captured",
      sensitivity, raw_ref: path.relative(p.root, rawFile)
    };
    const queueItem: QueueItem = {
      schema_version: 1, task_id: `task_${randomUUID()}`, event_id: eventId, project_id: project,
      priority: input.explicit ? "explicit" : "normal", status: "pending", attempts: 0, created_at: timestamp, updated_at: timestamp
    };
    const queueFile = path.join(p.queue, project, `${queueItem.task_id}.json`);
    const pendingFile = await stagePending(root, {
      schema_version: 1, pending_id: eventId, event, queue_item: queueItem, raw_file: rawFile, queue_file: queueFile,
      sequence_file: sequenceFile, sequence_value: current + 1, created_at: timestamp
    });
    await atomicJson(rawFile, event);
    await atomicJson(sequenceFile, { schema_version: 1, value: current + 1 });
    await atomicJson(queueFile, queueItem);
    await completePending(pendingFile);
    return event;
  });
}

async function readExistingRaw(p: ReturnType<typeof vaultPaths>, file: string, expected: { eventId: string; project: string; session: string; turn: string; role: Role; contentHash: string }): Promise<RawEvent | undefined> {
  await assertWritableInside(p.root, file);
  let value: unknown;
  try { value = await readJson<unknown>(file); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  assertRawEvent(value);
  assertRawRecordPath(p, file, value);
  const computed = createHash("sha256").update(value.content).digest("hex");
  if (value.event_id !== expected.eventId || value.project_id !== expected.project || value.session_id !== expected.session || value.turn_id !== expected.turn || value.role !== expected.role || value.content_hash !== expected.contentHash || computed !== value.content_hash) {
    throw new Error("Existing raw event failed integrity check");
  }
  return value;
}

function strongerSensitivity(left: "normal" | "sensitive" | "secret", right: "normal" | "sensitive" | "secret"): "normal" | "sensitive" | "secret" {
  const levels = ["normal", "sensitive", "secret"] as const;
  return levels[Math.max(levels.indexOf(left), levels.indexOf(right))]!;
}
