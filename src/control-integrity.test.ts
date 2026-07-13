import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { correct, forget, inspect } from "./control.js";
import { deleteLastRecord, deleteRecord } from "./delete.js";
import { vaultPaths } from "./paths.js";
import { processQueue } from "./processing.js";
import { search } from "./search.js";

test("control operations reject a processed record whose identity disagrees with its path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-control-integrity-"));
  await capture(root, { projectId: "p_alpha", sessionId: "s", turnId: "t", role: "user", content: "control-integrity sentinel", sourceAgent: "test" });
  await processQueue(root, "p_alpha");
  const hit = (await search(root, { projectId: "p_alpha", query: "control-integrity" }))[0]!;
  const p = vaultPaths(root);
  const file = path.join(p.processed, "p_alpha", `${hit.source}.json`);
  const memory = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  memory.project_id = "p_beta";
  await writeFile(file, JSON.stringify(memory));

  await assert.rejects(inspect(root, "p_alpha", hit.source), /Invalid processed record path/);
  await assert.rejects(forget(root, "p_alpha", hit.source), /Invalid processed record path/);
  await assert.rejects(correct(root, "p_alpha", hit.source, "corrected", ["evt_visible"]), /Invalid processed record path/);
  await assert.rejects(deleteRecord(root, { projectId: "p_alpha", target: "processed", id: hit.source, confirmed: true }), /Invalid processed record path/);
  await access(file);
  await assert.rejects(access(path.join(p.processed, "p_beta")));
});

test("delete-last skips invalid processed records and deletes only the latest valid record", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-control-integrity-"));
  await capture(root, { projectId: "p", sessionId: "s1", turnId: "t1", role: "user", content: "older valid", sourceAgent: "test", timestamp: "2026-01-01T00:00:00.000Z" });
  await capture(root, { projectId: "p", sessionId: "s2", turnId: "t2", role: "user", content: "newer valid", sourceAgent: "test", timestamp: "2026-02-01T00:00:00.000Z" });
  await processQueue(root, "p");
  const older = (await search(root, { projectId: "p", query: "older valid" }))[0]!.source;
  const newer = (await search(root, { projectId: "p", query: "newer valid" }))[0]!.source;
  const bad = path.join(vaultPaths(root).processed, "p", "bad.json");
  await mkdir(path.dirname(bad), { recursive: true });
  await writeFile(bad, JSON.stringify({ schema_version: 1, id: "bad", created_at: "9999-01-01T00:00:00.000Z" }));

  const deleted = await deleteLastRecord(root, { projectId: "p", target: "processed", confirmed: true });
  assert.equal(deleted.id, newer);
  await access(path.join(vaultPaths(root).processed, "p", `${older}.json`));
  await assert.rejects(access(path.join(vaultPaths(root).processed, "p", `${newer}.json`)));
  await access(bad);
});
