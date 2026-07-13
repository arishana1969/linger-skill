import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);

test("CLI generates separated data and runs the real-vault evaluation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-eval-cli-"));
  const generated = JSON.parse((await run(process.execPath, [path.resolve("dist/eval-cli.js"), "generate", "--output", root, "--year", "2025"])).stdout) as { fixture: string; oracle: string };
  assert.notEqual(path.dirname(generated.fixture), path.dirname(generated.oracle));
  const report = JSON.parse((await run(process.execPath, [path.resolve("dist/eval-cli.js"), "run", "--fixture", generated.fixture, "--oracle", generated.oracle])).stdout) as { scores: { macro_composite: number; missing_predictions: string[] } };
  assert.equal(report.scores.macro_composite, 1);
  assert.deepEqual(report.scores.missing_predictions, []);
});

test("CLI adversarial gate reports a perfect macro score", async () => {
  const report = JSON.parse((await run(process.execPath, [path.resolve("dist/eval-cli.js"), "adversarial"])).stdout) as { scores: { macro_composite: number } };
  assert.equal(report.scores.macro_composite, 1);
});

test("CLI held-out gate runs a configurable larger vault", async () => {
  const report = JSON.parse((await run(process.execPath, [path.resolve("dist/eval-cli.js"), "heldout", "--noise", "24"])).stdout) as { imported: number; scores: { macro_composite: number } };
  assert.equal(report.imported, 36);
  assert.equal(report.scores.macro_composite, 1);
});

test("CLI rejects unknown fixture mutation types", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-eval-cli-invalid-"));
  const fixture = path.join(root, "fixture.json");
  const oracle = path.join(root, "oracle.json");
  await writeFile(fixture, JSON.stringify({ schema_version: 1, name: "invalid", start: "2025-01-01T00:00:00.000Z", end: "2025-12-31T00:00:00.000Z", events: [], mutations: [{ type: "overwrite_any_path", event_id: "x" }] }));
  await writeFile(oracle, JSON.stringify({ oracle: [] }));
  await assert.rejects(run(process.execPath, [path.resolve("dist/eval-cli.js"), "run", "--fixture", fixture, "--oracle", oracle]), /invalid fixture mutation/);
});
