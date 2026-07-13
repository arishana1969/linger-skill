import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { doctor } from "./doctor.js";
import { vaultPaths } from "./paths.js";
import { processQueue } from "./processing.js";
import { recall } from "./recall.js";
import { quarantineInvalidFiles } from "./repair.js";
import { rebuildTagRegistry } from "./tag-registry.js";

test("invalid derived tag registry does not block evidence recall and can be repaired", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-tag-integrity-"));
  await capture(root, { projectId: "p", sessionId: "s", turnId: "t", role: "user", content: "registry-zephyr durable evidence", sourceAgent: "test" });
  await processQueue(root);
  const file = path.join(vaultPaths(root).registry, "tags", "p.json");
  await writeFile(file, JSON.stringify({ schema_version: 1, project_id: "p", entries: "invalid" }));
  const recalled = await recall(root, { projectId: "p", query: "registry-zephyr" });
  assert.equal(recalled.hits.length, 1);
  assert.equal((await doctor(root)).errors.some(value => value.startsWith("invalid_tag_registry:")), true);
  assert.equal((await quarantineInvalidFiles(root)).quarantined.length, 1);
  assert.equal((await doctor(root)).ok, true);
  assert.ok((await rebuildTagRegistry(root, "p")).entries.length > 0);
});
