import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capabilityReport } from "./adapters.js";

test("reports honest degraded adapter levels", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "continuity-adapters-"));
  assert.deepEqual((await capabilityReport(home)).map(item => item.level), [0, 0]);
  await mkdir(path.join(home, ".claude", "skills", "continuity"), { recursive: true });
  await writeFile(path.join(home, ".claude", "skills", "continuity", "SKILL.md"), "installed");
  assert.equal((await capabilityReport(home))[0]?.level, 1);
  await writeFile(path.join(home, ".claude", "settings.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [] }] } }));
  assert.equal((await capabilityReport(home))[0]?.level, 2);
});

test("detects Codex skill and hooks independently", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "continuity-adapters-"));
  await mkdir(path.join(home, ".codex", "skills", "continuity"), { recursive: true });
  await writeFile(path.join(home, ".codex", "skills", "continuity", "SKILL.md"), "installed");
  await writeFile(path.join(home, ".codex", "config.toml"), "[hooks]\nenabled = true\n");
  const codex = (await capabilityReport(home))[1]!;
  assert.equal(codex.level, 1);
  assert.equal(codex.capabilities.lifecycle_hooks, false);
  assert.equal(codex.capabilities.async_processing, false);
  assert.match(codex.limitations.join(" "), /trust/);
});
