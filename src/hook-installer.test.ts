import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installHooks, uninstallHooks } from "./hook-installer.js";

test("merges hooks without overwriting user configuration and is idempotent", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "linger-hooks-"));
  const runtime = path.join(home, ".linger", "runtime", "0.1.0");
  await mkdir(path.join(home, ".claude"), { recursive: true });
  await writeFile(path.join(home, ".claude", "settings.json"), JSON.stringify({ theme: "dark", hooks: { Stop: [{ hooks: [{ type: "command", command: "user-script" }] }] } }));
  await installHooks(home, runtime, ["claude-code", "codex"]);
  await installHooks(home, runtime, ["claude-code", "codex"]);
  const claude = JSON.parse(await readFile(path.join(home, ".claude", "settings.json"), "utf8"));
  assert.equal(claude.theme, "dark");
  assert.equal(claude.hooks.Stop[0].hooks[0].command, "user-script");
  assert.equal(claude.hooks.Stop.flatMap((group: { hooks: unknown[] }) => group.hooks).length, 2);
  assert.deepEqual(Object.keys(claude.hooks).sort(), ["SessionStart", "Stop", "StopFailure", "UserPromptSubmit"]);
  const codex = JSON.parse(await readFile(path.join(home, ".codex", "hooks.json"), "utf8"));
  assert.deepEqual(Object.keys(codex.hooks).sort(), ["SessionStart", "Stop", "UserPromptSubmit"]);
});

test("uninstall removes only Linger hooks", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "linger-hooks-"));
  const runtime = path.join(home, ".linger", "runtime", "0.1.0");
  await installHooks(home, runtime, ["claude-code"]);
  const file = path.join(home, ".claude", "settings.json");
  const settings = JSON.parse(await readFile(file, "utf8"));
  settings.hooks.Stop.push({ hooks: [{ type: "command", command: "keep-me" }, { type: "command", command: "/tmp/dist/hook-cli.js" }] });
  await writeFile(file, JSON.stringify(settings));
  await uninstallHooks(home, ["claude-code"]);
  const after = JSON.parse(await readFile(file, "utf8"));
  assert.equal(after.hooks.Stop.length, 1);
  assert.deepEqual(after.hooks.Stop[0].hooks.map((hook: { command: string }) => hook.command), ["keep-me", "/tmp/dist/hook-cli.js"]);
});

test("malformed host hook configuration fails before write and preserves exact bytes", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "linger-hooks-"));
  const file = path.join(home, ".claude", "settings.json");
  await mkdir(path.dirname(file), { recursive: true });
  for (const malformed of ["[]", JSON.stringify({ theme: "dark", hooks: [] })]) {
    await writeFile(file, malformed);
    await assert.rejects(installHooks(home, path.join(home, ".linger", "runtime", "0.1.0"), ["claude-code"]), /Invalid host/);
    assert.equal(await readFile(file, "utf8"), malformed);
  }
});
