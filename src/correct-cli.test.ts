import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const cli = path.resolve("dist/cli.js");
async function run(args: string[]): Promise<unknown> { return JSON.parse((await exec(process.execPath, [cli, ...args])).stdout); }

test("CLI correct supersedes rather than edits old memory", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "continuity-correct-cli-"));
  const event = await run(["capture", "--vault", vault, "--project", "p_cli", "--session", "s1", "--turn", "t1", "--role", "user", "--content", "决定使用旧缓存方案"]) as { event_id: string };
  await run(["process", "--vault", vault]);
  const old = (await run(["search", "--vault", vault, "--project", "p_cli", "--query", "旧缓存"]) as Array<{ source: string }>)[0]!;
  const result = await run(["correct", "--vault", vault, "--project", "p_cli", "--memory", old.source, "--summary", "纠正：使用无缓存方案", "--evidence", event.event_id]) as { memory: { supersedes: string[] } };
  assert.equal(result.memory.supersedes[0], old.source);
  const inspected = await run(["inspect", "--vault", vault, "--project", "p_cli", "--memory", old.source]) as { effective_status: string };
  assert.equal(inspected.effective_status, "superseded");
});
