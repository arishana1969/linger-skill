import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appendDecision, listDecisionViews } from "./decisions.js";
import { doctor } from "./doctor.js";
import { vaultPaths } from "./paths.js";
import { recall } from "./recall.js";
import { quarantineInvalidFiles } from "./repair.js";

test("invalid decision topic is skipped by recall, diagnosed, and quarantined", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-decision-integrity-"));
  await appendDecision(root, { projectId: "p", topic: "runtime", kind: "decision", status: "current", statement: "Use Node", source: "user_explicit", confidence: 1, evidenceRefs: ["evt_visible"] });
  const invalid = path.join(vaultPaths(root).decisions, "p", "d_invalid", "current.json");
  await mkdir(path.dirname(invalid), { recursive: true });
  await writeFile(invalid, JSON.stringify({ schema_version: 1, topic: "poisoned" }));
  assert.deepEqual((await listDecisionViews(root, "p")).map(view => view.topic), ["runtime"]);
  const result = await recall(root, { projectId: "p", query: "unmatched-nebula" });
  assert.equal(result.classification, "no_reliable_memory_found");
  assert.deepEqual(result.candidates.topics, ["runtime"]);
  assert.equal((await doctor(root)).errors.some(value => value.startsWith("invalid_decision:")), true);
  assert.equal((await quarantineInvalidFiles(root)).quarantined.length, 1);
  assert.equal((await doctor(root)).ok, true);
});
