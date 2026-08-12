import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEmbeddingIndex, embeddingIndexStatus } from "./embedding-index.js";
import { hybridSearch, type HybridSearchResult } from "./hybrid-search.js";
import { atomicJson, assertReadableInside, assertWritableInside, ensureDir } from "../io.js";
import { readRuntimeContentManifest, verifyInstalledRuntimeContent } from "./local-runtime-content.js";
import type { LocalRuntimeInstallManifest } from "./local-runtime-install.js";
import { assertSafeId, vaultPaths } from "../paths.js";
import { resolveSettings, setSetting } from "../settings.js";
import type { SearchOptions } from "../search.js";

const PROFILE_ID = "local-multilingual-e5-base-q8-v1";
const MODEL_SOURCE = "onnx-community/multilingual-e5-base-ONNX@d15bb63d1494d49ff653bb0105592a2696e7a8b6";
export const LOCAL_E5_MINIMUM_SIMILARITY = 0.82;

export interface LocalEmbeddingProfile {
  schema_version: 1;
  profile_id: string;
  backend_kind: "local";
  validation_state: "validated";
  runtime_identity: string;
  model_identity: string;
  install_manifest_sha256: string;
  input_policy_id: string;
  dimension: number;
  platform: { os: string; arch: string; node_major: number };
  license: { spdx: string; source: string };
  install_root: string;
  validated_at: string;
}

interface InstalledLocalRuntime {
  root: string;
  manifest: LocalRuntimeInstallManifest;
  manifest_sha256: string;
}

export async function configureLocalEmbedding(root: string, input: { projectId: string; installRoot: string; now?: Date }): Promise<LocalEmbeddingProfile> {
  const projectId = assertSafeId(input.projectId, "project id");
  const installed = await readInstalledLocalRuntime(root, input.installRoot);
  const profile: LocalEmbeddingProfile = {
    schema_version: 1,
    profile_id: installed.manifest.profile_id,
    backend_kind: "local",
    validation_state: "validated",
    runtime_identity: installed.manifest.runtime_identity,
    model_identity: installed.manifest.model_identity,
    install_manifest_sha256: installed.manifest_sha256,
    input_policy_id: installed.manifest.input_policy_id,
    dimension: installed.manifest.dimension,
    platform: {
      os: installed.manifest.platform,
      arch: installed.manifest.arch,
      node_major: Number(process.versions.node.split(".")[0])
    },
    license: { spdx: "MIT", source: MODEL_SOURCE },
    install_root: installed.root,
    validated_at: (input.now ?? new Date()).toISOString()
  };
  const profileFile = path.join(vaultPaths(root).registry, "embedding-profiles", `${profile.profile_id}.json`);
  await assertWritableInside(root, profileFile);
  await ensureDir(path.dirname(profileFile));
  await atomicJson(profileFile, profile);
  await setSetting(root, { scope: "project", key: "embedding.profile_id", value: profile.profile_id, projectId });
  return profile;
}

export async function setLocalEmbeddingEnabled(
  root: string,
  projectIdInput: string,
  enabled: boolean
): Promise<{ project_id: string; desired_enabled: boolean; profile_id: string }> {
  const projectId = assertSafeId(projectIdInput, "project id");
  const settings = await resolveSettings(root, { projectId });
  const profileId = String(settings.values["embedding.profile_id"].value);
  if (enabled && !profileId) throw new Error("embedding.profile_not_selected");
  if (enabled) await readInstalledLocalRuntime(root, (await readCurrentProfile(root, profileId)).install_root);
  await setSetting(root, { scope: "project", key: "embedding.desired_enabled", value: enabled, projectId });
  return { project_id: projectId, desired_enabled: enabled, profile_id: profileId };
}

export async function rebuildLocalEmbeddingIndex(
  root: string,
  projectIdInput: string
): Promise<{ generation_id: string; vector_count: number; dimension: number; manifest_sha256: string }> {
  const projectId = assertSafeId(projectIdInput, "project id");
  const settings = await resolveSettings(root, { projectId });
  if (settings.values["embedding.desired_enabled"].value !== true) throw new Error("embedding.project_not_authorized");
  const profile = await readCurrentProfile(root, String(settings.values["embedding.profile_id"].value));
  const runtime = await LocalEmbeddingWorker.start(root, profile.install_root);
  try {
    return await buildEmbeddingIndex(root, {
      projectId,
      profileId: profile.profile_id,
      runtimeIdentity: profile.runtime_identity,
      modelIdentity: profile.model_identity,
      dimension: profile.dimension,
      inputPolicyId: profile.input_policy_id,
      prepareInput: value => prepareE5Input("passage", value),
      embed: (inputs, dimension) => embedStable(runtime, inputs, dimension)
    });
  } finally {
    await runtime.close();
  }
}

export async function localHybridSearch(root: string, options: SearchOptions): Promise<HybridSearchResult> {
  const projectId = assertSafeId(options.projectId, "project id");
  let worker: LocalEmbeddingWorker | undefined;
  try {
    return await hybridSearch(root, {
      ...options,
      minimumSimilarity: LOCAL_E5_MINIMUM_SIMILARITY,
      semanticTimeoutMs: 3_000,
      embedQuery: async (query, timeoutMs) => {
        const settings = await resolveSettings(root, { projectId });
        const enabled = settings.values["embedding.desired_enabled"].value === true;
        const indexActive = await embeddingIndexStatus(root, projectId) === "active";
        if (!enabled || !indexActive) throw new Error("embedding.index_missing");
        const profile = await readCurrentProfile(root, String(settings.values["embedding.profile_id"].value));
        worker ??= await LocalEmbeddingWorker.start(root, profile.install_root);
        return (await worker.embed([prepareE5Input("query", query)], profile.dimension, timeoutMs)).vectors[0]!;
      }
    });
  } finally {
    if (worker) await worker.close();
  }
}

export async function readInstalledLocalRuntime(root: string, installRootInput: string): Promise<InstalledLocalRuntime> {
  const installedRoot = path.resolve(installRootInput);
  const allowed = path.join(vaultPaths(root).modelCache, "installed");
  const relation = path.relative(path.resolve(allowed), installedRoot);
  const insideManagedRoot = relation && !relation.startsWith("..") && !path.isAbsolute(relation);
  if (!insideManagedRoot || path.basename(installedRoot) !== PROFILE_ID) throw new Error("embedding.runtime_install_invalid");
  const rootInfo = await lstat(installedRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("embedding.runtime_install_invalid");
  const manifestFile = path.join(installedRoot, "install-manifest.json");
  await assertReadableInside(root, manifestFile);
  const bytes = await readFile(manifestFile);
  const manifest = JSON.parse(bytes.toString("utf8")) as LocalRuntimeInstallManifest;
  assertInstallManifest(manifest);
  const content = await readRuntimeContentManifest(root, installedRoot, manifest.content_manifest_sha256);
  const contentMatches = content.tree_sha256 === manifest.content_tree_sha256
    && content.file_count === manifest.content_file_count
    && content.directory_count === manifest.content_directory_count
    && content.content_bytes === manifest.content_bytes;
  if (!contentMatches) throw new Error("embedding.runtime_content_invalid");
  const requiredFiles = [
    manifest.runtime_entry,
    `${manifest.model_path}/config.json`,
    `${manifest.model_path}/tokenizer.json`,
    `${manifest.model_path}/onnx/model_quantized.onnx`
  ];
  for (const relative of requiredFiles) {
    const file = path.join(installedRoot, relative);
    await assertReadableInside(root, file);
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("embedding.runtime_install_invalid");
  }
  return { root: installedRoot, manifest, manifest_sha256: sha256(bytes) };
}

export class LocalEmbeddingWorker {
  private current: {
    id: number;
    resolve(value: { dimension: number; vectors: number[][] }): void;
    reject(error: Error): void;
    timer: NodeJS.Timeout;
  } | undefined;
  private output = "";
  private stderr = "";
  private nextId = 1;
  private closed = false;
  private constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => this.onOutput(String(chunk)));
    child.stderr.on("data", chunk => {
      this.stderr = `${this.stderr}${String(chunk)}`.slice(-4096);
    });
    child.on("error", error => this.fail(error));
    child.on("exit", code => {
      const message = code === 0 ? "embedding.worker_closed" : this.stderr.trim() || "embedding.worker_failed";
      this.fail(new Error(message));
    });
  }

  static async start(root: string, installRoot: string): Promise<LocalEmbeddingWorker> {
    const installed = await readInstalledLocalRuntime(root, installRoot);
    await verifyInstalledRuntimeContent(root, installed.root, installed.manifest.content_manifest_sha256);
    const workerFile = fileURLToPath(new URL("./local-embedding-worker.js", import.meta.url));
    const child = spawn(process.execPath, ["--max-old-space-size=512", workerFile, "--install-root", installed.root], {
      env: { LANG: "C", LC_ALL: "C", TMPDIR: "/private/tmp" },
      stdio: ["pipe", "pipe", "pipe"]
    });
    return new LocalEmbeddingWorker(child);
  }

  embed(inputs: string[], expectedDimension: number, timeoutMs: number): Promise<{ dimension: number; vectors: number[][] }> {
    if (this.closed || this.current) return Promise.reject(new Error("embedding.worker_busy"));
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 180_000) {
      return Promise.reject(new Error("embedding.worker_timeout_invalid"));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new Error("embedding.worker_timeout"));
        this.child.kill("SIGTERM");
      }, timeoutMs);
      this.current = { id, resolve, reject, timer };
      const request = `${JSON.stringify({ id, inputs, expected_dimension: expectedDimension })}\n`;
      this.child.stdin.write(request, error => {
        if (error) this.fail(error);
      });
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.child.stdin.end();
    if (this.child.exitCode !== null) return;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        this.child.kill("SIGTERM");
        resolve();
      }, 2_000);
      this.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private onOutput(chunk: string): void {
    this.output += chunk;
    if (Buffer.byteLength(this.output) > 2 * 1024 * 1024) {
      this.fail(new Error("embedding.worker_output_limit"));
      this.child.kill("SIGTERM");
      return;
    }
    const newline = this.output.indexOf("\n");
    if (newline < 0) return;
    const line = this.output.slice(0, newline);
    this.output = this.output.slice(newline + 1);
    const pending = this.current;
    if (!pending) {
      this.fail(new Error("embedding.worker_protocol_invalid"));
      return;
    }
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(line) as Record<string, unknown>;
    } catch {
      this.fail(new Error("embedding.worker_protocol_invalid"));
      return;
    }
    if (value.id !== pending.id) {
      this.fail(new Error("embedding.worker_protocol_invalid"));
      return;
    }
    clearTimeout(pending.timer);
    this.current = undefined;
    if (value.ok !== true) {
      pending.reject(new Error(typeof value.error === "string" ? value.error : "embedding.worker_failed"));
      return;
    }
    const dimension = value.dimension;
    const vectors = value.vectors;
    const vectorsValid = Number.isInteger(dimension)
      && Array.isArray(vectors)
      && vectors.every(vector => Array.isArray(vector)
        && vector.length === dimension
        && vector.every(item => typeof item === "number" && Number.isFinite(item)));
    if (!vectorsValid) {
      pending.reject(new Error("embedding.worker_protocol_invalid"));
      return;
    }
    pending.resolve({ dimension: Number(dimension), vectors: vectors as number[][] });
  }

  private fail(error: Error): void {
    const pending = this.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.current = undefined;
    pending.reject(error);
  }
}

export function prepareE5Input(kind: "query" | "passage", value: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("embedding.input_invalid");
  const prefix = `${kind}: `;
  const cap = 65_536 - Buffer.byteLength(prefix);
  let text = value.normalize("NFC");
  while (Buffer.byteLength(text) > cap) text = text.slice(0, Math.floor(text.length * 0.95));
  return `${prefix}${text}`;
}

async function embedStable(worker: LocalEmbeddingWorker, inputs: string[], dimension: number): Promise<{ dimension: number; vectors: number[][] }> {
  const vectors: number[][] = [];
  for (const input of inputs) vectors.push((await worker.embed([input], dimension, 180_000)).vectors[0]!);
  return { dimension, vectors };
}

export async function readLocalEmbeddingProfile(root: string, profileIdInput: string): Promise<LocalEmbeddingProfile> {
  const profileId = assertSafeId(profileIdInput, "embedding profile id");
  const file = path.join(vaultPaths(root).registry, "embedding-profiles", `${profileId}.json`);
  await assertReadableInside(root, file);
  const profile = JSON.parse(await readFile(file, "utf8")) as unknown;
  assertProfile(profile, profileId);
  return profile;
}

async function readCurrentProfile(root: string, profileId: string): Promise<LocalEmbeddingProfile> {
  const profile = await readLocalEmbeddingProfile(root, profileId);
  const expectedNodeMajor = Number(process.versions.node.split(".")[0]);
  if (profile.profile_id !== PROFILE_ID) throw new Error("embedding.profile_invalid");
  if (profile.platform.os !== process.platform || profile.platform.arch !== process.arch) {
    throw new Error("embedding.profile_invalid");
  }
  if (profile.platform.node_major !== expectedNodeMajor) throw new Error("embedding.profile_invalid");
  if (profile.license.spdx !== "MIT" || profile.license.source !== MODEL_SOURCE) {
    throw new Error("embedding.profile_invalid");
  }
  if (profile.input_policy_id !== "multilingual-e5-query-passage-v1" || profile.dimension !== 768) {
    throw new Error("embedding.profile_invalid");
  }
  const installed = await readInstalledLocalRuntime(root, profile.install_root);
  if (installed.manifest_sha256 !== profile.install_manifest_sha256) throw new Error("embedding.runtime_invalid");
  if (installed.manifest.runtime_identity !== profile.runtime_identity) throw new Error("embedding.runtime_invalid");
  if (installed.manifest.model_identity !== profile.model_identity) throw new Error("embedding.runtime_invalid");
  if (installed.manifest.input_policy_id !== profile.input_policy_id) throw new Error("embedding.runtime_invalid");
  if (installed.manifest.dimension !== profile.dimension) throw new Error("embedding.runtime_invalid");
  return profile;
}

function assertProfile(value: unknown, profileId: string): asserts value is LocalEmbeddingProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("embedding.profile_invalid");
  const item = value as Record<string, unknown>;
  const keys = ["schema_version", "profile_id", "backend_kind", "validation_state", "runtime_identity", "model_identity", "install_manifest_sha256", "input_policy_id", "dimension", "platform", "license", "install_root", "validated_at"];
  if (Object.keys(item).some(key => !keys.includes(key))) throw new Error("embedding.profile_invalid");
  if (item.schema_version !== 1 || item.profile_id !== profileId) throw new Error("embedding.profile_invalid");
  if (item.backend_kind !== "local" || item.validation_state !== "validated") throw new Error("embedding.profile_invalid");
  if (!hash(item.runtime_identity) || !hash(item.model_identity)) throw new Error("embedding.profile_invalid");
  if (!hash(item.install_manifest_sha256) || !identity(item.input_policy_id)) throw new Error("embedding.profile_invalid");
  if (!Number.isInteger(item.dimension) || Number(item.dimension) < 1 || Number(item.dimension) > 16_384) {
    throw new Error("embedding.profile_invalid");
  }
  if (!item.platform || typeof item.platform !== "object" || Array.isArray(item.platform)) throw new Error("embedding.profile_invalid");
  const platform = item.platform as Record<string, unknown>;
  if (!exactKeys(platform, ["os", "arch", "node_major"])) throw new Error("embedding.profile_invalid");
  if (!identity(platform.os) || !identity(platform.arch)) throw new Error("embedding.profile_invalid");
  if (!Number.isInteger(platform.node_major) || Number(platform.node_major) < 20) throw new Error("embedding.profile_invalid");
  if (!item.license || typeof item.license !== "object" || Array.isArray(item.license)) throw new Error("embedding.profile_invalid");
  const license = item.license as Record<string, unknown>;
  if (!exactKeys(license, ["spdx", "source"]) || !identity(license.spdx) || !identity(license.source)) {
    throw new Error("embedding.profile_invalid");
  }
  if (typeof item.install_root !== "string" || !path.isAbsolute(item.install_root)) throw new Error("embedding.profile_invalid");
  if (Buffer.byteLength(item.install_root) > 4096) throw new Error("embedding.profile_invalid");
  if (typeof item.validated_at !== "string" || !Number.isFinite(Date.parse(item.validated_at))) {
    throw new Error("embedding.profile_invalid");
  }
}

function assertInstallManifest(value: LocalRuntimeInstallManifest): void {
  if (!value || value.schema_version !== 1) throw new Error("embedding.runtime_install_invalid");
  if (value.status !== "installed_candidate_validated" || value.profile_id !== PROFILE_ID) {
    throw new Error("embedding.runtime_install_invalid");
  }
  if (value.platform !== process.platform || value.arch !== process.arch || value.node !== process.version) {
    throw new Error("embedding.runtime_install_invalid");
  }
  if (!hash(value.runtime_identity) || !hash(value.model_identity)) throw new Error("embedding.runtime_install_invalid");
  if (value.input_policy_id !== "multilingual-e5-query-passage-v1" || value.dimension !== 768) {
    throw new Error("embedding.runtime_install_invalid");
  }
  if (value.runtime_entry !== "node_modules/@huggingface/transformers/src/transformers.js") {
    throw new Error("embedding.runtime_install_invalid");
  }
  if (value.model_path !== "model" || value.package_count !== 50) throw new Error("embedding.runtime_install_invalid");
  if (value.lifecycle_scripts_executed !== false || value.package_manager_executed !== false) {
    throw new Error("embedding.runtime_install_invalid");
  }
  if (!hash(value.acquisition_receipt_sha256)) throw new Error("embedding.runtime_install_invalid");
  if (value.content_manifest !== "content-manifest.json") throw new Error("embedding.runtime_install_invalid");
  if (!hash(value.content_manifest_sha256) || !hash(value.content_tree_sha256)) {
    throw new Error("embedding.runtime_install_invalid");
  }
  if (!Number.isSafeInteger(value.content_file_count) || value.content_file_count < 1) {
    throw new Error("embedding.runtime_install_invalid");
  }
  if (!Number.isSafeInteger(value.content_directory_count) || value.content_directory_count < 1) {
    throw new Error("embedding.runtime_install_invalid");
  }
  if (!Number.isSafeInteger(value.content_bytes) || value.content_bytes < 1) {
    throw new Error("embedding.runtime_install_invalid");
  }
}
function hash(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function identity(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value); }
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function sha256(value: Buffer): string { return createHash("sha256").update(value).digest("hex"); }
