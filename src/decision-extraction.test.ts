import assert from "node:assert/strict";
import test from "node:test";
import { decisionFromEvent } from "./decision-extraction.js";
import type { RawEvent } from "./types.js";

test("extracts explicit database decision from visible user evidence", () => {
  const event = { schema_version: 1, event_id: "evt", session_id: "s", project_id: "p", seq_id: 1, turn_id: "t", role: "user", timestamp: "2025-01-01T00:00:00.000Z", source_agent: "test", content: "当前数据库决定：继续使用 SQLite", content_hash: "h", savepoint_status: "complete", capture_status: "captured", sensitivity: "normal", raw_ref: "raw" } satisfies RawEvent;
  const result = decisionFromEvent(event);
  assert.equal(result.topic, "database");
  assert.equal(result.status, "current");
  assert.equal(result.source, "user_explicit");
  assert.deepEqual(result.evidenceRefs, ["evt"]);
});

test("preserves correction kind for an automatic decision event", () => {
  const result = decisionFromEvent({ schema_version: 1, event_id: "evt_c", session_id: "s", project_id: "p", seq_id: 2, turn_id: "t", role: "user", timestamp: "2026-01-02T00:00:00.000Z", source_agent: "test", content: "Correction: current adapter decision is webhooks", content_hash: "hash", savepoint_status: "complete", capture_status: "captured", sensitivity: "normal", raw_ref: "raw/p/x.json" });
  assert.equal(result.kind, "correction");
  assert.equal(result.status, "current");
  assert.equal(result.topic, "adapter");
});

test("keeps database cache decisions separate from primary database decisions", () => {
  const base = { schema_version: 1, event_id: "evt", session_id: "s", project_id: "p", seq_id: 1, turn_id: "t", role: "user", timestamp: "2025-01-01T00:00:00.000Z", source_agent: "test", content_hash: "h", savepoint_status: "complete", capture_status: "captured", sensitivity: "normal", raw_ref: "raw" } as const;
  const primary = decisionFromEvent({ ...base, content: "当前数据库决定使用 SQLite" });
  const cache = decisionFromEvent({ ...base, event_id: "evt2", content: "当前数据库缓存决定使用 Redis" });
  assert.equal(primary.topic, "database");
  assert.equal(cache.topic, "database-cache");
});
