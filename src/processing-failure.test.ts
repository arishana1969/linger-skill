import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { doctor } from "./doctor.js";
import { vaultPaths } from "./paths.js";
import { processQueue } from "./processing.js";
import { search } from "./search.js";

test("corrupt queue item does not block valid work", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-process-failure-"));
  const bad = path.join(vaultPaths(root).queue, "p", "bad.json");
  await mkdir(path.dirname(bad), { recursive: true });
  await writeFile(bad, "not-json");
  await capture(root, { projectId: "p", sessionId: "s", turnId: "t", role: "user", content: "valid queue work", sourceAgent: "test" });
  assert.deepEqual(await processQueue(root), { processed: 1, failed: 0 });
  assert.match((await search(root, { projectId: "p", query: "valid queue" }))[0]?.snippet ?? "", /valid/);
  assert.equal((await doctor(root)).errors.some(error => error.startsWith("invalid_queue:")), true);
});

test("schema-invalid raw file does not block a valid queued event", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-process-raw-failure-"));
  const bad = path.join(vaultPaths(root).raw, "p", "bad.json");
  await mkdir(path.dirname(bad), { recursive: true });
  await writeFile(bad, JSON.stringify({ schema_version: 1, event_id: "bad" }));
  await capture(root, { projectId: "p", sessionId: "s", turnId: "t", role: "user", content: "valid raw isolation work", sourceAgent: "test" });
  assert.deepEqual(await processQueue(root, "p"), { processed: 1, failed: 0 });
  assert.match((await search(root, { projectId: "p", query: "valid raw isolation" }))[0]?.snippet ?? "", /valid raw/);
  assert.equal((await doctor(root)).errors.some(error => error.startsWith("invalid_raw:")), true);
});
