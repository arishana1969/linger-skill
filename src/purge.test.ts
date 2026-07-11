import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { install } from "./installer.js";
import { purge } from "./purge.js";

test("purge requires double confirmation and stays inside home", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "continuity-purge-"));
  await install({ home, packageRoot: process.cwd(), adapters: ["codex"] });
  const vault = path.join(home, ".continuity", "vault", "memory.json");
  await mkdir(path.dirname(vault), { recursive: true });
  await writeFile(vault, "memory");
  const outside = path.join(home, "keep.txt");
  await writeFile(outside, "keep");
  await assert.rejects(purge(home, { yes: true, phrase: "wrong" }), /requires/);
  await access(vault);
  const result = await purge(home, { yes: true, phrase: "PURGE" });
  assert.equal(result.purged, true);
  await assert.rejects(access(path.join(home, ".continuity")));
  await access(outside);
});
