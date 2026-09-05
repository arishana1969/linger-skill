import path from "node:path";
import { statfs } from "node:fs/promises";
import { atomicJson, assertWritableInside } from "../io.js";
import { downloadLocalArtifact, verifyLocalArtifact, type LocalArtifactBudget, type LocalArtifactReceipt } from "./local-artifact-download.js";
import { modelArtifactSpecs, modelCandidateIdentity, validateLocalModelCandidateManifest } from "./local-model-manifest.js";
import { runtimeArtifactSpecs, runtimeCandidateIdentity, validateLocalRuntimeCandidateManifest } from "./local-runtime-manifest.js";
import { assertSafeId, vaultPaths } from "../paths.js";

export interface LocalCandidateAcquisitionReceipt {
  schema_version: 1;
  status: "artifacts_acquired_not_installed";
  transaction_id: string;
  platform: "darwin";
  arch: "arm64";
  node: string;
  runtime_manifest_sha256: string;
  model_manifest_sha256: string;
  request_count: number;
  application_bytes: number;
  artifacts: LocalArtifactReceipt[];
  predecessor_reverified_count: number;
  network_downloaded_count: number;
  lifecycle_scripts_executed: false;
  package_manager_executed: false;
  project_content_sent: false;
  acquired_at: string;
}

// 55 initial requests plus up to two redirects for each of the five model files.
export const LOCAL_CANDIDATE_MAX_REQUESTS = 65;

export async function acquireLocalCandidate(
  root: string,
  input: { transactionId: string; runtimeManifest: unknown; modelManifest: unknown; now?: Date }
): Promise<LocalCandidateAcquisitionReceipt> {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("embedding.platform_unsupported");
  const transactionId = assertSafeId(input.transactionId, "Local artifact transaction id");
  const runtime = validateLocalRuntimeCandidateManifest(input.runtimeManifest);
  const model = validateLocalModelCandidateManifest(input.modelManifest);
  if (runtime.node !== process.version) throw new Error("embedding.runtime_node_mismatch");
  const deadline = Date.now() + 15 * 60_000;
  const filesystem = await statfs(root);
  const freeBytes = filesystem.bavail * filesystem.bsize;
  if (!Number.isSafeInteger(freeBytes) || freeBytes < 632 * 1024 * 1024) throw new Error("embedding.artifact_disk_space_insufficient");
  const runtimeSpecs = runtimeArtifactSpecs(runtime);
  const modelSpecs = modelArtifactSpecs(model);
  const specs = [...runtimeSpecs, ...modelSpecs];
  if (specs.length !== 55) throw new Error("embedding.candidate_request_plan_invalid");
  const budget: LocalArtifactBudget = {
    max_bytes: 600 * 1024 * 1024,
    used_bytes: 0,
    max_requests: LOCAL_CANDIDATE_MAX_REQUESTS,
    used_requests: 0
  };
  const predecessor: LocalArtifactReceipt[] = [];
  const downloaded: LocalArtifactReceipt[] = [];
  for (const spec of specs) {
    try { predecessor.push(await verifyLocalArtifact(root, transactionId, spec)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      downloaded.push(await downloadLocalArtifact(root, transactionId, spec, budget, { totalTimeoutMs: remainingTimeout(deadline, 180_000) }));
    }
  }
  const receipts = specs.map(spec => [...predecessor, ...downloaded].find(item => item.relative_path === spec.relative_path)!);
  const receipt: LocalCandidateAcquisitionReceipt = {
    schema_version: 1,
    status: "artifacts_acquired_not_installed",
    transaction_id: transactionId,
    platform: "darwin",
    arch: "arm64",
    node: process.version,
    runtime_manifest_sha256: runtimeCandidateIdentity(runtime),
    model_manifest_sha256: modelCandidateIdentity(model),
    request_count: budget.used_requests,
    application_bytes: budget.used_bytes,
    artifacts: receipts,
    predecessor_reverified_count: predecessor.length,
    network_downloaded_count: downloaded.length,
    lifecycle_scripts_executed: false,
    package_manager_executed: false,
    project_content_sent: false,
    acquired_at: (input.now ?? new Date()).toISOString()
  };
  const file = path.join(vaultPaths(root).modelCache, "staging", transactionId, "acquisition-receipt.json");
  await assertWritableInside(root, file);
  await atomicJson(file, receipt);
  return receipt;
}

function remainingTimeout(deadline: number, perRequestCap: number): number {
  const remaining = deadline - Date.now();
  if (remaining < 1_000) throw new Error("embedding.candidate_total_timeout");
  return Math.min(remaining, perRequestCap);
}
