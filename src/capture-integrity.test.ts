import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";

test("deduplicated capture refuses a tampered raw record instead of returning or replacing it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-capture-integrity-"));
  const input = { projectId: "p", sessionId: "s", turnId: "t", role: "user" as const, content: "immutable raw sentinel", sourceAgent: "test" };
  const first = await capture(root, input);
  const file = path.join(root, first!.raw_ref);
  const raw = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  raw.content = "tampered raw sentinel";
  await writeFile(file, JSON.stringify(raw));

  await assert.rejects(capture(root, input), /Existing raw event failed integrity check/);
  const after = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  assert.equal(after.content, "tampered raw sentinel");
});

test("deduplicated capture refuses malformed existing JSON without replacing it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "continuity-capture-integrity-"));
  const input = { projectId: "p", sessionId: "s", turnId: "t", role: "user" as const, content: "malformed raw sentinel", sourceAgent: "test" };
  const first = await capture(root, input);
  const file = path.join(root, first!.raw_ref);
  await writeFile(file, "not-json");
  await assert.rejects(capture(root, input));
  assert.equal(await readFile(file, "utf8"), "not-json");
});
