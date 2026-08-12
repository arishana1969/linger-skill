import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { processQueue } from "./processing.js";
import { search } from "./search.js";

test("excludes processed memory whose raw source was tampered", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-search-integrity-"));
  const event = await capture(root, { projectId: "p", sessionId: "s", turnId: "t", role: "user", content: "tamper-zephyr original", sourceAgent: "test" });
  await processQueue(root);
  const raw = path.join(root, event!.raw_ref);
  const document = JSON.parse(await readFile(raw, "utf8"));
  document.content = "tamper-zephyr changed";
  await writeFile(raw, JSON.stringify(document));
  assert.deepEqual(await search(root, { projectId: "p", query: "tamper-zephyr" }), []);
});

test("fails closed when a processed memory loses its raw source", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-search-integrity-"));
  const event = await capture(root, { projectId: "p", sessionId: "s", turnId: "t", role: "user", content: "deleted-raw-zephyr retained summary", sourceAgent: "test" });
  await processQueue(root);
  await rm(path.join(root, event!.raw_ref));
  assert.deepEqual(await search(root, { projectId: "p", query: "deleted-raw-zephyr" }), []);
});
