import assert from "node:assert/strict";
import test from "node:test";
import { assertCodexAdapterEvidence } from "./adapter-evidence.js";

test("legacy and runtime-bound adapter evidence remain readable compatibility inputs", () => {
  for (const value of [
    {
      schema_version: 1,
      adapter: "codex",
      sessions: [{
        session_id: "legacy-session",
        project_id: "legacy-project",
        first_observed_at: "2026-01-01T00:00:00.000Z",
        last_observed_at: "2026-01-01T00:00:00.000Z",
        events: { SessionStart: { observed_at: "2026-01-01T00:00:00.000Z" } }
      }]
    },
    {
      schema_version: 2,
      adapter: "codex",
      sessions: [{
        session_id: "bound-session",
        project_id: "bound-project",
        runtime_identity: "f".repeat(64),
        first_observed_at: "2026-01-01T00:00:00.000Z",
        last_observed_at: "2026-01-01T00:00:00.000Z",
        events: { Stop: { observed_at: "2026-01-01T00:00:00.000Z", captured_event_id: "evt_bound" } }
      }]
    }
  ]) assert.doesNotThrow(() => assertCodexAdapterEvidence(value));
});
