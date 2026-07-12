import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { vaultPaths } from "./paths.js";
import { initVault } from "./vault.js";

test("backfills new config defaults while preserving existing and unknown fields", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-vault-config-"));
  await initVault(root);
  const file = vaultPaths(root).config;
  const old = JSON.parse(await readFile(file, "utf8"));
  delete old.max_files;
  delete old.max_raw_fragment_characters;
  delete old.search_timeout_ms;
  old.paused = true;
  old.future_field = "preserve";
  await writeFile(file, JSON.stringify(old));

  const upgraded = await initVault(root);
  assert.equal(upgraded.paused, true);
  assert.equal(upgraded.max_files, 5000);
  assert.equal(upgraded.max_raw_fragment_characters, 500);
  assert.equal(upgraded.search_timeout_ms, 2000);
  const persisted = JSON.parse(await readFile(file, "utf8"));
  assert.equal(persisted.future_field, "preserve");
  assert.equal(persisted.created_at, old.created_at);
});

test("rejects unsupported config schema instead of silently rewriting it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-vault-config-"));
  await initVault(root);
  await writeFile(vaultPaths(root).config, JSON.stringify({ schema_version: 99 }));
  await assert.rejects(initVault(root), /Unsupported vault config schema/);
});
