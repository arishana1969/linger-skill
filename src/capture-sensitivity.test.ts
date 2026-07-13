import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { capture } from "./capture.js";
import { processQueue } from "./processing.js";
import { search } from "./search.js";

const exec = promisify(execFile);

test("direct capture auto-redacts detected secrets and excludes them from recall", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-capture-secret-"));
  const event = await capture(root, { projectId: "p", sessionId: "s", turnId: "t", role: "user", content: "API_KEY=abcdefghijklmnop", sourceAgent: "manual", sensitivity: "normal" });
  assert.equal(event?.sensitivity, "secret");
  assert.doesNotMatch(event?.content ?? "", /abcdefghijklmnop/);
  assert.match(event?.content ?? "", /REDACTED/);
  assert.doesNotMatch(await readFile(path.join(root, event!.raw_ref), "utf8"), /abcdefghijklmnop/);
  await processQueue(root);
  assert.deepEqual(await search(root, { projectId: "p", query: "API_KEY" }), []);
});

test("direct capture auto-classifies contact data and never lowers explicit sensitivity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-capture-sensitive-"));
  const contact = await capture(root, { projectId: "p", sessionId: "s1", turnId: "t1", role: "user", content: "contact person@example.com", sourceAgent: "manual" });
  const explicit = await capture(root, { projectId: "p", sessionId: "s2", turnId: "t2", role: "user", content: "custom unknown secret material", sourceAgent: "manual", sensitivity: "secret" });
  assert.equal(contact?.sensitivity, "sensitive");
  assert.match(contact?.content ?? "", /person@example.com/);
  assert.equal(explicit?.sensitivity, "secret");
});

test("manual CLI capture cannot bypass high-confidence secret redaction", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-cli-secret-"));
  const result = JSON.parse((await exec(process.execPath, [path.resolve("dist/cli.js"), "capture", "--vault", root, "--project", "p", "--session", "s", "--turn", "t", "--role", "user", "--content", "password=correct-horse-battery-staple"])).stdout) as { content: string; sensitivity: string; raw_ref: string };
  assert.equal(result.sensitivity, "secret");
  assert.doesNotMatch(result.content, /correct-horse/);
  assert.doesNotMatch(await readFile(path.join(root, result.raw_ref), "utf8"), /correct-horse/);
});
