import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readCodexAdapterEvidence, recordCodexLiveEvent } from "./adapter-evidence.js";
import { detectCodex } from "./adapters.js";

test("Codex capability evidence names the actual hook source", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "linger-evidence-"));
  await mkdir(path.join(home, ".codex", "skills", "linger"), { recursive: true });
  await writeFile(path.join(home, ".codex", "skills", "linger", "SKILL.md"), "installed");
  const hooks = path.join(home, ".codex", "hooks.json");
  await writeFile(hooks, JSON.stringify({ hooks: { Stop: [] } }));
  const report = await detectCodex(home);
  assert.equal(report.level, 1);
  assert.match(report.evidence[1] ?? "", new RegExp(hooks.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(report.evidence[1] ?? "", /trust unverified/);
});

test("legacy unbound evidence is ignored and replaced on the next verified runtime event", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-evidence-legacy-"));
  const file = path.join(root, "registry", "adapter-evidence", "codex.json");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({
    schema_version: 1,
    adapter: "codex",
    sessions: [{
      session_id: "legacy-session",
      project_id: "legacy-project",
      first_observed_at: "2026-01-01T00:00:00.000Z",
      last_observed_at: "2026-01-01T00:00:00.000Z",
      events: { SessionStart: { observed_at: "2026-01-01T00:00:00.000Z" } }
    }]
  }));
  assert.equal(await readCodexAdapterEvidence(root), undefined);
  await recordCodexLiveEvent(root, {
    sessionId: "new-session",
    projectId: "new-project",
    runtimeIdentity: "f".repeat(64),
    event: "SessionStart"
  });
  const migrated = JSON.parse(await readFile(file, "utf8"));
  assert.equal(migrated.schema_version, 2);
  assert.equal(migrated.sessions.length, 1);
  assert.equal(migrated.sessions[0].session_id, "new-session");
});
