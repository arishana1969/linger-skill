import path from "node:path";

export interface VaultPaths {
  root: string;
  config: string;
  projects: string;
  raw: string;
  processed: string;
  enrichments: string;
  queue: string;
  tmp: string;
  registry: string;
  decisions: string;
  quarantine: string;
  embeddings: string;
  modelCache: string;
}

export function vaultPaths(root: string): VaultPaths {
  const resolved = path.resolve(root);
  return {
    root: resolved,
    config: path.join(resolved, "config.json"),
    projects: path.join(resolved, "projects"),
    raw: path.join(resolved, "raw"),
    processed: path.join(resolved, "processed"),
    enrichments: path.join(resolved, "enrichments"),
    queue: path.join(resolved, "queue"),
    tmp: path.join(resolved, "tmp"),
    registry: path.join(resolved, "registry"),
    decisions: path.join(resolved, "decisions"),
    quarantine: path.join(resolved, "quarantine"),
    embeddings: path.join(resolved, "embeddings"),
    modelCache: path.join(resolved, "model-cache")
  };
}

export function assertSafeId(value: string, label: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

export function assertSafeRelativePosixPath(value: string, errorCode: string): string {
  if (!value || Buffer.byteLength(value) > 1024 || value.includes("\\") || value.includes("\0") || path.posix.isAbsolute(value)) {
    throw new Error(errorCode);
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === "." || normalized.startsWith("../") || value.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error(errorCode);
  }
  return normalized;
}
