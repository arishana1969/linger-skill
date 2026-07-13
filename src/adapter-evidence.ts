import { createHash } from "node:crypto";
import path from "node:path";
import { assertReadableInside, assertWritableInside, atomicJson, readJson, withFileLock } from "./io.js";
import { assertSafeId, vaultPaths } from "./paths.js";
import { assertRawRecordPath } from "./record-paths.js";
import { assertRawEvent } from "./schema-validation.js";

export const CODEX_LIVE_EVENTS = ["SessionStart", "UserPromptSubmit", "Stop"] as const;
export type CodexLiveEvent = typeof CODEX_LIVE_EVENTS[number];

interface EventEvidence {
  observed_at: string;
  captured_event_id?: string;
}

export interface SessionEvidence {
  session_id: string;
  project_id: string;
  runtime_identity: string;
  first_observed_at: string;
  last_observed_at: string;
  events: Partial<Record<CodexLiveEvent, EventEvidence>>;
}

export interface CodexAdapterEvidence {
  schema_version: 2;
  adapter: "codex";
  sessions: SessionEvidence[];
}

export async function recordCodexLiveEvent(
  root: string,
  input: { sessionId: string; projectId: string; runtimeIdentity: string; event: CodexLiveEvent; capturedEventId?: string },
  now = new Date()
): Promise<void> {
  const sessionId = assertSafeId(input.sessionId, "Codex evidence session id");
  const projectId = assertSafeId(input.projectId, "Codex evidence project id");
  if (!/^[a-f0-9]{64}$/.test(input.runtimeIdentity)) throw new Error("Invalid Codex runtime identity");
  if (!CODEX_LIVE_EVENTS.includes(input.event)) throw new Error("Invalid Codex live event");
  if (input.capturedEventId !== undefined) assertSafeId(input.capturedEventId, "Codex captured event id");
  const dir = path.join(vaultPaths(root).registry, "adapter-evidence");
  const file = path.join(dir, "codex.json");
  const lock = path.join(dir, ".codex.lock");
  await assertWritableInside(root, file);
  await assertWritableInside(root, lock);
  await withFileLock(lock, async () => {
    const evidence = await readEvidence(file);
    const observed = now.toISOString();
    let session = evidence.sessions.find(item =>
      item.session_id === sessionId
      && item.project_id === projectId
      && item.runtime_identity === input.runtimeIdentity
    );
    if (!session) {
      session = {
        session_id: sessionId,
        project_id: projectId,
        runtime_identity: input.runtimeIdentity,
        first_observed_at: observed,
        last_observed_at: observed,
        events: {}
      };
      evidence.sessions.push(session);
    }
    session.last_observed_at = observed;
    session.events[input.event] = {
      observed_at: observed,
      ...(input.capturedEventId ? { captured_event_id: input.capturedEventId } : {})
    };
    evidence.sessions = evidence.sessions
      .sort((a, b) => b.last_observed_at.localeCompare(a.last_observed_at))
      .slice(0, 20);
    await atomicJson(file, evidence);
  });
}

export async function readCodexAdapterEvidence(root: string): Promise<CodexAdapterEvidence | undefined> {
  const file = path.join(vaultPaths(root).registry, "adapter-evidence", "codex.json");
  try {
    await assertReadableInside(root, file);
    const value = await readJson<unknown>(file);
    if (isLegacyEvidence(value)) return undefined;
    assertCodexAdapterEvidence(value);
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function verifiedCodexLiveSession(
  root: string,
  evidence: CodexAdapterEvidence | undefined,
  runtimeIdentities: string[]
): Promise<SessionEvidence | undefined> {
  const allowed = new Set(runtimeIdentities.filter(identity => /^[a-f0-9]{64}$/.test(identity)));
  if (!allowed.size) return undefined;
  for (const session of evidence?.sessions ?? []) {
    if (!allowed.has(session.runtime_identity) || !session.events.SessionStart) continue;
    const user = session.events.UserPromptSubmit?.captured_event_id;
    const assistant = session.events.Stop?.captured_event_id;
    if (!user || !assistant) continue;
    if (await verifiedCapture(root, session, user, "user") && await verifiedCapture(root, session, assistant, "assistant")) return session;
  }
  return undefined;
}

async function verifiedCapture(root: string, session: SessionEvidence, eventId: string, role: "user" | "assistant"): Promise<boolean> {
  const paths = vaultPaths(root);
  const file = path.join(paths.raw, session.project_id, session.session_id, `${eventId}.json`);
  try {
    await assertReadableInside(root, file);
    const event = await readJson<unknown>(file);
    assertRawEvent(event);
    assertRawRecordPath(paths, file, event);
    const hash = createHash("sha256").update(event.content).digest("hex");
    return event.event_id === eventId
      && event.project_id === session.project_id
      && event.session_id === session.session_id
      && event.role === role
      && event.source_agent === "codex"
      && event.content_hash === hash;
  } catch {
    return false;
  }
}

async function readEvidence(file: string): Promise<CodexAdapterEvidence> {
  try {
    const value = await readJson<unknown>(file);
    if (isLegacyEvidence(value)) return emptyEvidence();
    assertCodexAdapterEvidence(value);
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyEvidence();
    throw error;
  }
}

function emptyEvidence(): CodexAdapterEvidence { return { schema_version: 2, adapter: "codex", sessions: [] }; }

function isLegacyEvidence(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schema_version === 1 && record.adapter === "codex" && Array.isArray(record.sessions);
}

export function assertCodexAdapterEvidence(value: unknown): asserts value is CodexAdapterEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Codex adapter evidence");
  const record = value as Record<string, unknown>;
  if (record.schema_version !== 2 || record.adapter !== "codex" || !Array.isArray(record.sessions)) throw new Error("Invalid Codex adapter evidence");
  for (const candidate of record.sessions) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("Invalid Codex adapter evidence session");
    const session = candidate as Record<string, unknown>;
    if (typeof session.session_id !== "string" || typeof session.project_id !== "string") throw new Error("Invalid Codex adapter evidence session");
    assertSafeId(session.session_id, "Codex evidence session id");
    assertSafeId(session.project_id, "Codex evidence project id");
    if (typeof session.runtime_identity !== "string" || !/^[a-f0-9]{64}$/.test(session.runtime_identity)) throw new Error("Invalid Codex adapter evidence runtime");
    assertIsoTimestamp(session.first_observed_at);
    assertIsoTimestamp(session.last_observed_at);
    if (!session.events || typeof session.events !== "object" || Array.isArray(session.events)) throw new Error("Invalid Codex adapter evidence events");
    for (const [event, detail] of Object.entries(session.events)) {
      if (!CODEX_LIVE_EVENTS.includes(event as CodexLiveEvent) || !detail || typeof detail !== "object" || Array.isArray(detail)) throw new Error("Invalid Codex adapter evidence event");
      const item = detail as Record<string, unknown>;
      assertIsoTimestamp(item.observed_at);
      if (item.captured_event_id !== undefined) {
        if (typeof item.captured_event_id !== "string") throw new Error("Invalid Codex adapter evidence event");
        assertSafeId(item.captured_event_id, "Codex captured event id");
      }
    }
  }
}

export function assertCodexAdapterEvidencePath(root: string, file: string): void {
  const expected = path.join(vaultPaths(root).registry, "adapter-evidence", "codex.json");
  if (path.resolve(file) !== path.resolve(expected)) throw new Error("Invalid Codex adapter evidence path");
}

function assertIsoTimestamp(value: unknown): void {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error("Invalid Codex adapter evidence timestamp");
  }
}
