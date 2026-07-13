import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { forget } from "./control.js";
import { doctor } from "./doctor.js";
import { processQueue } from "./processing.js";
import { search } from "./search.js";
import { initVault, setPaused, vaultStats } from "./vault.js";

async function fixture(): Promise<string> { return await mkdtemp(path.join(os.tmpdir(), "linger-")); }

test("captures, deduplicates, processes, and recalls a Chinese decision", async () => {
  const root = await fixture();
  await initVault(root);
  const input = { projectId: "p_test", sessionId: "s_001", turnId: "t_001", role: "user" as const, content: "我们决定暂时不做 MCP，因为需要先验证本地文件方案。", sourceAgent: "test", explicit: true };
  const first = await capture(root, input);
  const duplicate = await capture(root, input);
  assert.equal(first?.event_id, duplicate?.event_id);
  assert.equal((await vaultStats(root)).raw_events, 1);
  assert.deepEqual(await processQueue(root), { processed: 1, failed: 0 });
  const hits = await search(root, { projectId: "p_test", query: "为什么不做 MCP" });
  assert.ok(hits[0]);
  assert.notEqual(hits[0]?.match_type, "unprocessed_raw");
  assert.match(hits[0]?.snippet ?? "", /本地文件/);
  assert.equal((await doctor(root)).ok, true);
});

test("isolates projects, skips secrets, supports forget and pause", async () => {
  const root = await fixture();
  await capture(root, { projectId: "p_alpha", sessionId: "s1", turnId: "t1", role: "user", content: "选择 SQLite 作为本地存储", sourceAgent: "test" });
  await capture(root, { projectId: "p_beta", sessionId: "s1", turnId: "t1", role: "user", content: "选择 PostgreSQL 作为云端存储", sourceAgent: "test" });
  await capture(root, { projectId: "p_alpha", sessionId: "s1", turnId: "t2", role: "user", content: "API_KEY=secret-value", sourceAgent: "test", sensitivity: "secret" });
  await processQueue(root);
  assert.equal((await search(root, { projectId: "p_alpha", query: "PostgreSQL" })).length, 0);
  assert.equal((await search(root, { projectId: "p_alpha", query: "secret-value", includeRaw: true })).length, 0);
  const sqlite = await search(root, { projectId: "p_alpha", query: "SQLite" });
  await forget(root, "p_alpha", sqlite[0]!.source);
  assert.equal((await search(root, { projectId: "p_alpha", query: "SQLite" })).length, 0);
  await setPaused(root, true);
  assert.equal(await capture(root, { projectId: "p_alpha", sessionId: "s1", turnId: "t3", role: "user", content: "should skip", sourceAgent: "test" }), undefined);
});

test("doctor detects tampered raw content", async () => {
  const root = await fixture();
  const event = await capture(root, { projectId: "p_test", sessionId: "s1", turnId: "t1", role: "user", content: "original", sourceAgent: "test" });
  const file = path.join(root, event!.raw_ref);
  const parsed = JSON.parse(await readFile(file, "utf8"));
  parsed.content = "changed";
  await writeFile(file, JSON.stringify(parsed));
  const report = await doctor(root);
  assert.equal(report.ok, true);
  assert.equal(report.warnings.some(value => value.startsWith("tampered:")), true);
});
