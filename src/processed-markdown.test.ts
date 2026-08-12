import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { processQueue } from "./processing.js";
import { vaultPaths } from "./paths.js";

test("processing writes the human-readable Markdown view with provenance", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-markdown-"));
  await capture(root, { projectId: "p", sessionId: "s", turnId: "t", role: "user", content: "Markdown processed decision", sourceAgent: "test" });
  await processQueue(root);
  const name = (await readdir(path.join(vaultPaths(root).processed, "p"))).find(file => file.endsWith(".md"));
  const content = await readFile(path.join(vaultPaths(root).processed, "p", name!), "utf8");
  assert.match(content, /^---\nschema_version:/);
  assert.match(content, /source_events:/);
  assert.match(content, /source_hash:/);
  assert.match(content, /source_savepoint_status: "complete"/);
  assert.match(content, /# Markdown processed decision/);
});
