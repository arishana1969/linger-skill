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

test("CLI manages tag registry and term graph recall", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "continuity-index-cli-"));
  await run(["capture", "--vault", vault, "--project", "p", "--session", "s", "--turn", "t", "--role", "user", "--content", "database migration"]);
  await run(["process", "--vault", vault]);
  const registry = await run(["tags-rebuild", "--vault", vault, "--project", "p"]) as { entries: unknown[] };
  assert.ok(registry.entries.length);
  await run(["term-add", "--vault", vault, "--project", "p", "--term-a", "db", "--term-b", "database", "--relation", "abbreviation", "--confidence", "0.9", "--evidence", "mem_1"]);
  const hits = await run(["search", "--vault", vault, "--project", "p", "--query", "db"]) as Array<{ warning_flags: string[] }>;
  assert.deepEqual(hits[0]?.warning_flags, ["term_expansion"]);
});
