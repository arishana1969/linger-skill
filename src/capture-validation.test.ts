import assert from "node:assert/strict";
import { access, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";

test("capture rejects invalid enum values before initializing the Vault", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "linger-capture-validation-"));
  const root = path.join(parent, "vault");
  const base = { projectId: "p", sessionId: "s", turnId: "t", role: "user" as const, content: "valid content", sourceAgent: "test" };
  await assert.rejects(capture(root, { ...base, role: "tool" as never }), /Role must/);
  await assert.rejects(capture(root, { ...base, savepointStatus: "finished" as never }), /Savepoint status must/);
  await assert.rejects(capture(root, { ...base, sensitivity: "public" as never }), /Sensitivity must/);
  await assert.rejects(access(root));
});
