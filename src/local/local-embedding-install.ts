import { lstat, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { acquireLocalCandidate } from "./local-candidate-acquisition.js";
import { configureLocalEmbedding, readInstalledLocalRuntime } from "./local-embedding-runtime.js";
import { installLocalCandidate } from "./local-runtime-install.js";
import { validateLocalModelCandidateManifest } from "./local-model-manifest.js";
import { validateLocalRuntimeCandidateManifest } from "./local-runtime-manifest.js";
import { assertSafeId, vaultPaths } from "../paths.js";
import { resolveSettings } from "../settings.js";

const TRANSACTION_ID = "local-e5-base-q8-d15bb63d";

export interface LocalEmbeddingInstallPlan {
  schema_version: 1;
  profile_id: "local-multilingual-e5-base-q8-v1";
  platform: "darwin";
  arch: "arm64";
  runtime: "@huggingface/transformers@4.2.0";
  model: "onnx-community/multilingual-e5-base-ONNX@d15bb63d1494d49ff653bb0105592a2696e7a8b6";
  dtype: "q8";
  dimension: 768;
  runtime_packages: number;
  known_runtime_unpacked_bytes: number;
  known_model_bytes: number;
  acquisition_body_cap_bytes: number;
  install_free_space_required_bytes: number;
  licenses: string[];
  local_inference_only: true;
  project_content_sent: false;
  package_manager_executed: false;
  lifecycle_scripts_executed: false;
}

export async function localEmbeddingInstallPlan(packageRoot: string): Promise<LocalEmbeddingInstallPlan> {
  const { runtime, model } = await readManifests(packageRoot);
  return {
    schema_version: 1,
    profile_id: "local-multilingual-e5-base-q8-v1",
    platform: "darwin",
    arch: "arm64",
    runtime: "@huggingface/transformers@4.2.0",
    model: "onnx-community/multilingual-e5-base-ONNX@d15bb63d1494d49ff653bb0105592a2696e7a8b6",
    dtype: "q8",
    dimension: 768,
    runtime_packages: runtime.packages.length,
    known_runtime_unpacked_bytes: runtime.known_unpacked_bytes,
    known_model_bytes: model.files.reduce((sum, file) => sum + (file.expected_bytes ?? 0), 0),
    acquisition_body_cap_bytes: 600 * 1024 * 1024,
    install_free_space_required_bytes: 768 * 1024 * 1024,
    licenses: [...new Set(runtime.packages.map(item => normalizeLicense(item.license)).concat(normalizeLicense(model.declared_license)))].sort(),
    local_inference_only: true,
    project_content_sent: false,
    package_manager_executed: false,
    lifecycle_scripts_executed: false
  };
}

export async function installLocalEmbeddingForProject(root: string, input: { projectId: string; packageRoot: string }): Promise<{ profile_id: string; install_root: string; desired_enabled: false }> {
  const projectId = assertSafeId(input.projectId, "project id");
  const { runtime, model } = await readManifests(input.packageRoot);
  const installedRoot = path.join(vaultPaths(root).modelCache, "installed", model.profile_id);
  let installedFresh = false;
  if (!await exists(installedRoot)) {
    const receipt = path.join(vaultPaths(root).modelCache, "staging", TRANSACTION_ID, "acquisition-receipt.json");
    if (!await exists(receipt)) await acquireLocalCandidate(root, { transactionId: TRANSACTION_ID, runtimeManifest: runtime, modelManifest: model });
    await installLocalCandidate(root, { transactionId: TRANSACTION_ID, runtimeManifest: runtime, modelManifest: model });
    installedFresh = true;
  } else {
    await readInstalledLocalRuntime(root, installedRoot);
  }
  const profile = await configureLocalEmbedding(root, { projectId, installRoot: installedRoot });
  if (installedFresh) await rm(path.join(vaultPaths(root).modelCache, "staging", TRANSACTION_ID), { recursive: true, force: true });
  return { profile_id: profile.profile_id, install_root: installedRoot, desired_enabled: false };
}

export async function removeLocalEmbeddingRuntime(root: string, projectIdInput: string, confirmed: boolean): Promise<{ removed: true; profile_id: string; derived_indexes_preserved: true }> {
  if (!confirmed) throw new Error("embedding.runtime_delete_confirmation_required");
  const projectId = assertSafeId(projectIdInput, "project id");
  const current = await resolveSettings(root, { projectId });
  const profileId = String(current.values["embedding.profile_id"].value);
  if (!profileId) throw new Error("embedding.profile_not_selected");
  if (current.values["embedding.desired_enabled"].value === true) throw new Error("embedding.runtime_still_enabled");
  for (const otherProject of await projectSettingIds(root)) {
    const settings = await resolveSettings(root, { projectId: otherProject });
    if (settings.values["embedding.desired_enabled"].value === true && settings.values["embedding.profile_id"].value === profileId) throw new Error("embedding.runtime_still_enabled");
  }
  const installedRoot = path.join(vaultPaths(root).modelCache, "installed", assertSafeId(profileId, "embedding profile id"));
  await readInstalledLocalRuntime(root, installedRoot);
  await rm(installedRoot, { recursive: true });
  return { removed: true, profile_id: profileId, derived_indexes_preserved: true };
}

async function readManifests(packageRoot: string): Promise<{ runtime: ReturnType<typeof validateLocalRuntimeCandidateManifest>; model: ReturnType<typeof validateLocalModelCandidateManifest> }> {
  const runtime = validateLocalRuntimeCandidateManifest(JSON.parse(await readFile(path.join(packageRoot, "local-runtime-manifests", "darwin-arm64-transformers-4.2.0.json"), "utf8")) as unknown);
  const model = validateLocalModelCandidateManifest(JSON.parse(await readFile(path.join(packageRoot, "local-model-manifests", "multilingual-e5-base-onnx-q8.json"), "utf8")) as unknown);
  return { runtime, model };
}
async function projectSettingIds(root: string): Promise<string[]> {
  const directory = path.join(vaultPaths(root).root, "settings", "projects");
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter(entry => entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith(".json"))
      .map(entry => assertSafeId(entry.name.slice(0, -5), "project id"));
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
async function exists(file: string): Promise<boolean> { try { await lstat(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }
function normalizeLicense(value: string): string { return value.toLowerCase() === "mit" ? "MIT" : value; }
