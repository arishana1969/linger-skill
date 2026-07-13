import path from "node:path";
import { assertWritableInside, atomicJson, readJson, withFileLock } from "./io.js";
import { vaultPaths } from "./paths.js";

export const CODEX_LIVE_EVENTS = ["SessionStart", "UserPromptSubmit", "Stop"] as const;
export type CodexLiveEvent = typeof CODEX_LIVE_EVENTS[number];

interface EventEvidence {
  observed_at: string;
  captured_event_id?: string;
}

interface SessionEvidence {
  session_id: string;
  project_id: string;
  first_observed_at: string;
  last_observed_at: string;
  events: Partial<Record<CodexLiveEvent, EventEvidence>>;
}

export interface CodexAdapterEvidence {
  schema_version: 1;
  adapter: "codex";
  sessions: SessionEvidence[];
}

export async function recordCodexLiveEvent(
  root: string,
  input: { sessionId: string; projectId: string; event: CodexLiveEvent; capturedEventId?: string },
  now = new Date()
): Promise<void> {
  const dir = path.join(vaultPaths(root).registry, "adapter-evidence");
  const file = path.join(dir, "codex.json");
  const lock = path.join(dir, ".codex.lock");
  await assertWritableInside(root, file);
  await assertWritableInside(root, lock);
  await withFileLock(lock, async () => {
    const evidence = await readEvidence(file);
    const observed = now.toISOString();
    let session = evidence.sessions.find(item => item.session_id === input.sessionId);
    if (!session) {
      session = {
        session_id: input.sessionId,
        project_id: input.projectId,
        first_observed_at: observed,
        last_observed_at: observed,
        events: {}
      };
      evidence.sessions.push(session);
    }
    session.project_id = input.projectId;
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
    const value = await readJson<unknown>(file);
    assertEvidence(value);
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function completedCodexLiveSession(evidence: CodexAdapterEvidence | undefined): SessionEvidence | undefined {
  return evidence?.sessions.find(session =>
    Boolean(
      session.events.SessionStart
      && session.events.UserPromptSubmit?.captured_event_id
      && session.events.Stop?.captured_event_id
    )
  );
}

async function readEvidence(file: string): Promise<CodexAdapterEvidence> {
  try {
    const value = await readJson<unknown>(file);
    assertEvidence(value);
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { schema_version: 1, adapter: "codex", sessions: [] };
    }
    throw error;
  }
}

function assertEvidence(value: unknown): asserts value is CodexAdapterEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Codex adapter evidence");
  const record = value as Record<string, unknown>;
  if (record.schema_version !== 1 || record.adapter !== "codex" || !Array.isArray(record.sessions)) throw new Error("Invalid Codex adapter evidence");
  for (const candidate of record.sessions) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("Invalid Codex adapter evidence session");
    const session = candidate as Record<string, unknown>;
    if (typeof session.session_id !== "string" || typeof session.project_id !== "string" || typeof session.first_observed_at !== "string" || typeof session.last_observed_at !== "string") throw new Error("Invalid Codex adapter evidence session");
    if (!session.events || typeof session.events !== "object" || Array.isArray(session.events)) throw new Error("Invalid Codex adapter evidence events");
    for (const [event, detail] of Object.entries(session.events)) {
      if (!CODEX_LIVE_EVENTS.includes(event as CodexLiveEvent) || !detail || typeof detail !== "object" || Array.isArray(detail)) throw new Error("Invalid Codex adapter evidence event");
      const item = detail as Record<string, unknown>;
      if (typeof item.observed_at !== "string" || (item.captured_event_id !== undefined && typeof item.captured_event_id !== "string")) throw new Error("Invalid Codex adapter evidence event");
    }
  }
}
