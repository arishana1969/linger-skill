import assert from "node:assert/strict";
import test from "node:test";
import { generateYearDataset } from "./eval-generator.js";

test("generates deterministic year-long events and hidden oracle", () => {
  const first = generateYearDataset(2025);
  assert.deepEqual(first, generateYearDataset(2025));
  assert.equal(first.events.filter(event => event.project_id === "p_continuity").length, 98);
  assert.equal(new Set(first.events.map(event => event.event_id)).size, first.events.length);
  assert.equal(first.oracle.some(query => query.forbidden_evidence.includes("evt_other_pg")), true);
  assert.equal(first.events.some(event => event.expected_sensitivity === "secret"), true);
  assert.equal(first.events.some(event => event.save === false), true);
  assert.equal(Date.parse(first.end) - Date.parse(first.start) > 360 * 24 * 60 * 60 * 1000, true);
});
