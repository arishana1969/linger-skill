import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { install, uninstall } from "./installer.js";

const packageRoot = process.cwd();
async function home(): Promise<string> { return await mkdtemp(path.join(os.tmpdir(), "continuity-install-")); }

test("installs idempotently into both hosts and reports L1", async () => {
  const fakeHome = await home();
  const first = await install({ home: fakeHome, packageRoot });
  assert.deepEqual(first.capabilities.map(item => item.level), [1, 1]);
  const second = await install({ home: fakeHome, packageRoot });
  assert.equal(second.manifest.backups.length, 0);
  await access(path.join(fakeHome, ".claude", "skills", "continuity", "SKILL.md"));
  await access(path.join(fakeHome, ".codex", "skills", "continuity", "SKILL.md"));
});

test("backs up unmanaged skill and uninstall preserves vault", async () => {
  const fakeHome = await home();
  const existing = path.join(fakeHome, ".codex", "skills", "continuity");
  await mkdir(existing, { recursive: true });
  await writeFile(path.join(existing, "SKILL.md"), "user-owned");
  const result = await install({ home: fakeHome, packageRoot, adapters: ["codex"] });
  assert.equal(result.manifest.backups.length, 1);
  assert.equal(await readFile(path.join(result.manifest.backups[0]!, "SKILL.md"), "utf8"), "user-owned");
  const vaultSentinel = path.join(fakeHome, ".continuity", "vault", "keep.txt");
  await mkdir(path.dirname(vaultSentinel), { recursive: true });
  await writeFile(vaultSentinel, "keep");
  const removed = await uninstall(fakeHome);
  assert.equal(removed.vault_preserved, true);
  assert.equal(await readFile(vaultSentinel, "utf8"), "keep");
});
