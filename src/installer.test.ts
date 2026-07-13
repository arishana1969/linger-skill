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

test("Claude install and uninstall preserve host auto-memory settings", async () => {
  for (const original of [true, false, undefined]) {
    const fakeHome = await home();
    const settingsFile = path.join(fakeHome, ".claude", "settings.json");
    await mkdir(path.dirname(settingsFile), { recursive: true });
    await writeFile(settingsFile, JSON.stringify({ theme: "dark", ...(original === undefined ? {} : { autoMemoryEnabled: original }) }));
    await install({ home: fakeHome, packageRoot, adapters: ["claude-code"] });
    await install({ home: fakeHome, packageRoot, adapters: ["claude-code"] });
    const installed = JSON.parse(await readFile(settingsFile, "utf8"));
    if (original === undefined) assert.equal(Object.hasOwn(installed, "autoMemoryEnabled"), false);
    else assert.equal(installed.autoMemoryEnabled, original);
    await uninstall(fakeHome);
    const uninstalled = JSON.parse(await readFile(settingsFile, "utf8"));
    if (original === undefined) assert.equal(Object.hasOwn(uninstalled, "autoMemoryEnabled"), false);
    else assert.equal(uninstalled.autoMemoryEnabled, original);
    assert.equal(uninstalled.theme, "dark");
  }
});

test("upgrade restores auto-memory state left by the replacement-era installer", async () => {
  for (const legacyState of [
    { had_value: true, previous_value: true },
    { had_value: false }
  ]) {
    const fakeHome = await home();
    await install({ home: fakeHome, packageRoot, adapters: ["claude-code"] });
    const manifestFile = path.join(fakeHome, ".linger", "install-manifest.json");
    const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
    manifest.claude_auto_memory = legacyState;
    await writeFile(manifestFile, JSON.stringify(manifest));
    const settingsFile = path.join(fakeHome, ".claude", "settings.json");
    const settings = JSON.parse(await readFile(settingsFile, "utf8"));
    settings.autoMemoryEnabled = false;
    await writeFile(settingsFile, JSON.stringify(settings));

    const upgraded = await install({ home: fakeHome, packageRoot, adapters: ["claude-code"] });
    const after = JSON.parse(await readFile(settingsFile, "utf8"));
    if (legacyState.had_value) assert.equal(after.autoMemoryEnabled, true);
    else assert.equal(Object.hasOwn(after, "autoMemoryEnabled"), false);
    assert.equal(Object.hasOwn(upgraded.manifest, "claude_auto_memory"), false);
  }
});

test("changing adapter selection removes only stale Linger-managed integration", async () => {
  const fakeHome = await home();
  await install({ home: fakeHome, packageRoot, adapters: ["claude-code", "codex"] });
  const claudeSettings = path.join(fakeHome, ".claude", "settings.json");
  const document = JSON.parse(await readFile(claudeSettings, "utf8"));
  document.hooks.Stop.push({ hooks: [{ type: "command", command: "keep-user-hook" }] });
  await writeFile(claudeSettings, JSON.stringify(document));

  const result = await install({ home: fakeHome, packageRoot, adapters: ["codex"] });
  await assert.rejects(access(path.join(fakeHome, ".claude", "skills", "linger")));
  await access(path.join(fakeHome, ".codex", "skills", "linger", "SKILL.md"));
  const after = JSON.parse(await readFile(claudeSettings, "utf8"));
  assert.deepEqual(after.hooks.Stop.flatMap((group: { hooks: Array<{ command: string }> }) => group.hooks.map(hook => hook.command)), ["keep-user-hook"]);
  assert.deepEqual(result.manifest.adapters, ["codex"]);
  assert.deepEqual(result.manifest.files, [path.join(fakeHome, ".codex", "skills", "linger")]);
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
