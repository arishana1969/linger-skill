import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
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
  assert.equal(Object.hasOwn(second.manifest, "backups"), false);
  assert.equal(Object.hasOwn(second.manifest, "package_root"), false);
  assert.equal(Object.hasOwn(second.manifest, "hook_files"), false);
  await access(path.join(fakeHome, ".claude", "skills", "linger", "SKILL.md"));
  await access(path.join(fakeHome, ".codex", "skills", "linger", "SKILL.md"));
  await access(path.join(fakeHome, ".local", "bin", "linger"));
  await assert.rejects(access(path.join(fakeHome, ".linger", "install", "active.json")));
  assert.equal(first.cli.path, path.join(fakeHome, ".local", "bin", "linger"));
  assert.equal(first.cli.on_path, false);
});

test("unmanaged skill causes zero mutation unless cli-only is explicit", async () => {
  const fakeHome = await home();
  const existing = path.join(fakeHome, ".codex", "skills", "linger");
  await mkdir(existing, { recursive: true });
  await writeFile(path.join(existing, "SKILL.md"), "user-owned");
  await assert.rejects(install({ home: fakeHome, packageRoot, adapters: ["codex"] }), /user-owned; no files were changed/);
  await assert.rejects(access(path.join(fakeHome, ".linger")));
  assert.equal(await readFile(path.join(existing, "SKILL.md"), "utf8"), "user-owned");

  const result = await install({ home: fakeHome, packageRoot, adapters: ["codex"], onEntryConflict: "cli-only" });
  assert.deepEqual(result.manifest.entry_conflicts, [existing]);
  assert.deepEqual(result.manifest.files, []);
  assert.equal(await readFile(path.join(existing, "SKILL.md"), "utf8"), "user-owned");
  await access(path.join(fakeHome, ".local", "bin", "linger"));
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

test("malformed host hooks fail before installer mutation", async () => {
  const fakeHome = await home();
  const hooks = path.join(fakeHome, ".codex", "hooks.json");
  await mkdir(path.dirname(hooks), { recursive: true });
  await writeFile(hooks, "[]");
  await assert.rejects(install({ home: fakeHome, packageRoot, adapters: ["codex"] }), /Invalid host configuration/);
  assert.equal(await readFile(hooks, "utf8"), "[]");
  await assert.rejects(access(path.join(fakeHome, ".linger")));
  await assert.rejects(access(path.join(fakeHome, ".codex", "skills", "linger")));
});

test("upgrades a manifest-owned legacy Codex skill without touching the Vault", async () => {
  const fakeHome = await home();
  const first = await install({ home: fakeHome, packageRoot, adapters: ["codex"] });
  const skill = path.join(fakeHome, ".codex", "skills", "linger");
  await rm(path.join(skill, ".linger-managed.json"));
  await writeFile(path.join(skill, ".linger-managed"), "managed by legacy linger\n");
  const manifestFile = path.join(fakeHome, ".linger", "install-manifest.json");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  for (const launcher of manifest.cli_launchers) await rm(launcher, { force: true });
  delete manifest.cli_launchers;
  await writeFile(manifestFile, JSON.stringify(manifest));
  const sentinel = path.join(fakeHome, ".linger", "vault", "legacy.json");
  await mkdir(path.dirname(sentinel), { recursive: true });
  await writeFile(sentinel, "legacy-content\n");
  const upgraded = await install({ home: fakeHome, packageRoot, adapters: ["codex"] });
  assert.equal(upgraded.manifest.files[0], skill);
  await access(path.join(skill, ".linger-managed.json"));
  assert.equal(await readFile(sentinel, "utf8"), "legacy-content\n");
  assert.equal(first.manifest.runtime_root, upgraded.manifest.runtime_root);
});

test("installs a managed bare CLI into an existing PATH-owned user bin", async () => {
  const fakeHome = await home();
  const localBin = path.join(fakeHome, ".local", "bin");
  await mkdir(localBin, { recursive: true });
  const previousPath = process.env.PATH;
  process.env.PATH = `${localBin}${path.delimiter}${previousPath ?? ""}`;
  try {
    const result = await install({ home: fakeHome, packageRoot, adapters: ["codex"] });
    assert.equal(result.cli.path, path.join(localBin, "linger"));
    assert.equal(result.cli.on_path, true);
    await access(result.cli.path);
    const uninstalled = await uninstall(fakeHome);
    assert.equal(uninstalled.vault_preserved, true);
    await assert.rejects(access(result.cli.path));
  } finally {
    process.env.PATH = previousPath;
  }
});

test("upgrade retains the v1.0.0 absolute launcher while exposing a stable user-bin entry", async () => {
  const fakeHome = await home();
  const installed = await install({ home: fakeHome, packageRoot, adapters: ["codex"] });
  const legacyLauncher = path.join(fakeHome, ".linger", "bin", "linger");
  await mkdir(path.dirname(legacyLauncher), { recursive: true });
  await rename(installed.cli.path, legacyLauncher);
  const manifestFile = path.join(fakeHome, ".linger", "install-manifest.json");
  await writeFile(manifestFile, JSON.stringify({ ...installed.manifest, cli_launchers: [legacyLauncher] }));
  const upgraded = await install({ home: fakeHome, packageRoot, adapters: ["codex"] });
  assert.deepEqual(upgraded.manifest.cli_launchers, [installed.cli.path, legacyLauncher]);
  for (const launcher of upgraded.manifest.cli_launchers!) {
    assert.equal(execFileSync(launcher, ["version"], { encoding: "utf8" }).trim(), upgraded.manifest.package_version);
  }
  await uninstall(fakeHome);
  for (const launcher of upgraded.manifest.cli_launchers!) await assert.rejects(access(launcher));
});
