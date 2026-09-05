import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { localEmbeddingStatus } from "./local-embedding.js";
import { vaultPaths } from "../paths.js";
import { setSetting } from "../settings.js";
import { capture } from "../capture.js";
import { processQueue } from "../processing.js";
import { configureLocalEmbedding, LocalEmbeddingWorker, suggestLocalTags } from "./local-embedding-runtime.js";
import { LOCAL_CANDIDATE_MAX_REQUESTS } from "./local-candidate-acquisition.js";
import { modelArtifactSpecs, validateLocalModelCandidateManifest } from "./local-model-manifest.js";
import { runtimeArtifactSpecs, validateLocalRuntimeCandidateManifest } from "./local-runtime-manifest.js";

test("Local artifact request cap includes every permitted redirect", async () => {
  const runtime = validateLocalRuntimeCandidateManifest(JSON.parse(await readFile("local-runtime-manifests/darwin-arm64-transformers-4.2.0.json", "utf8")));
  const model = validateLocalModelCandidateManifest(JSON.parse(await readFile("local-model-manifests/multilingual-e5-base-onnx-q8.json", "utf8")));
  const specs = [...runtimeArtifactSpecs(runtime), ...modelArtifactSpecs(model)];
  assert.equal(specs.length, 55);
  assert.equal(LOCAL_CANDIDATE_MAX_REQUESTS, specs.reduce((total, spec) => total + 1 + (spec.redirect?.max_hops ?? 0), 0));
});

test("Local Embedding status and bounded tag worker lifecycle use the selected profile", async t => {
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

  // Synthetic transport acceptance only: these files and vectors are not a real E5 model.
  await configureLocalEmbedding(root, { projectId: "p_local", installRoot });
  for (let group = 0; group < 2; group++) await capture(root, { projectId: "p_local", sessionId: "s", turnId: String(group), role: "user", sourceAgent: "test",
    content: Array.from({ length: 12 }, (_, index) => `topic-${group * 12 + index}`).join(" ") });
  await processQueue(root);
  const batches: string[][] = [];
  let starts = 0, closes = 0, fail = false;
  t.mock.method(LocalEmbeddingWorker, "start", async (_root: string, selectedRoot: string) => {
    assert.equal(selectedRoot, installRoot);
    starts++;
    return {
      embed: async (inputs: string[], dimension: number, timeoutMs: number) => {
        assert.ok(inputs.length <= 16, "worker protocol allows at most 16 inputs");
        assert.equal(dimension, 768);
        assert.ok(timeoutMs > 0 && timeoutMs <= 30_000);
        if (fail) throw new Error("embedding.worker_timeout");
        batches.push(inputs);
        return { dimension, vectors: inputs.map(() => [1, ...Array<number>(767).fill(0)]) };
      },
      close: async () => { closes++; }
    };
  });
  for (let request = 0; request < 2; request++) {
    const suggestions = await suggestLocalTags(root, "p_local", "topic-0");
    assert.equal(suggestions.semantic_status, "active");
    assert.equal(suggestions.considered_tags, 24);
    assert.equal(suggestions.candidates[0]?.tag, "topic-0");
  }
  assert.deepEqual(batches.map(batch => batch.length), [16, 9, 16, 9]);
  assert.equal(batches[0]![0], "query: topic-0");
  assert.ok(batches[0]!.slice(1).every(input => input.startsWith("passage: topic ")));
  fail = true;
  assert.equal((await suggestLocalTags(root, "p_local", "topic-0")).semantic_status, "unavailable");
  assert.equal(starts, 3);
  assert.equal(closes, 3);
  assert.equal((await localEmbeddingStatus(root, "p_local")).index_status, "missing");
});
