import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const cli = path.resolve("dist/cli.js");

test("CLI install, capabilities, and confirmed uninstall", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "linger-install-cli-"));
  await assert.rejects(exec(process.execPath, [cli, "install", "--home", home]), /privacy boundary/);
  assert.equal(await readFile(path.join(home, ".linger", "install-manifest.json"), "utf8").catch(() => "missing"), "missing");
  const installed = JSON.parse((await exec(process.execPath, [cli, "install", "--home", home, "--yes"])).stdout);
  assert.equal(installed.capabilities[0].level, 2);
  await access(path.join(home, ".codex", "skills", "linger", "SKILL.md"));
  await access(path.join(home, ".local", "bin", "linger"));
  const capabilities = JSON.parse((await exec(process.execPath, [cli, "capabilities", "--home", home])).stdout);
  assert.deepEqual(capabilities.map((item: { level: number }) => item.level), [2, 1]);
  await assert.rejects(exec(process.execPath, [cli, "uninstall", "--home", home]), /uninstall requires --yes/);
  const removed = JSON.parse((await exec(process.execPath, [cli, "uninstall", "--home", home, "--yes"])).stdout);
  assert.equal(removed.vault_preserved, true);
  assert.equal(await readFile(path.join(home, ".linger", "install-manifest.json"), "utf8").catch(() => "missing"), "missing");
});

test("CLI validates adapter selection before writing install state", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "linger-install-adapter-cli-"));
  await assert.rejects(exec(process.execPath, [cli, "install", "--home", home, "--adapters", "cursor", "--yes"]), /--adapters must/);
  assert.equal(await readFile(path.join(home, ".linger", "install-manifest.json"), "utf8").catch(() => "missing"), "missing");
  const installed = JSON.parse((await exec(process.execPath, [cli, "install", "--home", home, "--adapters", "codex", "--yes"])).stdout) as { manifest: { adapters: string[] } };
  assert.deepEqual(installed.manifest.adapters, ["codex"]);
  await access(path.join(home, ".codex", "skills", "linger", "SKILL.md"));
  await assert.rejects(access(path.join(home, ".claude", "skills", "linger", "SKILL.md")));
});
