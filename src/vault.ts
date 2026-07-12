import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { atomicJson, ensureDir, readJson } from "./io.js";
import { vaultPaths } from "./paths.js";
import { assertProjectRecord, assertQueueItem, assertVaultConfig } from "./schema-validation.js";
import { assertProjectRecordPath, assertQueueRecordPath } from "./record-paths.js";

export interface VaultConfig {
  schema_version: 1;
  paused: boolean;
  project_only_recall: boolean;
  sensitive_exclusion: boolean;
  max_snippets: number;
  max_characters: number;
  max_files: number;
  max_raw_fragment_characters: number;
  search_timeout_ms: number;
  created_at: string;
}

export interface ProjectRecord {
  schema_version: 1;
  project_id: string;
  display_name: string;
  root_path: string;
  identity_source: "git_remote_root" | "git_root" | "absolute_path";
  created_at: string;
  last_seen: string;
}

function defaultConfig(createdAt = new Date().toISOString()): VaultConfig {
  return {
    schema_version: 1,
    paused: false,
    project_only_recall: true,
    sensitive_exclusion: true,
    max_snippets: 8,
    max_characters: 12000,
    max_files: 5000,
    max_raw_fragment_characters: 500,
    search_timeout_ms: 2000,
    created_at: createdAt
  };
}

export async function initVault(root: string): Promise<VaultConfig> {
  const p = vaultPaths(root);
  await Promise.all([
    p.projects, p.raw, p.processed, p.queue, p.tmp, p.registry, p.decisions, p.quarantine
  ].map(ensureDir));
  try {
    const existing = await readJson<Partial<VaultConfig> & Record<string, unknown>>(p.config);
    if (existing.schema_version !== 1) throw new Error(`Unsupported vault config schema: ${String(existing.schema_version)}`);
    const next = { ...defaultConfig(typeof existing.created_at === "string" ? existing.created_at : undefined), ...existing } as VaultConfig;
    assertVaultConfig(next);
    if (JSON.stringify(existing) !== JSON.stringify(next)) await atomicJson(p.config, next);
    return next;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const config = defaultConfig();
  await atomicJson(p.config, config);
  return config;
}

export async function setPaused(root: string, paused: boolean): Promise<VaultConfig> {
  const p = vaultPaths(root);
  const config = await initVault(root);
  const next = { ...config, paused };
  await atomicJson(p.config, next);
  return next;
}

export async function projectId(cwd: string): Promise<string> {
  return (await projectIdentity(cwd)).project_id;
}

export async function registerProject(root: string, cwd: string): Promise<ProjectRecord> {
  const identity = await projectIdentity(cwd);
  const p = vaultPaths(root);
  const file = path.join(p.projects, `${identity.project_id}.json`);
  const now = new Date().toISOString();
  let createdAt = now;
  try { const existing = await readJson<unknown>(file); assertProjectRecord(existing); assertProjectRecordPath(p, file, existing); createdAt = existing.created_at; } catch { }
  const record: ProjectRecord = { schema_version: 1, ...identity, created_at: createdAt, last_seen: now };
  await atomicJson(file, record);
  return record;
}

export async function listProjects(root: string): Promise<ProjectRecord[]> {
  const p = vaultPaths(root);
  return (await Promise.all((await listJsonFiles(p.projects)).map(async file => {
    try { const value = await readJson<unknown>(file); assertProjectRecord(value); assertProjectRecordPath(p, file, value); return value; } catch { return undefined; }
  }))).filter((record): record is ProjectRecord => Boolean(record)).sort((a, b) => b.last_seen.localeCompare(a.last_seen) || a.project_id.localeCompare(b.project_id));
}

async function projectIdentity(cwd: string): Promise<Pick<ProjectRecord, "project_id" | "display_name" | "root_path" | "identity_source">> {
  const requested = path.resolve(cwd);
  const resolved = await realpath(requested).catch(() => requested);
  const remote = await gitValue(resolved, ["config", "--get", "remote.origin.url"]);
  const gitRoot = await gitValue(resolved, ["rev-parse", "--show-toplevel"]);
  const rootPath = gitRoot ?? resolved;
  const material = remote && gitRoot ? `${remote}\0${gitRoot}` : rootPath;
  return {
    project_id: `p_${createHash("sha256").update(material).digest("hex").slice(0, 16)}`,
    display_name: path.basename(rootPath) || rootPath,
    root_path: rootPath,
    identity_source: remote && gitRoot ? "git_remote_root" : gitRoot ? "git_root" : "absolute_path"
  };
}

async function gitValue(cwd: string, args: string[]): Promise<string | undefined> {
  const { execFile } = await import("node:child_process");
  return await new Promise((resolve) => {
    execFile("git", args, { cwd }, (error, stdout) => resolve(error ? undefined : stdout.trim() || undefined));
  });
}

export async function listJsonFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) files.push(...await listJsonFiles(target));
      else if (entry.isFile() && entry.name.endsWith(".json")) files.push(target);
    }
    return files.sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function vaultStats(root: string): Promise<Record<string, number | boolean>> {
  const p = vaultPaths(root);
  const config = await initVault(root);
  const [raw, processed, queue, pendingCaptures] = await Promise.all([
    listJsonFiles(p.raw), listJsonFiles(p.processed), listJsonFiles(p.queue), listJsonFiles(path.join(p.tmp, "pending"))
  ]);
  const queueCounts = { pending: 0, processing: 0, failed: 0, done: 0, invalid: 0 };
  for (const file of queue) {
    try { const item = await readJson<unknown>(file); assertQueueItem(item); assertQueueRecordPath(p, file, item); queueCounts[item.status] += 1; } catch { queueCounts.invalid += 1; }
  }
  let bytes = 0;
  for (const file of [...raw, ...processed]) bytes += (await stat(file)).size;
  return { paused: config.paused, raw_events: raw.length, processed_memories: processed.length, queue_items: queue.length, queue_pending: queueCounts.pending, queue_processing: queueCounts.processing, queue_failed: queueCounts.failed, queue_done: queueCounts.done, queue_invalid: queueCounts.invalid, pending_captures: pendingCaptures.length, bytes };
}
