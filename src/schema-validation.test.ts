import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { doctor } from "./doctor.js";
import { vaultPaths } from "./paths.js";
import { processQueue } from "./processing.js";
import { quarantineInvalidFiles } from "./repair.js";
import { search } from "./search.js";
import { rebuildTagRegistry } from "./tag-registry.js";
import { initVault, vaultStats } from "./vault.js";

test("valid JSON with invalid schemas is skipped, diagnosed, counted, and quarantined", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-schema-validation-"));
  await initVault(root);
  const p = vaultPaths(root);
  const files = [
    path.join(p.raw, "p", "bad.json"),
    path.join(p.processed, "p", "bad.json"),
    path.join(p.queue, "p", "bad.json"),
    path.join(p.tmp, "pending", "p", "bad.json")
  ];
  for (const file of files) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ schema_version: 1, id: "looks-like-json" }));
  }
  assert.deepEqual(await search(root, { projectId: "p", query: "looks-like-json" }), []);
  assert.deepEqual(await processQueue(root, "p"), { processed: 0, failed: 0 });
  assert.equal((await rebuildTagRegistry(root, "p")).skipped_files.length, 1);
  assert.equal((await vaultStats(root)).queue_invalid, 1);
  const before = await doctor(root);
  assert.equal(before.ok, false);
  assert.equal(before.errors.some(value => value.startsWith("invalid_raw:")), true);
  assert.equal(before.errors.some(value => value.startsWith("invalid_processed:")), true);
  assert.equal(before.errors.some(value => value.startsWith("invalid_queue:")), true);
  assert.equal(before.errors.some(value => value.startsWith("invalid_pending:")), true);
  const repaired = await quarantineInvalidFiles(root);
  assert.equal(repaired.quarantined.length, 4);
  assert.equal((await doctor(root)).ok, true);
});
