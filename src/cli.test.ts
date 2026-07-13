import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const node = process.execPath;
const cli = path.resolve("dist/cli.js");

test("CLI runs capture to recall and decision trail in separate processes", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "linger-cli-"));
  await run(["init", "--vault", vault]);
  await run(["capture", "--vault", vault, "--project", "p_cli", "--session", "s1", "--turn", "t1", "--role", "user", "--content", "决定先使用本地文件", "--explicit"]);
  await run(["process", "--vault", vault]);
  const recalled = await run(["search", "--vault", vault, "--project", "p_cli", "--query", "本地文件"]);
  assert.match(recalled, /决定先使用本地文件/);
  const captured = JSON.parse(await run(["capture", "--vault", vault, "--project", "p_cli", "--session", "s1", "--turn", "t2", "--role", "user", "--content", "数据库方案证据"]));
  await run(["decision-add", "--vault", vault, "--project", "p_cli", "--topic", "storage", "--statement", "Use files", "--source", "user_explicit", "--confidence", "1", "--evidence", captured.event_id]);
  const trail = JSON.parse(await run(["decision-get", "--vault", vault, "--project", "p_cli", "--topic", "storage"]));
  assert.equal(trail.view.current_state, "Use files");
});

test("CLI accepts the global Vault option before the command", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "linger-cli-global-vault-"));
  const initialized = JSON.parse(await run(["--vault", vault, "init"])) as { schema_version: number };
  assert.equal(initialized.schema_version, 1);
});

test("CLI reuses recent hook-owned explicit evidence and refuses duplicate decision-add", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "linger-cli-hook-owned-"));
  const { capture } = await import("./capture.js");
  const hook = await capture(vault, {
    projectId: "p_owned", sessionId: "live", turnId: "turn", role: "user",
    content: "请用 Linger 记一下：最终验收代号是 aurora-ds-418。完成后继续主任务。",
    sourceAgent: "claude-code", explicit: true, timestamp: new Date().toISOString()
  });
  const reused = JSON.parse(await run(["capture", "--vault", vault, "--project", "p_owned", "--session", "manual", "--turn", "manual", "--role", "user", "--content", "最终验收代号是 aurora-ds-418"]));
  assert.equal(reused.event_id, hook!.event_id);
  const status = JSON.parse(await run(["status", "--vault", vault]));
  assert.equal(status.raw_events, 1);
  await assert.rejects(run(["decision-add", "--vault", vault, "--project", "p_owned", "--topic", "release", "--statement", "aurora-ds-418", "--source", "user_explicit", "--confidence", "1", "--evidence", hook!.event_id]), /already owned by automatic processing/);
});

async function run(args: string[]): Promise<string> { return (await exec(node, [cli, ...args])).stdout.trim(); }
