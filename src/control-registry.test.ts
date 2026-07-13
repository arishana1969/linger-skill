import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { correct, forget } from "./control.js";
import { deleteRecord } from "./delete.js";
import { processQueue } from "./processing.js";
import { search } from "./search.js";
import { readTagRegistry } from "./tag-registry.js";

async function memory(root: string, content: string, query: string): Promise<string> {
  await capture(root, { projectId: "p", sessionId: "s", turnId: query, role: "user", content, sourceAgent: "test" });
  await processQueue(root);
  return (await search(root, { projectId: "p", query }))[0]!.source;
}

test("forget rebuilds candidates without revoked tags", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-control-registry-"));
  const id = await memory(root, "registry-forget-zephyr durable", "registry-forget-zephyr");
  assert.ok((await readTagRegistry(root, "p"))?.entries.some(entry => entry.normalized_tag === "registry-forget-zephyr"));
  await forget(root, "p", id);
  assert.equal((await readTagRegistry(root, "p"))?.entries.some(entry => entry.normalized_tag === "registry-forget-zephyr"), false);
});

test("processed delete and correction rebuild active tag candidates", async () => {
  const deleteRoot = await mkdtemp(path.join(os.tmpdir(), "linger-control-registry-"));
  const deleted = await memory(deleteRoot, "registry-delete-zephyr durable", "registry-delete-zephyr");
  await deleteRecord(deleteRoot, { projectId: "p", target: "processed", id: deleted, confirmed: true });
  assert.equal((await readTagRegistry(deleteRoot, "p"))?.entries.some(entry => entry.normalized_tag === "registry-delete-zephyr"), false);

  const correctRoot = await mkdtemp(path.join(os.tmpdir(), "linger-control-registry-"));
  const old = await memory(correctRoot, "registry-old-zephyr durable", "registry-old-zephyr");
  await correct(correctRoot, "p", old, "registry-new-zephyr corrected", ["evt_visible"]);
  const tags = (await readTagRegistry(correctRoot, "p"))?.entries.map(entry => entry.normalized_tag) ?? [];
  assert.equal(tags.includes("registry-old-zephyr"), false);
  assert.equal(tags.includes("registry-new-zephyr"), true);
});
