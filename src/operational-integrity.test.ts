import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { doctor } from "./doctor.js";
import { vaultPaths } from "./paths.js";
import { processingDecision } from "./processing-policy.js";
import { quarantineInvalidFiles } from "./repair.js";
import { initVault } from "./vault.js";

test("invalid Vault config is rejected, diagnosed, and explicitly repairable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-operational-integrity-"));
  await initVault(root);
  await writeFile(vaultPaths(root).config, JSON.stringify({ schema_version: 1, paused: "false" }));
  await assert.rejects(initVault(root), /Invalid vault config paused/);
  assert.equal((await doctor(root)).errors.includes("invalid_vault_config:config.json"), true);
  const repaired = await quarantineInvalidFiles(root);
  assert.equal(repaired.quarantined.some(file => file.includes("vault-config")), true);
  assert.equal((await initVault(root)).paused, false);
  assert.equal((await doctor(root)).ok, true);
});

test("invalid sequence state cannot be silently reset and is repairable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-operational-integrity-"));
  await initVault(root);
  const sequence = path.join(vaultPaths(root).registry, "p.sequence.json");
  await writeFile(sequence, JSON.stringify({ schema_version: 1, value: "999" }));
  await assert.rejects(capture(root, { projectId: "p", sessionId: "s", turnId: "t", role: "user", content: "must not reuse sequence", sourceAgent: "test" }), /Invalid sequence state value/);
  assert.equal((await doctor(root)).errors.some(error => error.startsWith("invalid_sequence:")), true);
  await quarantineInvalidFiles(root);
  const event = await capture(root, { projectId: "p", sessionId: "s", turnId: "t", role: "user", content: "safe sequence restart after confirmed repair", sourceAgent: "test" });
  assert.equal(event?.seq_id, 1);
});

test("invalid processing history cannot silently bypass rate accounting", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-operational-integrity-"));
  await capture(root, { projectId: "p", sessionId: "s", turnId: "t", role: "user", content: "pending scheduler work", sourceAgent: "test" });
  const history = path.join(vaultPaths(root).registry, "processing-runs", "p.json");
  await mkdir(path.dirname(history), { recursive: true });
  await writeFile(history, JSON.stringify({ schema_version: 1, runs: "not-an-array" }));
  await assert.rejects(processingDecision(root, "p", "automatic"), /Invalid processing run history runs/);
  assert.equal((await doctor(root)).errors.some(error => error.startsWith("invalid_processing_history:")), true);
  await quarantineInvalidFiles(root);
  assert.equal((await processingDecision(root, "p", "automatic")).reason, "below_threshold");
});
