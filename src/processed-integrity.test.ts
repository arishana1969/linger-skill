import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { doctor } from "./doctor.js";
import { processQueue } from "./processing.js";
import { vaultPaths } from "./paths.js";
import { listJsonFiles } from "./vault.js";

test("doctor links processed memory to immutable raw hash", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-integrity-"));
  await capture(root, { projectId: "p", sessionId: "s", turnId: "t", role: "user", content: "integrity source", sourceAgent: "test" });
  await processQueue(root);
  assert.equal((await doctor(root)).warnings.some(value => value.startsWith("processed_source_mismatch")), false);
  const rawFile = (await listJsonFiles(vaultPaths(root).raw))[0]!;
  const raw = JSON.parse(await readFile(rawFile, "utf8"));
  raw.content = "tampered source";
  await writeFile(rawFile, JSON.stringify(raw));
  const report = await doctor(root);
  assert.equal(report.warnings.some(value => value.startsWith("processed_source_mismatch")), true);
});
