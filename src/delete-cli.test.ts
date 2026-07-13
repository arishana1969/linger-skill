import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const cli = path.resolve("dist/cli.js");

test("CLI delete refuses unconfirmed request and accepts --yes", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "linger-delete-cli-"));
  await exec(process.execPath, [cli, "capture", "--vault", vault, "--project", "p_cli", "--session", "s", "--turn", "t", "--role", "user", "--content", "待删除记录"]);
  await exec(process.execPath, [cli, "process", "--vault", vault]);
  const hits = JSON.parse((await exec(process.execPath, [cli, "search", "--vault", vault, "--project", "p_cli", "--query", "待删除"])).stdout) as Array<{ source: string }>;
  const base = [cli, "delete", "--vault", vault, "--project", "p_cli", "--type", "processed", "--id", hits[0]!.source];
  await assert.rejects(exec(process.execPath, base), /confirmation/);
  const deleted = JSON.parse((await exec(process.execPath, [...base, "--yes"])).stdout);
  assert.equal(deleted.deleted, true);
});

test("CLI typo in delete target cannot delete a raw event", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "linger-delete-cli-target-"));
  const captured = JSON.parse((await exec(process.execPath, [cli, "capture", "--vault", vault, "--project", "p_cli", "--session", "s", "--turn", "t", "--role", "user", "--content", "keep raw"])).stdout) as { event_id: string; raw_ref: string };
  await assert.rejects(exec(process.execPath, [cli, "delete", "--vault", vault, "--project", "p_cli", "--type", "processd", "--id", captured.event_id, "--yes"]), /target must be processed or raw/);
  await access(path.join(vault, captured.raw_ref));
});

test("CLI delete-last removes only the latest raw event after confirmation", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "linger-delete-last-cli-"));
  const first = JSON.parse((await exec(process.execPath, [cli, "capture", "--vault", vault, "--project", "p", "--session", "s1", "--turn", "t1", "--role", "user", "--content", "first"])).stdout) as { event_id: string; raw_ref: string };
  const second = JSON.parse((await exec(process.execPath, [cli, "capture", "--vault", vault, "--project", "p", "--session", "s2", "--turn", "t2", "--role", "user", "--content", "second"])).stdout) as { event_id: string; raw_ref: string };
  await assert.rejects(exec(process.execPath, [cli, "delete-last", "--vault", vault, "--project", "p", "--type", "raw"]), /confirmation/);
  const deleted = JSON.parse((await exec(process.execPath, [cli, "delete-last", "--vault", vault, "--project", "p", "--type", "raw", "--yes"])).stdout) as { id: string };
  assert.equal(deleted.id, second.event_id);
  await access(path.join(vault, first.raw_ref));
  await assert.rejects(access(path.join(vault, second.raw_ref)));
});
