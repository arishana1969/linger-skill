import { createHash } from "node:crypto";
import type { LocalArtifactSpec } from "./local-artifact-download.js";

export interface LocalRuntimePackage {
  name: string;
  version: string;
  source_url: string;
  integrity: string;
  shasum: string;
  unpacked_bytes: number | null;
  license: string;
  lifecycle_scripts: Record<string, string>;
}

export interface LocalRuntimeCandidateManifest {
  schema_version: 1;
  status: "candidate_not_validated";
  platform: "darwin";
  arch: "arm64";
  node: string;
  runtime: "@huggingface/transformers@4.2.0";
  known_unpacked_bytes: number;
  packages_without_unpacked_size: string[];
  packages: LocalRuntimePackage[];
}

export function validateLocalRuntimeCandidateManifest(value: unknown): LocalRuntimeCandidateManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("embedding.runtime_manifest_invalid");
  const item = value as Record<string, unknown>;
  const keys = [
    "schema_version", "status", "platform", "arch", "node", "runtime",
    "known_unpacked_bytes", "packages_without_unpacked_size", "packages"
  ];
  if (!exactKeys(item, keys)) throw new Error("embedding.runtime_manifest_invalid");
  if (item.schema_version !== 1 || item.status !== "candidate_not_validated") {
    throw new Error("embedding.runtime_manifest_invalid");
  }
  if (item.platform !== "darwin" || item.arch !== "arm64") throw new Error("embedding.runtime_manifest_invalid");
  if (item.runtime !== "@huggingface/transformers@4.2.0") throw new Error("embedding.runtime_manifest_invalid");
  if (typeof item.node !== "string" || !/^v24\.\d+\.\d+$/.test(item.node)) {
    throw new Error("embedding.runtime_manifest_invalid");
  }
  if (!Number.isInteger(item.known_unpacked_bytes) || Number(item.known_unpacked_bytes) < 1) {
    throw new Error("embedding.runtime_manifest_invalid");
  }
  if (!Array.isArray(item.packages_without_unpacked_size)) throw new Error("embedding.runtime_manifest_invalid");
  if (!item.packages_without_unpacked_size.every(validPackageIdentity)) throw new Error("embedding.runtime_manifest_invalid");
  if (!Array.isArray(item.packages) || item.packages.length < 1 || item.packages.length > 72) throw new Error("embedding.runtime_manifest_invalid");
  const seen = new Set<string>();
  for (const value of item.packages) {
    assertPackage(value);
    const packageItem = value as LocalRuntimePackage;
    const identity = `${packageItem.name}@${packageItem.version}`;
    if (seen.has(identity)) throw new Error("embedding.runtime_manifest_invalid");
    seen.add(identity);
  }
  if (!seen.has(item.runtime)) throw new Error("embedding.runtime_manifest_invalid");
  return item as unknown as LocalRuntimeCandidateManifest;
}

export function runtimeArtifactSpecs(manifest: LocalRuntimeCandidateManifest): LocalArtifactSpec[] {
  return manifest.packages.map((item, index) => ({
    artifact_id: `npm-${String(index + 1).padStart(3, "0")}`,
    relative_path: `runtime/npm/${safePackageFile(item.name, item.version)}`,
    source_url: item.source_url,
    max_bytes: 128 * 1024 * 1024,
    integrity: { algorithm: "sha512-sri", digest: item.integrity }
  }));
}

export function runtimeCandidateIdentity(manifest: LocalRuntimeCandidateManifest): string {
  return createHash("sha256").update(`${JSON.stringify(manifest, null, 2)}\n`).digest("hex");
}

function assertPackage(value: unknown): asserts value is LocalRuntimePackage {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("embedding.runtime_manifest_invalid");
  const item = value as Record<string, unknown>;
  const keys = ["name", "version", "source_url", "integrity", "shasum", "unpacked_bytes", "license", "lifecycle_scripts"];
  if (!exactKeys(item, keys)) throw new Error("embedding.runtime_manifest_invalid");
  if (!validPackageName(item.name)) throw new Error("embedding.runtime_manifest_invalid");
  if (typeof item.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(item.version)) {
    throw new Error("embedding.runtime_manifest_invalid");
  }
  if (!validRegistryUrl(item.source_url)) throw new Error("embedding.runtime_manifest_invalid");
  if (typeof item.integrity !== "string" || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(item.integrity)) {
    throw new Error("embedding.runtime_manifest_invalid");
  }
  if (typeof item.shasum !== "string" || !/^[a-f0-9]{40}$/.test(item.shasum)) {
    throw new Error("embedding.runtime_manifest_invalid");
  }
  if (item.unpacked_bytes !== null && (!Number.isInteger(item.unpacked_bytes) || Number(item.unpacked_bytes) < 1)) throw new Error("embedding.runtime_manifest_invalid");
  if (typeof item.license !== "string" || item.license.length < 1 || item.license.length > 128) {
    throw new Error("embedding.runtime_manifest_invalid");
  }
  if (!item.lifecycle_scripts || typeof item.lifecycle_scripts !== "object" || Array.isArray(item.lifecycle_scripts)) {
    throw new Error("embedding.runtime_manifest_invalid");
  }
  const invalidScript = Object.entries(item.lifecycle_scripts as Record<string, unknown>)
    .some(([key, script]) => !/^[a-z][a-z0-9:-]*$/.test(key) || typeof script !== "string" || script.length > 2048);
  if (invalidScript) throw new Error("embedding.runtime_manifest_invalid");
}

function validRegistryUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const url = new URL(value);
  return url.protocol === "https:"
    && url.hostname === "registry.npmjs.org"
    && !url.port
    && !url.username
    && !url.password
    && !url.search
    && !url.hash
    && url.pathname.endsWith(".tgz");
}

function validPackageName(value: unknown): value is string { return typeof value === "string" && /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(value); }
function validPackageIdentity(value: unknown): value is string {
  return typeof value === "string"
    && /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}
function safePackageFile(name: string, version: string): string { return `${name.replace("/", "__")}@${version}.tgz`; }
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
