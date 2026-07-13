import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { install, uninstall } from "./installer.js";

const packageRoot = process.cwd();
async function home(): Promise<string> { return await mkdtemp(path.join(os.tmpdir(), "linger-install-")); }

test("installs idempotently and keeps untrusted Codex hooks at L1", async () => {
  const fakeHome = await home();
  const first = await install({ home: fakeHome, packageRoot });
  assert.deepEqual(first.capabilities.map(item => item.level), [2, 1]);
  const second = await install({ home: fakeHome, packageRoot });
  assert.equal(second.manifest.backups.length, 0);
  await access(path.join(fakeHome, ".claude", "skills", "linger", "SKILL.md"));
  await access(path.join(fakeHome, ".codex", "skills", "linger", "SKILL.md"));
});

test("backs up unmanaged skill and uninstall preserves vault", async () => {
  const fakeHome = await home();
  const existing = path.join(fakeHome, ".codex", "skills", "linger");
  await mkdir(existing, { recursive: true });
  await writeFile(path.join(existing, "SKILL.md"), "user-owned");
  const result = await install({ home: fakeHome, packageRoot, adapters: ["codex"] });
  assert.equal(result.manifest.backups.length, 1);
  assert.equal(await readFile(path.join(result.manifest.backups[0]!, "SKILL.md"), "utf8"), "user-owned");
  const vaultSentinel = path.join(fakeHome, ".linger", "vault", "keep.txt");
  await mkdir(path.dirname(vaultSentinel), { recursive: true });
  await writeFile(vaultSentinel, "keep");
  const removed = await uninstall(fakeHome);
  assert.equal(removed.vault_preserved, true);
  assert.equal(await readFile(vaultSentinel, "utf8"), "keep");
});

test("uninstall refuses a tampered manifest target before deleting anything", async () => {
  const fakeHome = await home();
  await install({ home: fakeHome, packageRoot, adapters: ["codex"] });
  const arbitrary = path.join(fakeHome, "arbitrary-managed-directory");
  await mkdir(arbitrary, { recursive: true });
  await writeFile(path.join(arbitrary, ".linger-managed"), "forged marker");
  const manifestFile = path.join(fakeHome, ".linger", "install-manifest.json");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  manifest.files = [arbitrary];
  await writeFile(manifestFile, JSON.stringify(manifest));

  await assert.rejects(uninstall(fakeHome), /Invalid install manifest target/);
  await access(arbitrary);
  await access(path.join(fakeHome, ".codex", "skills", "linger", "SKILL.md"));
  await access(manifestFile);
});

test("programmatic install rejects invalid or duplicate adapters before writes", async () => {
  const fakeHome = await home();
  await assert.rejects(install({ home: fakeHome, packageRoot, adapters: ["codex", "codex"] }), /Invalid install adapters/);
  await assert.rejects(install({ home: fakeHome, packageRoot, adapters: ["unknown" as never] }), /Invalid install adapters/);
  await assert.rejects(access(path.join(fakeHome, ".linger")));
});
