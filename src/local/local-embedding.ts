import { embeddingIndexStatus, readActiveEmbeddingIndexManifest } from "./embedding-index.js";
import { assertSafeId } from "../paths.js";
import { resolveSettings } from "../settings.js";
import { readInstalledLocalRuntime, readLocalEmbeddingProfile, type LocalEmbeddingProfile } from "./local-embedding-runtime.js";

export type LocalEmbeddingState = "off" | "configuring" | "validated" | "active" | "rebuild_required" | "degraded" | "unsupported";
export type LocalEmbeddingError = "embedding.profile_not_selected" | "embedding.profile_missing" | "embedding.profile_invalid" | "embedding.platform_unsupported" | "embedding.runtime_invalid" | "embedding.index_invalid" | "embedding.index_identity_mismatch";

export interface LocalEmbeddingStatus {
  backend_kind: "local";
  project_id: string;
  desired_enabled: boolean;
  profile_id: string | null;
  profile_status: "not_selected" | "missing" | "validated" | "invalid" | "incompatible";
  runtime_ready: boolean;
  index_status: "missing" | "active" | "failed" | "stale";
  state: LocalEmbeddingState;
  effective_mode: "lexical" | "hybrid";
  last_error: LocalEmbeddingError | null;
}

export async function localEmbeddingStatus(root: string, projectId: string): Promise<LocalEmbeddingStatus> {
  const project = assertSafeId(projectId, "project id");
  const settings = await resolveSettings(root, { projectId: project });
  const desired = settings.values["embedding.desired_enabled"].value === true;
  const configured = String(settings.values["embedding.profile_id"].value);
  const indexStatus = await embeddingIndexStatus(root, project);

  if (!configured) {
    return status(
      project,
      desired,
      null,
      "not_selected",
      false,
      indexStatus,
      desired ? "configuring" : "off",
      "lexical",
      desired ? "embedding.profile_not_selected" : null
    );
  }

  let profile: LocalEmbeddingProfile;
  try { profile = await readLocalEmbeddingProfile(root, configured); }
  catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return status(
      project,
      desired,
      configured,
      missing ? "missing" : "invalid",
      false,
      indexStatus,
      desired ? (missing ? "unsupported" : "degraded") : "off",
      "lexical",
      missing ? "embedding.profile_missing" : "embedding.profile_invalid"
    );
  }

  if (!platformMatches(profile)) {
    return status(
      project,
      desired,
      configured,
      "incompatible",
      false,
      indexStatus,
      desired ? "unsupported" : "off",
      "lexical",
      "embedding.platform_unsupported"
    );
  }
  try {
    const installed = await readInstalledLocalRuntime(root, profile.install_root);
    const sameRuntime = installed.manifest_sha256 === profile.install_manifest_sha256
      && installed.manifest.runtime_identity === profile.runtime_identity
      && installed.manifest.model_identity === profile.model_identity
      && installed.manifest.dimension === profile.dimension
      && installed.manifest.input_policy_id === profile.input_policy_id;
    if (!sameRuntime) throw new Error("embedding.runtime_invalid");
  } catch {
    return status(
      project,
      desired,
      configured,
      "invalid",
      false,
      indexStatus,
      desired ? "degraded" : "off",
      "lexical",
      "embedding.runtime_invalid"
    );
  }
  if (!desired) {
    return status(project, false, configured, "validated", true, indexStatus, "off", "lexical", null);
  }
  if (indexStatus === "failed") {
    return status(project, true, configured, "validated", true, "failed", "degraded", "lexical", "embedding.index_invalid");
  }
  if (indexStatus === "missing") {
    return status(project, true, configured, "validated", true, "missing", "validated", "lexical", null);
  }

  let manifest: Awaited<ReturnType<typeof readActiveEmbeddingIndexManifest>>;
  try { manifest = await readActiveEmbeddingIndexManifest(root, project); }
  catch {
    return status(project, true, configured, "validated", true, "failed", "degraded", "lexical", "embedding.index_invalid");
  }
  if (!sameIdentity(profile, manifest)) {
    return status(project, true, configured, "validated", true, "stale", "rebuild_required", "lexical", "embedding.index_identity_mismatch");
  }
  return status(project, true, configured, "validated", true, "active", "active", "hybrid", null);
}

function platformMatches(profile: LocalEmbeddingProfile): boolean {
  return profile.platform.os === process.platform && profile.platform.arch === process.arch && profile.platform.node_major === Number(process.versions.node.split(".")[0]);
}

function sameIdentity(profile: LocalEmbeddingProfile, manifest: Awaited<ReturnType<typeof readActiveEmbeddingIndexManifest>>): boolean {
  return manifest.profile_id === profile.profile_id
    && manifest.runtime_identity === profile.runtime_identity
    && manifest.model_identity === profile.model_identity
    && manifest.input_policy_id === profile.input_policy_id
    && manifest.dimension === profile.dimension;
}

function status(
  project_id: string,
  desired_enabled: boolean,
  profile_id: string | null,
  profile_status: LocalEmbeddingStatus["profile_status"],
  runtime_ready: boolean,
  index_status: LocalEmbeddingStatus["index_status"],
  state: LocalEmbeddingState,
  effective_mode: LocalEmbeddingStatus["effective_mode"],
  last_error: LocalEmbeddingError | null
): LocalEmbeddingStatus {
  return { backend_kind: "local", project_id, desired_enabled, profile_id, profile_status, runtime_ready, index_status, state, effective_mode, last_error };
}
