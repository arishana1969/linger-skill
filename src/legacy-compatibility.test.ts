import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { doctor } from "./doctor.js";
import { uninstall } from "./installer.js";
import { processQueue } from "./processing.js";
import { search } from "./search.js";
import { vaultPaths } from "./paths.js";
import { listJsonFiles } from "./vault.js";

test("reads a legacy processed record without source_hash as degraded evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-legacy-processed-"));
  await capture(root, {
    projectId: "p_legacy",
    sessionId: "s_legacy",
    turnId: "t_legacy",
    role: "user",
    content: "legacy compatibility sentinel",
    sourceAgent: "legacy-linger"
  });
  await processQueue(root);
  const processedFile = (await listJsonFiles(vaultPaths(root).processed, root))[0]!;
  const legacy = JSON.parse(await readFile(processedFile, "utf8")) as Record<string, unknown>;
  delete legacy.source_hash;
  await writeFile(processedFile, `${JSON.stringify(legacy)}\n`);

  const hit = (await search(root, { projectId: "p_legacy", query: "compatibility sentinel" }))[0]!;
  assert.match(hit.snippet, /compatibility sentinel/);
  assert.ok(hit.warning_flags.includes("unverified_source"));
  const report = await doctor(root);
  assert.equal(report.ok, true);
  assert.equal(report.state, "degraded");
  assert.ok(report.warnings.some(item => item.includes("unverified_source")));
});

test("uninstalls a manifest-owned v0.2 layout while preserving its Vault", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "linger-v02-uninstall-"));
  const runtime = path.join(home, ".linger", "runtime", "0.2.2");
  const claudeSkill = path.join(home, ".claude", "skills", "linger");
  const codexSkill = path.join(home, ".codex", "skills", "linger");
  const vaultSentinel = path.join(home, ".linger", "vault", "Raw", "legacy.json");
  for (const directory of [runtime, claudeSkill, codexSkill, path.dirname(vaultSentinel)]) {
    await mkdir(directory, { recursive: true });
  }
  await writeFile(path.join(runtime, ".linger-managed"), "managed by linger-skill\n");
  await writeFile(path.join(claudeSkill, ".linger-managed"), "managed by legacy linger\n");
  await writeFile(path.join(codexSkill, ".linger-managed"), "managed by legacy linger\n");
  await writeFile(path.join(claudeSkill, "SKILL.md"), "legacy Claude entry\n");
  await writeFile(path.join(codexSkill, "SKILL.md"), "legacy Codex entry\n");
  await writeFile(vaultSentinel, "legacy user evidence\n");

  const manifest = {
    schema_version: 1,
    package_version: "0.2.2",
    installed_at: "2026-07-01T00:00:00.000Z",
    package_root: "/historical/package",
    runtime_root: runtime,
    adapters: ["claude-code", "codex"],
    files: [claudeSkill, codexSkill],
    backups: [],
    hook_files: []
  };
  const manifestFile = path.join(home, ".linger", "install-manifest.json");
  await writeFile(manifestFile, JSON.stringify(manifest));

  const result = await uninstall(home);
  assert.equal(result.vault_preserved, true);
  assert.equal(await readFile(vaultSentinel, "utf8"), "legacy user evidence\n");
  await assert.rejects(access(runtime));
  await assert.rejects(access(claudeSkill));
  await assert.rejects(access(codexSkill));
  await assert.rejects(access(manifestFile));
});
