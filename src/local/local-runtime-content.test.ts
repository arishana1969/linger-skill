import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyInstalledRuntimeContent, writeRuntimeContentManifest } from "./local-runtime-content.js";

test("installed Local runtime content is tree-bound and mutations fail closed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-runtime-content-"));
  const installed = path.join(root, "model-cache", "installed", "fixture");
  await mkdir(path.join(installed, "model"), { recursive: true, mode: 0o700 });
  await writeFile(path.join(installed, "model", "config.json"), "original", { mode: 0o600 });

  const written = await writeRuntimeContentManifest(installed);
  const verified = await verifyInstalledRuntimeContent(root, installed, written.sha256);
  assert.equal(verified.file_count, 1);
  assert.equal(verified.directory_count, 1);

  await writeFile(path.join(installed, "model", "config.json"), "mutated", { mode: 0o600 });
  await assert.rejects(verifyInstalledRuntimeContent(root, installed, written.sha256), /embedding\.runtime_content_mismatch/);
});
