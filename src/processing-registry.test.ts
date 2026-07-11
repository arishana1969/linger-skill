import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { processQueue } from "./processing.js";
import { readTagRegistry } from "./tag-registry.js";

test("processing refreshes tag registry once for touched project", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-processing-tags-"));
  await capture(root, { projectId: "p", sessionId: "s", turnId: "t", role: "user", content: "storage registry", sourceAgent: "test" });
  await processQueue(root);
  const registry = await readTagRegistry(root, "p");
  assert.equal(registry?.entries.some(entry => entry.normalized_tag === "storage"), true);
});
