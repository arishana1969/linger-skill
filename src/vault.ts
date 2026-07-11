import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { atomicJson, ensureDir, readJson } from "./io.js";
import { vaultPaths } from "./paths.js";
import type { QueueItem } from "./types.js";

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

export async function initVault(root: string): Promise<VaultConfig> {
  const p = vaultPaths(root);
  await Promise.all([
    p.projects, p.raw, p.processed, p.queue, p.tmp, p.registry, p.decisions, p.quarantine
  ].map(ensureDir));
  try {
    return await readJson<VaultConfig>(p.config);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const config: VaultConfig = {
    schema_version: 1,
    paused: false,
    project_only_recall: true,
    sensitive_exclusion: true,
    max_snippets: 8,
    max_characters: 12000,
    max_files: 5000,
    max_raw_fragment_characters: 500,
    search_timeout_ms: 2000,
    created_at: new Date().toISOString()
  };
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
  const resolved = path.resolve(cwd);
  const remote = await gitValue(resolved, ["config", "--get", "remote.origin.url"]);
  const gitRoot = await gitValue(resolved, ["rev-parse", "--show-toplevel"]);
  const material = remote && gitRoot ? `${remote}\0${gitRoot}` : resolved;
  return `p_${createHash("sha256").update(material).digest("hex").slice(0, 16)}`;
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
    try { queueCounts[(await readJson<QueueItem>(file)).status] += 1; } catch { queueCounts.invalid += 1; }
  }
  let bytes = 0;
  for (const file of [...raw, ...processed]) bytes += (await stat(file)).size;
  return { paused: config.paused, raw_events: raw.length, processed_memories: processed.length, queue_items: queue.length, queue_pending: queueCounts.pending, queue_processing: queueCounts.processing, queue_failed: queueCounts.failed, queue_done: queueCounts.done, queue_invalid: queueCounts.invalid, pending_captures: pendingCaptures.length, bytes };
}
