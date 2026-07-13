import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { installHooks, uninstallHooks } from "./hook-installer.js";

const exec = promisify(execFile);

test("merges hooks without overwriting user configuration and is idempotent", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "linger-hooks-"));
  const runtime = await fixtureRuntime(home, "0.1.0");
  await mkdir(path.join(home, ".claude"), { recursive: true });
  await writeFile(path.join(home, ".claude", "settings.json"), JSON.stringify({ theme: "dark", hooks: { Stop: [{ hooks: [{ type: "command", command: "user-script" }] }] } }));
  await installHooks(home, runtime, ["claude-code", "codex"]);
  await installHooks(home, runtime, ["claude-code", "codex"]);
  const claude = JSON.parse(await readFile(path.join(home, ".claude", "settings.json"), "utf8"));
  assert.equal(claude.theme, "dark");
  assert.equal(claude.autoMemoryEnabled, false);
  assert.equal(claude.hooks.Stop[0].hooks[0].command, "user-script");
  assert.equal(claude.hooks.Stop.flatMap((group: { hooks: unknown[] }) => group.hooks).length, 2);
  assert.deepEqual(Object.keys(claude.hooks).sort(), ["SessionStart", "Stop", "StopFailure", "UserPromptSubmit"]);
  const codex = JSON.parse(await readFile(path.join(home, ".codex", "hooks.json"), "utf8"));
  assert.deepEqual(Object.keys(codex.hooks).sort(), ["SessionStart", "Stop", "UserPromptSubmit"]);
});

test("uninstall removes only Linger hooks", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "linger-hooks-"));
  const runtime = await fixtureRuntime(home, "0.1.0");
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

test("upgrade replaces prior version hooks instead of duplicating them", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "linger-hooks-upgrade-"));
  const oldRuntime = await fixtureRuntime(home, "0.1.0");
  const newRuntime = await fixtureRuntime(home, "0.2.0");
  await installHooks(home, oldRuntime, ["codex"]);
  await installHooks(home, newRuntime, ["codex"]);
  const document = JSON.parse(await readFile(path.join(home, ".codex", "hooks.json"), "utf8"));
  for (const event of ["SessionStart", "UserPromptSubmit", "Stop"]) {
    const commands = document.hooks[event].flatMap((group: { hooks: Array<{ command: string }> }) => group.hooks.map(hook => hook.command));
    assert.equal(commands.length, 1);
    assert.match(commands[0], /runtime\/0\.2\.0\/dist\/hook-cli\.js/);
    assert.doesNotMatch(commands[0], /runtime\/0\.1\.0/);
  }
});

test("hook commands do not execute shell substitutions embedded in install paths", async (context) => {
  if (process.platform === "win32") { context.skip("POSIX shell regression"); return; }
  const base = await mkdtemp(path.join(os.tmpdir(), "linger-hook-quoting-"));
  const substitution = "$" + "(mkdir$" + "{IFS}pwned)";
  const home = path.join(base, `home-${substitution}-quote's`);
  const runtime = await fixtureRuntime(home, "0.2.0-alpha.0");
  await installHooks(home, runtime, ["codex"]);
  const document = JSON.parse(await readFile(path.join(home, ".codex", "hooks.json"), "utf8"));
  const command = document.hooks.Stop[0].hooks[0].command as string;
  await exec("/bin/sh", ["-c", command], { cwd: base });
  await assert.rejects(access(path.join(base, "pwned")));
});

test("upgrade preserves user wrappers that merely contain a Linger command", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "linger-hooks-wrapper-"));
  const file = path.join(home, ".codex", "hooks.json");
  await mkdir(path.dirname(file), { recursive: true });
  const oldRuntime = path.join(home, ".linger", "runtime", "0.1.0", "dist", "hook-cli.js");
  const wrapper = `notify-before && LINGER_ADAPTER=codex "node" "${oldRuntime}" && notify-after`;
  await writeFile(file, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: wrapper }] }] } }));
  await installHooks(home, await fixtureRuntime(home, "0.2.0-alpha.0"), ["codex"]);
  const document = JSON.parse(await readFile(file, "utf8"));
  const commands = document.hooks.Stop.flatMap((group: { hooks: Array<{ command: string }> }) => group.hooks.map(hook => hook.command));
  assert.ok(commands.includes(wrapper));
  assert.equal(commands.length, 2);
});

test("malformed host hook configuration fails before write and preserves exact bytes", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "linger-hooks-"));
  const file = path.join(home, ".claude", "settings.json");
  await mkdir(path.dirname(file), { recursive: true });
  const runtime = await fixtureRuntime(home, "0.1.0");
  for (const malformed of ["[]", JSON.stringify({ theme: "dark", hooks: [] })]) {
    await writeFile(file, malformed);
    await assert.rejects(installHooks(home, runtime, ["claude-code"]), /Invalid host/);
    assert.equal(await readFile(file, "utf8"), malformed);
  }
});

async function fixtureRuntime(home: string, version: string): Promise<string> {
  const runtime = path.join(home, ".linger", "runtime", version);
  await mkdir(path.join(runtime, "dist"), { recursive: true });
  await writeFile(path.join(runtime, "dist", "hook-cli.js"), `// fixture ${version}\n`);
  return runtime;
}
