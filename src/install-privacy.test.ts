import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { install } from "./installer.js";

test("install always returns explicit local/cloud privacy notice", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "linger-privacy-"));
  const result = await install({ home, packageRoot: process.cwd(), adapters: ["codex"] });
  assert.match(result.privacy_notice, /local files/i);
  assert.match(result.privacy_notice, /model provider configured/i);
  assert.match(result.privacy_notice, /does not disable or replace host-owned memory/i);
  assert.match(result.privacy_notice, /uninstall preserves the vault/i);
});
