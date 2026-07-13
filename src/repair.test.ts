import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { doctor } from "./doctor.js";
import { vaultPaths } from "./paths.js";
import { quarantineInvalidFiles } from "./repair.js";

test("explicit repair quarantines invalid files and restores doctor availability", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-repair-"));
  const file = path.join(vaultPaths(root).processed, "p", "broken.json");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "broken");
  assert.equal((await doctor(root)).ok, false);
  const result = await quarantineInvalidFiles(root);
  assert.equal(result.quarantined.length, 1);
  await assert.rejects(access(file));
  await access(path.join(root, result.quarantined[0]!));
  assert.equal((await doctor(root)).ok, true);
});
