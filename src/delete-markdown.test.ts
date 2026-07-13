import assert from "node:assert/strict";
import { access, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { deleteRecord } from "./delete.js";
import { processQueue } from "./processing.js";
import { search } from "./search.js";
import { vaultPaths } from "./paths.js";

test("processed delete removes JSON and Markdown representations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-delete-md-"));
  await capture(root, { projectId: "p", sessionId: "s", turnId: "t", role: "user", content: "delete markdown", sourceAgent: "test" });
  await processQueue(root);
  const id = (await search(root, { projectId: "p", query: "delete markdown" }))[0]!.source;
  const base = path.join(vaultPaths(root).processed, "p", id);
  await access(`${base}.json`);
  await access(`${base}.md`);
  await deleteRecord(root, { projectId: "p", target: "processed", id, confirmed: true });
  await assert.rejects(access(`${base}.json`));
  await assert.rejects(access(`${base}.md`));
});
