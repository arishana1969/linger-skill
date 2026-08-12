import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeYearDataset } from "./eval-io.js";

test("writes fixture and oracle into separate trees", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-eval-"));
  const result = await writeYearDataset(root, 2025);
  const fixture = await readFile(result.fixture, "utf8");
  const oracle = await readFile(result.oracle, "utf8");
  assert.doesNotMatch(fixture, /required_evidence/);
  assert.match(oracle, /required_evidence/);
  assert.equal(result.events, 99);
  assert.equal(result.queries, 3);
});
