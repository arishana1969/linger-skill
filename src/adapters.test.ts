import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capabilityReport } from "./adapters.js";
import { posixHookCommand } from "./hook-command.js";
import { handleHook } from "./hook-handler.js";
import { runtimeFingerprint } from "./runtime-identity.js";
import { verifiedCodexLifecycleSession } from "./lifecycle-evidence.js";
import { projectId } from "./vault.js";

test("reports honest degraded adapter levels", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "linger-adapters-"));
  assert.deepEqual((await capabilityReport(home)).map(item => item.level), [0, 0]);
  await mkdir(path.join(home, ".claude", "skills", "linger"), { recursive: true });
  await writeFile(path.join(home, ".claude", "skills", "linger", "SKILL.md"), "installed");
  assert.equal((await capabilityReport(home))[0]?.level, 1);
  await writeFile(path.join(home, ".claude", "settings.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [] }] } }));
  assert.equal((await capabilityReport(home))[0]?.level, 1);
});

test("detects Codex skill and hooks independently", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "linger-adapters-"));
  await mkdir(path.join(home, ".agents", "skills", "linger"), { recursive: true });
  await writeFile(path.join(home, ".agents", "skills", "linger", "SKILL.md"), "installed");
  await mkdir(path.join(home, ".codex"), { recursive: true });
  await writeFile(path.join(home, ".codex", "config.toml"), "[hooks]\nenabled = true\n");
  const codex = (await capabilityReport(home))[1]!;
  assert.equal(codex.level, 1);
  assert.equal(codex.capabilities.lifecycle_hooks, false);
  assert.equal(codex.capabilities.async_processing, false);
  assert.match(codex.limitations.join(" "), /trust/);
});

test("promotes Codex to L2 only with same-session live lifecycle evidence", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "linger-adapters-live-"));
  const runtimeIdentity = await installCodexFixture(home);
  const cwd = await mkdtemp(path.join(os.tmpdir(), "linger-adapters-project-"));
  const vault = path.join(home, ".linger", "vault");
  await handleHook(vault, { hook_event_name: "SessionStart", session_id: "s-live", cwd }, "codex", runtimeIdentity);
  await handleHook(vault, { hook_event_name: "UserPromptSubmit", session_id: "s-live", turn_id: "user", cwd, prompt: "remember verified evidence" }, "codex", runtimeIdentity);
  assert.equal((await capabilityReport(home))[1]?.level, 1);
  await handleHook(vault, { hook_event_name: "Stop", session_id: "s-live", turn_id: "assistant", cwd, last_assistant_message: "verified evidence captured" }, "codex", runtimeIdentity);
  const report = (await capabilityReport(home))[1]!;
  assert.equal(report.level, 2);
  assert.equal(report.capabilities.lifecycle_hooks, true);
  assert.match(report.evidence.join(" "), /live lifecycle verified/);
});

test("downgrades stale runtime evidence after managed hooks change", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "linger-adapters-stale-"));
  const oldIdentity = await installCodexFixture(home);
  const cwd = await mkdtemp(path.join(os.tmpdir(), "linger-adapters-project-"));
  await completeLifecycle(home, cwd, "stale-session", oldIdentity);
  assert.equal((await capabilityReport(home))[1]?.level, 2);
  const runtime = runtimeRoot(home);
  await writeFile(path.join(runtime, "dist", "hook-cli.js"), "// upgraded runtime\n");
  const newIdentity = await runtimeFingerprint(runtime, process.execPath);
  await writeCodexHooks(home, newIdentity);
  assert.equal((await capabilityReport(home))[1]?.level, 1);
});

test("downgrades L2 when the installed runtime changes without a hook update", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "linger-adapters-runtime-tamper-"));
  const runtimeIdentity = await installCodexFixture(home);
  const cwd = await mkdtemp(path.join(os.tmpdir(), "linger-adapters-project-"));
  await completeLifecycle(home, cwd, "runtime-tamper-session", runtimeIdentity);
  assert.equal((await capabilityReport(home))[1]?.level, 2);
  await writeFile(path.join(runtimeRoot(home), "dist", "hook-cli.js"), "// tampered after install\n");
  assert.equal((await capabilityReport(home))[1]?.level, 1);
});

test("does not aggregate lifecycle evidence without a real session id", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "linger-adapters-session-"));
  const runtimeIdentity = await installCodexFixture(home);
  const cwd = await mkdtemp(path.join(os.tmpdir(), "linger-adapters-project-"));
  const vault = path.join(home, ".linger", "vault");
  await handleHook(vault, { hook_event_name: "SessionStart", cwd }, "codex", runtimeIdentity);
  await handleHook(vault, { hook_event_name: "UserPromptSubmit", turn_id: "user", cwd, prompt: "missing session" }, "codex", runtimeIdentity);
  await handleHook(vault, { hook_event_name: "Stop", turn_id: "assistant", cwd, last_assistant_message: "still missing" }, "codex", runtimeIdentity);
  assert.equal((await capabilityReport(home))[1]?.level, 1);
  assert.equal(await verifiedCodexLifecycleSession(vault, [runtimeIdentity]), undefined);
});

test("downgrades L2 when referenced raw evidence is tampered", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "linger-adapters-tamper-"));
  const runtimeIdentity = await installCodexFixture(home);
  const cwd = await mkdtemp(path.join(os.tmpdir(), "linger-adapters-project-"));
  const vault = path.join(home, ".linger", "vault");
  await completeLifecycle(home, cwd, "tamper-session", runtimeIdentity);
  assert.equal((await capabilityReport(home))[1]?.level, 2);
  const project = await projectId(cwd, vault);
  const sessionDir = path.join(vault, "raw", project, "tamper-session");
  const records = await Promise.all((await readdir(sessionDir)).map(async name => ({ name, value: JSON.parse(await readFile(path.join(sessionDir, name), "utf8")) })));
  const assistant = records.find(record => record.value.role === "assistant");
  assert.ok(assistant);
  const rawFile = path.join(sessionDir, assistant.name);
  const raw = assistant.value;
  raw.content = "tampered without updating the committed hash";
  await writeFile(rawFile, JSON.stringify(raw));
  assert.equal((await capabilityReport(home))[1]?.level, 1);
});

async function installCodexFixture(home: string): Promise<string> {
  await mkdir(path.join(home, ".agents", "skills", "linger"), { recursive: true });
  await writeFile(path.join(home, ".agents", "skills", "linger", "SKILL.md"), "installed");
  const runtime = runtimeRoot(home);
  await mkdir(path.join(runtime, "dist"), { recursive: true });
  await writeFile(path.join(runtime, "dist", "hook-cli.js"), "// installed runtime\n");
  const runtimeIdentity = await runtimeFingerprint(runtime, process.execPath);
  await writeCodexHooks(home, runtimeIdentity);
  return runtimeIdentity;
}

async function writeCodexHooks(home: string, runtimeIdentity: string): Promise<void> {
  const command = posixHookCommand({
    adapter: "codex",
    runtime_identity: runtimeIdentity,
    node: process.execPath,
    hook: path.join(runtimeRoot(home), "dist", "hook-cli.js")
  });
  const group = { hooks: [{ type: "command", command }] };
  await mkdir(path.join(home, ".codex"), { recursive: true });
  await writeFile(path.join(home, ".codex", "hooks.json"), JSON.stringify({ hooks: { SessionStart: [group], UserPromptSubmit: [group], Stop: [group] } }));
}

function runtimeRoot(home: string): string { return path.join(home, ".linger", "runtime", "0.2.0-alpha.0"); }

async function completeLifecycle(home: string, cwd: string, session: string, runtimeIdentity: string): Promise<void> {
  const vault = path.join(home, ".linger", "vault");
  await handleHook(vault, { hook_event_name: "SessionStart", session_id: session, cwd }, "codex", runtimeIdentity);
  await handleHook(vault, { hook_event_name: "UserPromptSubmit", session_id: session, turn_id: "user", cwd, prompt: "runtime-bound user evidence" }, "codex", runtimeIdentity);
  await handleHook(vault, { hook_event_name: "Stop", session_id: session, turn_id: "assistant", cwd, last_assistant_message: "runtime-bound assistant evidence" }, "codex", runtimeIdentity);
}
