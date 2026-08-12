import path from "node:path";
import { assertSafeId, vaultPaths } from "./paths.js";

export const CODEX_LIVE_EVENTS = ["SessionStart", "UserPromptSubmit", "Stop"] as const;

/**
 * Adapter evidence is a legacy compatibility input. v1 lifecycle evidence is
 * the only current health writer; this validator keeps old Vaults diagnosable.
 */
export function assertCodexAdapterEvidence(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Codex adapter evidence");
  const record = value as Record<string, unknown>;
  if ((record.schema_version !== 1 && record.schema_version !== 2) || record.adapter !== "codex" || !Array.isArray(record.sessions)) {
    throw new Error("Invalid Codex adapter evidence");
  }
  for (const candidate of record.sessions) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("Invalid Codex adapter evidence session");
    const session = candidate as Record<string, unknown>;
    if (typeof session.session_id !== "string" || typeof session.project_id !== "string") throw new Error("Invalid Codex adapter evidence session");
    assertSafeId(session.session_id, "Codex evidence session id");
    assertSafeId(session.project_id, "Codex evidence project id");
    if (record.schema_version === 2 && (typeof session.runtime_identity !== "string" || !/^[a-f0-9]{64}$/.test(session.runtime_identity))) {
      throw new Error("Invalid Codex adapter evidence runtime");
    }
    assertIsoTimestamp(session.first_observed_at);
    assertIsoTimestamp(session.last_observed_at);
    if (!session.events || typeof session.events !== "object" || Array.isArray(session.events)) throw new Error("Invalid Codex adapter evidence events");
    for (const [event, detail] of Object.entries(session.events)) {
      if (!CODEX_LIVE_EVENTS.includes(event as typeof CODEX_LIVE_EVENTS[number]) || !detail || typeof detail !== "object" || Array.isArray(detail)) {
        throw new Error("Invalid Codex adapter evidence event");
      }
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
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error("Invalid Codex adapter evidence timestamp");
}
