import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { install } from "./installer.js";
import { processQueue } from "./processing.js";
import { search } from "./search.js";
import { projectId } from "./vault.js";

test("installed runtime captures after the source package is no longer its execution path", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "linger-stable-home-"));
  const cwd = await mkdtemp(path.join(os.tmpdir(), "linger-stable-project-"));
  const result = await install({ home, packageRoot: process.cwd(), adapters: ["codex"] });
  assert.notEqual(result.manifest.runtime_root, process.cwd());
  const hook = path.join(result.manifest.runtime_root, "dist", "hook-cli.js");
  await runHook(hook, home, { hook_event_name: "UserPromptSubmit", session_id: "stable", turn_id: "one", cwd, prompt: "记一下稳定运行时方案" });
  const vault = path.join(home, ".linger", "vault");
  await processQueue(vault);
  const hits = await search(vault, { projectId: await projectId(cwd), query: "稳定运行时" });
  assert.match(hits[0]?.snippet ?? "", /稳定运行时/);
});

async function runHook(file: string, home: string, payload: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [file], { env: { ...process.env, HOME: home, LINGER_ADAPTER: "codex" } });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", code => code === 0 && !stderr ? resolve() : reject(new Error(stderr || `hook exited ${code}`)));
    child.stdin.end(JSON.stringify(payload));
  });
}
