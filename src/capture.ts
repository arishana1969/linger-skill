import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { atomicJson, readJson, withFileLock } from "./io.js";
import { completePending, stagePending } from "./pending.js";
import { assertSafeId, vaultPaths } from "./paths.js";
import type { QueueItem, RawEvent, Role, SavepointStatus } from "./types.js";
import { initVault } from "./vault.js";

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
}

export async function capture(root: string, input: CaptureInput): Promise<RawEvent | undefined> {
  const config = await initVault(root);
  if (config.paused) return undefined;
  if (!input.content.trim()) throw new Error("Content must not be empty");
  const project = assertSafeId(input.projectId, "project id");
  const session = assertSafeId(input.sessionId, "session id");
  const turn = assertSafeId(input.turnId, "turn id");
  const p = vaultPaths(root);
  const contentHash = createHash("sha256").update(input.content).digest("hex");
  const dedupe = createHash("sha256").update(`${project}\0${session}\0${turn}\0${input.role}\0${contentHash}`).digest("hex").slice(0, 24);
  const eventId = `evt_${dedupe}`;
  const rawFile = path.join(p.raw, project, session, `${eventId}.json`);
  try { return await readJson<RawEvent>(rawFile); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }

  return await withFileLock(path.join(p.tmp, `${project}.capture.lock`), async () => {
    try { return await readJson<RawEvent>(rawFile); } catch { /* continue */ }
    const sequenceFile = path.join(p.registry, `${project}.sequence.json`);
    let current = 0;
    try { current = (await readJson<{ value: number }>(sequenceFile)).value; } catch { /* first event */ }
    const timestamp = input.timestamp ?? new Date().toISOString();
    const event: RawEvent = {
      schema_version: 1, event_id: eventId, session_id: session, project_id: project, seq_id: current + 1, turn_id: turn,
      role: input.role, timestamp, source_agent: input.sourceAgent, source_model: input.sourceModel, content: input.content,
      content_hash: contentHash, savepoint_status: input.savepointStatus ?? "complete", capture_status: "captured",
      sensitivity: input.sensitivity ?? "normal", raw_ref: path.relative(p.root, rawFile)
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
    await atomicJson(sequenceFile, { value: current + 1 });
    await atomicJson(queueFile, queueItem);
    await completePending(pendingFile);
    return event;
  });
}
