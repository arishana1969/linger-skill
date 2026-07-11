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
  const vault = await mkdtemp(path.join(os.tmpdir(), "continuity-cli-"));
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

async function run(args: string[]): Promise<string> { return (await exec(node, [cli, ...args])).stdout.trim(); }
