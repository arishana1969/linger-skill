import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { resolveEffectiveSearchDocuments } from "./effective-search-document.js";
import { processQueue } from "./processing.js";
import { search } from "./search.js";
import { vaultPaths } from "./paths.js";

test("requires every source in a multi-source memory to verify", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-effective-document-"));
  const first = await capture(root, { projectId: "p", sessionId: "s", turnId: "t1", role: "user", content: "multi-source-orchid primary evidence", sourceAgent: "test" });
  const second = await capture(root, { projectId: "p", sessionId: "s", turnId: "t2", role: "user", content: "multi-source-orchid supporting evidence", sourceAgent: "test" });
  await processQueue(root);

  const p = vaultPaths(root);
  const memoryId = `mem_${createHash("sha256").update(first!.event_id).digest("hex").slice(0, 24)}`;
  const memoryFile = path.join(p.processed, "p", `${memoryId}.json`);
  const memory = JSON.parse(await readFile(memoryFile, "utf8")) as Record<string, unknown>;
  memory.source_events = [first!.event_id, second!.event_id];
  await writeFile(memoryFile, `${JSON.stringify(memory, null, 2)}\n`);

  const before = (await resolveEffectiveSearchDocuments(root, "p")).find(document => document.memory_id === memoryId)!;
  assert.equal(before.integrity, "verified");
  assert.equal(before.eligibility.lexical_default, true);

  const secondFile = path.join(root, second!.raw_ref);
  const raw = JSON.parse(await readFile(secondFile, "utf8")) as Record<string, unknown>;
  raw.content = "tampered supporting evidence";
  await writeFile(secondFile, `${JSON.stringify(raw, null, 2)}\n`);

  const after = (await resolveEffectiveSearchDocuments(root, "p")).find(document => document.memory_id === memoryId)!;
  assert.equal(after.integrity, "tampered");
  assert.equal(after.eligibility.lexical_default, false);
  assert.ok(after.ineligible_reasons.includes("tampered_source"));
  assert.equal((await search(root, { projectId: "p", query: "primary evidence" })).some(hit => hit.source === memoryId), false);
});
