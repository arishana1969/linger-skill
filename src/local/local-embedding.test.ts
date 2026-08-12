import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { localEmbeddingStatus } from "./local-embedding.js";
import { vaultPaths } from "../paths.js";
import { setSetting } from "../settings.js";

test("Local Embedding status is read-only, honest before installation, and validates one exact local profile", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "linger-local-embedding-"));
  const absent = path.join(parent, "absent");
  assert.deepEqual(await localEmbeddingStatus(absent, "p_local"), {
    backend_kind: "local", project_id: "p_local", desired_enabled: false, profile_id: null,
    profile_status: "not_selected", runtime_ready: false, index_status: "missing", state: "off", effective_mode: "lexical", last_error: null
  });
  await assert.rejects(access(absent));

  const root = path.join(parent, "vault");
  const profileId = "local-multilingual-e5-base-q8-v1";
  await setSetting(root, { scope: "project", projectId: "p_local", key: "embedding.profile_id", value: profileId });
  await setSetting(root, { scope: "project", projectId: "p_local", key: "embedding.desired_enabled", value: true });
  let current = await localEmbeddingStatus(root, "p_local");
  assert.equal(current.state, "unsupported");
  assert.equal(current.last_error, "embedding.profile_missing");

  const profileDir = path.join(vaultPaths(root).registry, "embedding-profiles");
  await mkdir(profileDir, { recursive: true });
  const installRoot = path.join(vaultPaths(root).modelCache, "installed", profileId);
  await mkdir(path.join(installRoot, "node_modules/@huggingface/transformers/src"), { recursive: true });
  await mkdir(path.join(installRoot, "model/onnx"), { recursive: true });
  for (const file of ["node_modules/@huggingface/transformers/src/transformers.js", "model/config.json", "model/tokenizer.json", "model/onnx/model_quantized.onnx"]) await writeFile(path.join(installRoot, file), "fixture");
  const contentEntries = [
    { path: "model", type: "directory" },
    { path: "model/config.json", type: "file", bytes: 7, sha256: createHash("sha256").update("fixture").digest("hex") }
  ];
  const contentTreeSha256 = createHash("sha256").update(JSON.stringify(contentEntries)).digest("hex");
  const contentManifest = `${JSON.stringify({
    schema_version: 1,
    entries: contentEntries,
    file_count: 1,
    directory_count: 1,
    content_bytes: 7,
    tree_sha256: contentTreeSha256
  }, null, 2)}\n`;
  await writeFile(path.join(installRoot, "content-manifest.json"), contentManifest);
  const installManifest = `${JSON.stringify({
    schema_version: 1, status: "installed_candidate_validated", profile_id: profileId,
    platform: process.platform, arch: process.arch, node: process.version,
    runtime_identity: "a".repeat(64), model_identity: "b".repeat(64), input_policy_id: "multilingual-e5-query-passage-v1",
    dimension: 768, runtime_entry: "node_modules/@huggingface/transformers/src/transformers.js", model_path: "model",
    package_count: 50, package_entry_count: 1, runtime_unpacked_bytes: 1, model_bytes: 1,
    acquisition_receipt_sha256: "c".repeat(64), lifecycle_scripts_executed: false, package_manager_executed: false,
    content_manifest: "content-manifest.json", content_manifest_sha256: createHash("sha256").update(contentManifest).digest("hex"),
    content_tree_sha256: contentTreeSha256, content_file_count: 1, content_directory_count: 1, content_bytes: 7,
    installed_at: "2026-08-11T00:00:00.000Z"
  }, null, 2)}\n`;
  await writeFile(path.join(installRoot, "install-manifest.json"), installManifest);
  await writeFile(path.join(profileDir, `${profileId}.json`), `${JSON.stringify({
    schema_version: 1,
    profile_id: profileId,
    backend_kind: "local",
    validation_state: "validated",
    runtime_identity: "a".repeat(64),
    model_identity: "b".repeat(64),
    install_manifest_sha256: createHash("sha256").update(installManifest).digest("hex"),
    input_policy_id: "multilingual-e5-query-passage-v1",
    dimension: 768,
    platform: { os: process.platform, arch: process.arch, node_major: Number(process.versions.node.split(".")[0]) },
    license: { spdx: "MIT", source: "fixture" },
    install_root: installRoot,
    validated_at: "2026-08-11T00:00:00.000Z"
  }, null, 2)}\n`);
  current = await localEmbeddingStatus(root, "p_local");
  assert.equal(current.profile_status, "validated");
  assert.equal(current.runtime_ready, true);
  assert.equal(current.state, "validated");
  assert.equal(current.index_status, "missing");
  assert.equal(current.effective_mode, "lexical");
});
