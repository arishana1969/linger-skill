import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { correct, forget, inspect } from "./control.js";
import { processQueue } from "./processing.js";
import { search } from "./search.js";
import { vaultPaths } from "./paths.js";

test("forget removes recall without mutating committed memory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-control-"));
  await capture(root, { projectId: "p_test", sessionId: "s1", turnId: "t1", role: "user", content: "选择旧方案 Alpha", sourceAgent: "test" });
  await processQueue(root);
  const hit = (await search(root, { projectId: "p_test", query: "Alpha" }))[0]!;
  const file = path.join(vaultPaths(root).processed, "p_test", `${hit.source}.json`);
  const before = await readFile(file, "utf8");
  await forget(root, "p_test", hit.source);
  assert.equal((await search(root, { projectId: "p_test", query: "Alpha" })).length, 0);
  assert.equal(await readFile(file, "utf8"), before);
  assert.equal((await inspect(root, "p_test", hit.source)).effective_status, "revoked");
});

test("correction supersedes old recall and exposes replacement", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-control-"));
  await capture(root, { projectId: "p_test", sessionId: "s1", turnId: "t1", role: "user", content: "数据库用 SQLite", sourceAgent: "test" });
  await processQueue(root);
  const old = (await search(root, { projectId: "p_test", query: "SQLite" }))[0]!;
  const evidence = await capture(root, { projectId: "p_test", sessionId: "s1", turnId: "t2", role: "user", content: "纠正证据：数据库改为 JSON 文件", sourceAgent: "test" });
  const replacement = await correct(root, "p_test", old.source, "纠正：数据库使用 JSON 文件", [evidence!.event_id]);
  assert.equal((await search(root, { projectId: "p_test", query: "SQLite" })).length, 0);
  assert.match((await search(root, { projectId: "p_test", query: "JSON 文件" }))[0]?.snippet ?? "", /纠正/);
  assert.equal((await inspect(root, "p_test", old.source)).effective_status, "superseded");
  assert.equal(replacement.memory.supersedes[0], old.source);
});
