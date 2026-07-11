import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { correctMemory, effectiveMemoryStates, appendMemoryControl } from "./memory-events.js";
import { processQueue } from "./processing.js";
import { search } from "./search.js";

test("records correction without mutating old memory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-correction-"));
  await capture(root, { projectId: "p_test", sessionId: "s1", turnId: "t1", role: "user", content: "决定使用 SQLite", sourceAgent: "test", explicit: true });
  await processQueue(root);
  const old = (await search(root, { projectId: "p_test", query: "SQLite" }))[0]!;
  const result = await correctMemory(root, "p_test", old.source, { summary: "纠正：当前决定使用本地 JSON 文件", evidenceRefs: ["evt_correction"] });
  const states = await effectiveMemoryStates(root, "p_test");
  assert.equal(states.get(old.source)?.status, "superseded");
  assert.equal(states.get(old.source)?.replacement_memory_id, result.memory.id);
  assert.equal(result.memory.supersedes[0], old.source);
});

test("control events require evidence for correction and delete", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-correction-"));
  await assert.rejects(appendMemoryControl(root, { kind: "delete", project_id: "p", target_memory_id: "mem_x", evidence_refs: [] }), /requires evidence/);
});
