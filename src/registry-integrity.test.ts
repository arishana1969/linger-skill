import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { doctor } from "./doctor.js";
import { vaultPaths } from "./paths.js";
import { processQueue } from "./processing.js";
import { recall } from "./recall.js";
import { quarantineInvalidFiles } from "./repair.js";
import { search } from "./search.js";

test("invalid memory controls and term relations do not block valid recall", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-registry-integrity-"));
  await capture(root, { projectId: "p", sessionId: "s", turnId: "t", role: "user", content: "registry-aurora durable evidence", sourceAgent: "test" });
  await processQueue(root);
  const p = vaultPaths(root);
  const files = [
    path.join(p.registry, "memory-events", "p", "invalid.json"),
    path.join(p.registry, "term-graph", "p", "invalid.json")
  ];
  for (const file of files) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ schema_version: 1, project_id: "p", kind: "poison" }));
  }
  assert.equal((await search(root, { projectId: "p", query: "registry-aurora" })).length, 1);
  assert.equal((await recall(root, { projectId: "p", query: "registry-aurora" })).hits.length, 1);
  const report = await doctor(root);
  assert.equal(report.errors.some(value => value.startsWith("invalid_memory_control:")), true);
  assert.equal(report.errors.some(value => value.startsWith("invalid_term_relation:")), true);
  assert.equal((await quarantineInvalidFiles(root)).quarantined.length, 2);
  assert.equal((await doctor(root)).ok, true);
});
