import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installHooks, uninstallHooks } from "./hook-installer.js";

test("merges hooks without overwriting user configuration and is idempotent", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "continuity-hooks-"));
  await mkdir(path.join(home, ".claude"), { recursive: true });
  await writeFile(path.join(home, ".claude", "settings.json"), JSON.stringify({ theme: "dark", hooks: { Stop: [{ hooks: [{ type: "command", command: "user-script" }] }] } }));
  await installHooks(home, process.cwd(), ["claude-code", "codex"]);
  await installHooks(home, process.cwd(), ["claude-code", "codex"]);
  const claude = JSON.parse(await readFile(path.join(home, ".claude", "settings.json"), "utf8"));
  assert.equal(claude.theme, "dark");
  assert.equal(claude.hooks.Stop[0].hooks[0].command, "user-script");
  assert.equal(claude.hooks.Stop.flatMap((group: { hooks: unknown[] }) => group.hooks).length, 2);
  assert.deepEqual(Object.keys(claude.hooks).sort(), ["SessionStart", "Stop", "StopFailure", "UserPromptSubmit"]);
  const codex = JSON.parse(await readFile(path.join(home, ".codex", "hooks.json"), "utf8"));
  assert.deepEqual(Object.keys(codex.hooks).sort(), ["SessionStart", "Stop", "UserPromptSubmit"]);
});

test("uninstall removes only Continuity hooks", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "continuity-hooks-"));
  await installHooks(home, process.cwd(), ["claude-code"]);
  const file = path.join(home, ".claude", "settings.json");
  const settings = JSON.parse(await readFile(file, "utf8"));
  settings.hooks.Stop.push({ hooks: [{ type: "command", command: "keep-me" }] });
  await writeFile(file, JSON.stringify(settings));
  await uninstallHooks(home, ["claude-code"]);
  const after = JSON.parse(await readFile(file, "utf8"));
  assert.equal(after.hooks.Stop.length, 1);
  assert.equal(after.hooks.Stop[0].hooks[0].command, "keep-me");
});
