import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
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

test("doctor and repair cover adapter evidence and symlinked recall samples", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-repair-registry-"));
  const external = await mkdtemp(path.join(os.tmpdir(), "linger-repair-external-"));
  const p = vaultPaths(root);
  const adapter = path.join(p.registry, "adapter-evidence", "codex.json");
  const attempts = path.join(p.registry, "recall-samples", "p", "attempts");
  await mkdir(path.dirname(adapter), { recursive: true });
  await mkdir(attempts, { recursive: true });
  await writeFile(adapter, JSON.stringify({ schema_version: 999, adapter: "codex", sessions: [] }));
  const externalFile = path.join(external, "attempt.json");
  const externalBytes = JSON.stringify({ private: "outside-vault" });
  await writeFile(externalFile, externalBytes);
  const recallLink = path.join(attempts, "ra_external.json");
  await symlink(externalFile, recallLink);
  const before = await doctor(root);
  assert.equal(before.ok, false);
  assert.ok(before.errors.some(error => error.startsWith("invalid_adapter_evidence:")));
  assert.ok(before.errors.some(error => error.startsWith("invalid_recall_sample:")));
  const result = await quarantineInvalidFiles(root);
  assert.equal(result.quarantined.length, 2);
  await assert.rejects(access(adapter));
  await assert.rejects(access(recallLink));
  assert.equal(await readFile(externalFile, "utf8"), externalBytes);
  assert.equal((await doctor(root)).ok, true);
});
