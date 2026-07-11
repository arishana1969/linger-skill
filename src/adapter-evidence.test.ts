import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { detectCodex } from "./adapters.js";

test("Codex capability evidence names the actual hook source", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "continuity-evidence-"));
  await mkdir(path.join(home, ".codex", "skills", "continuity"), { recursive: true });
  await writeFile(path.join(home, ".codex", "skills", "continuity", "SKILL.md"), "installed");
  const hooks = path.join(home, ".codex", "hooks.json");
  await writeFile(hooks, JSON.stringify({ hooks: { Stop: [] } }));
  const report = await detectCodex(home);
  assert.equal(report.level, 2);
  assert.equal(report.evidence[1], hooks);
});
