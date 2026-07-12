import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);

test("tracked repository text contains no high-confidence credential pattern", async () => {
  const result = await exec(process.execPath, [path.resolve("scripts/scan-tracked-secrets.mjs")]);
  const report = JSON.parse(result.stdout) as { ok: boolean; scanned_files: number };
  assert.equal(report.ok, true);
  assert.ok(report.scanned_files > 100);
});
