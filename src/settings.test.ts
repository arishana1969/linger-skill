import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { capture } from "./capture.js";
import { processQueue } from "./processing.js";
import { search } from "./search.js";
import { resolveSettings, setSetting } from "./settings.js";
import { initVault } from "./vault.js";

test("effective settings are pure-read and report builtin sources for an absent Vault", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "linger-settings-read-"));
  const root = path.join(parent, "absent-vault");
  const settings = await resolveSettings(root, { projectId: "p_read" });
  assert.equal(settings.values["recall.max_characters"].value, 12000);
  assert.equal(settings.values["recall.max_characters"].source, "builtin");
  assert.equal(settings.values["embedding.desired_enabled"].value, false);
  await assert.rejects(access(root));
});

test("effective settings apply global and project precedence while ignoring deprecated keys", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-settings-"));
  await setSetting(root, { scope: "global", key: "recall.max_characters", value: 24000 });
  await setSetting(root, { scope: "project", projectId: "p_one", key: "recall.max_characters", value: 6000 });
  const global = path.join(root, "settings", "global.json");
  await mkdir(path.dirname(global), { recursive: true });
  await writeFile(global, JSON.stringify({ schema_version: 1, scope: "global", revision: 1, updated_at: new Date().toISOString(), values: { "notifications.abnormal": false } }));
  const settings = await resolveSettings(root, { projectId: "p_one" });
  assert.equal(Object.hasOwn(settings.values, "notifications.abnormal"), false);
  assert.equal(settings.values["recall.max_characters"].value, 6000);
  assert.equal(settings.values["recall.max_characters"].source, "project");
});

test("search consumes the project effective max-snippets setting", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linger-settings-search-"));
  await initVault(root);
  await setSetting(root, { scope: "project", projectId: "p_search", key: "recall.max_snippets", value: 1 });
  await capture(root, { projectId: "p_search", sessionId: "s", turnId: "one", role: "user", content: "orchid storage first", sourceAgent: "test" });
  await capture(root, { projectId: "p_search", sessionId: "s", turnId: "two", role: "user", content: "orchid storage second", sourceAgent: "test" });
  await processQueue(root, "p_search");
  assert.equal((await search(root, { projectId: "p_search", query: "orchid storage" })).length, 1);
});
