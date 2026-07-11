import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const cli = path.resolve("dist/cli.js");

test("CLI delete refuses unconfirmed request and accepts --yes", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "continuity-delete-cli-"));
  await exec(process.execPath, [cli, "capture", "--vault", vault, "--project", "p_cli", "--session", "s", "--turn", "t", "--role", "user", "--content", "待删除记录"]);
  await exec(process.execPath, [cli, "process", "--vault", vault]);
  const hits = JSON.parse((await exec(process.execPath, [cli, "search", "--vault", vault, "--project", "p_cli", "--query", "待删除"])).stdout) as Array<{ source: string }>;
  const base = [cli, "delete", "--vault", vault, "--project", "p_cli", "--type", "processed", "--id", hits[0]!.source];
  await assert.rejects(exec(process.execPath, base), /confirmation/);
  const deleted = JSON.parse((await exec(process.execPath, [...base, "--yes"])).stdout);
  assert.equal(deleted.deleted, true);
});
