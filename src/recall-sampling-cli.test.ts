import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);
const cli = path.join(process.cwd(), "dist", "cli.js");

test("CLI samples recall only with opt-in and accepts feedback", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "linger-recall-sampling-cli-"));
  const project = "p";
  await run(["capture", "--vault", vault, "--project", project, "--session", "s", "--turn", "t", "--role", "user", "--content", "sampling-zephyr durable choice", "--explicit"]);
  await run(["process", "--vault", vault, "--project", project]);
  const ordinary = await run(["recall", "--vault", vault, "--project", project, "--query", "sampling-zephyr"]);
  assert.equal("attempt_id" in ordinary, false);
  const sampled = await run(["recall", "--vault", vault, "--project", project, "--query", "sampling-zephyr", "--sample"]);
  assert.match(sampled.attempt_id as string, /^ra_[a-f0-9]{32}$/);
  await run(["recall-feedback", "--vault", vault, "--project", project, "--attempt", sampled.attempt_id as string, "--outcome", "useful", "--decision-used"]);
  const report = await run(["recall-samples", "--vault", vault, "--project", project]);
  assert.equal(report.total_attempts, 1);
  assert.equal((report.outcomes as Record<string, number>).useful, 1);
  assert.equal(report.decision_trail_used, 1);
});

async function run(args: string[]): Promise<Record<string, unknown>> {
  return JSON.parse((await exec(process.execPath, [cli, ...args])).stdout) as Record<string, unknown>;
}
