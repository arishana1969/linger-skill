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
    quarantine: path.join(resolved, "quarantine")
  };
}

export function assertSafeId(value: string, label: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}
