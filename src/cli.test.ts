import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const node = process.execPath;
const cli = path.resolve("dist/cli.js");

test("CLI runs capture to recall and decision trail in separate processes", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "linger-cli-"));
  await run(["init", "--vault", vault]);
  await run(["capture", "--vault", vault, "--project", "p_cli", "--session", "s1", "--turn", "t1", "--role", "user", "--content", "决定先使用本地文件", "--explicit"]);
  await run(["process", "--vault", vault]);
  const recalled = await run(["search", "--vault", vault, "--project", "p_cli", "--query", "本地文件"]);
  assert.match(recalled, /决定先使用本地文件/);
  const captured = JSON.parse(await run(["capture", "--vault", vault, "--project", "p_cli", "--session", "s1", "--turn", "t2", "--role", "user", "--content", "数据库方案证据"]));
  await run(["decision-add", "--vault", vault, "--project", "p_cli", "--topic", "storage", "--statement", "Use files", "--source", "user_explicit", "--confidence", "1", "--evidence", captured.event_id]);
  const trail = JSON.parse(await run(["decision-get", "--vault", vault, "--project", "p_cli", "--topic", "storage"]));
  assert.equal(trail.view.current_state, "Use files");
});

test("CLI accepts the global Vault option before the command", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "linger-cli-global-vault-"));
  const initialized = JSON.parse(await run(["--vault", vault, "init"])) as { schema_version: number };
  assert.equal(initialized.schema_version, 1);
});

test("CLI config show is read-only and config set exposes effective source", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "linger-cli-config-"));
  const vault = path.join(parent, "vault");
  const initial = JSON.parse(await run(["config", "show", "--vault", vault, "--project", "p_cli"])) as { values: Record<string, { value: unknown; source: string }> };
  assert.equal(initial.values["staleness.threshold_days"]?.value, 90);
  assert.equal(initial.values["staleness.threshold_days"]?.source, "builtin");
  await assert.rejects(access(vault));

  const updated = JSON.parse(await run(["config", "set", "--vault", vault, "--scope", "project", "--project", "p_cli", "--key", "staleness.threshold_days", "--value", "120"])) as { values: Record<string, { value: unknown; source: string }> };
  assert.equal(updated.values["staleness.threshold_days"]?.value, 120);
  assert.equal(updated.values["staleness.threshold_days"]?.source, "project");
});

test("CLI reuses recent hook-owned explicit evidence and refuses duplicate decision-add", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "linger-cli-hook-owned-"));
  const { capture } = await import("./capture.js");
  const hook = await capture(vault, {
    projectId: "p_owned", sessionId: "live", turnId: "turn", role: "user",
    content: "请用 Linger 记一下：最终验收代号是 aurora-ds-418。完成后继续主任务。",
    sourceAgent: "claude-code", explicit: true, timestamp: new Date().toISOString()
  });
  const reused = JSON.parse(await run(["capture", "--vault", vault, "--project", "p_owned", "--session", "manual", "--turn", "manual", "--role", "user", "--content", "最终验收代号是 aurora-ds-418"]));
  assert.equal(reused.event_id, hook!.event_id);
  const status = JSON.parse(await run(["status", "--vault", vault, "--project", "p_owned"]));
  assert.equal(status.raw_events, 1);
  await assert.rejects(run(["decision-add", "--vault", vault, "--project", "p_owned", "--topic", "release", "--statement", "aurora-ds-418", "--source", "user_explicit", "--confidence", "1", "--evidence", hook!.event_id]), /already owned by automatic processing/);
});

test("CLI session control is explicit and reflected in status", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "linger-cli-session-"));
  const cwd = await mkdtemp(path.join(os.tmpdir(), "linger-cli-session-project-"));
  const token = "a".repeat(64);
  assert.equal(JSON.parse(await run(["session-off", "--vault", vault, "--token", token])).capture, "off");
  const status = JSON.parse(await run(["status", "--vault", vault, "--cwd", cwd, "--session-token", token]));
  assert.equal(status.capture.session, "off");
  assert.equal(JSON.parse(await run(["session-on", "--vault", vault, "--token", token])).capture, "on");
});

test("CLI exposes tag discovery and explicit contextual curation without requiring embedding", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "linger-cli-tags-"));
  const shared = ["--vault", vault, "--project", "p_cli"];
  const evidence = JSON.parse(await run(["capture", ...shared, "--content", "The database vocabulary is reviewed for this project."]));
  await run(["process", ...shared]);
  assert.equal(JSON.parse(await run(["tags", "suggest", ...shared, "--term", "database"])).semantic_status, "off");
  assert.ok(JSON.parse(await run(["tags", "list", ...shared])).entries.length > 0);
  await run(["tags", "relate", ...shared, "--from", "db", "--to", "database", "--type", "contextual_equivalent", "--context", "backend", "--confidence", "0.95", "--evidence", evidence.event_id]);
  assert.equal(JSON.parse(await run(["tags", "relations", ...shared])).length, 1);
  assert.equal(JSON.parse(await run(["search", ...shared, "--query", "db"])).length, 0);
  const hits = JSON.parse(await run(["search", ...shared, "db", "--context", "backend"]));
  assert.equal(hits[0]?.match_type, "possible_match");
  assert.ok(hits[0]?.warning_flags.includes("term_expansion"));
  assert.equal(JSON.parse(await run(["recall", ...shared, "--query", "db", "--context", "backend"])).hits.length, 1);
  assert.match(await run(["tags", "--help"]), /never auto-create relations/);
});

async function run(args: string[]): Promise<string> { return (await exec(node, [cli, ...args])).stdout.trim(); }
