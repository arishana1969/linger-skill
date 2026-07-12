import { stat } from "node:fs/promises";
import path from "node:path";
import { atomicJson, readJson } from "./io.js";
import { vaultPaths } from "./paths.js";
import type { QueueItem } from "./types.js";
import { listJsonFiles } from "./vault.js";

export interface ProcessingPolicy {
  threshold_bytes: number;
  max_wait_ms: number;
  max_runs_per_hour: number;
  max_items_per_run: number;
  max_estimated_tokens_per_run: number;
  min_content_characters: number;
}

export interface ProcessingDecision {
  should_run: boolean;
  reason: "explicit" | "startup" | "size_threshold" | "max_wait" | "manual" | "no_pending" | "below_threshold" | "rate_limited";
  pending_items: number;
  pending_bytes: number;
  limit: number;
  max_estimated_tokens: number;
}

export const DEFAULT_MIN_CONTENT_CHARACTERS = 20;
const DEFAULT_POLICY: ProcessingPolicy = { threshold_bytes: 50 * 1024, max_wait_ms: 30 * 60 * 1000, max_runs_per_hour: 4, max_items_per_run: 100, max_estimated_tokens_per_run: 16_000, min_content_characters: DEFAULT_MIN_CONTENT_CHARACTERS };

export async function processingDecision(root: string, projectId: string, trigger: "automatic" | "manual" | "startup", now = new Date(), policy: Partial<ProcessingPolicy> = {}): Promise<ProcessingDecision> {
  const config = { ...DEFAULT_POLICY, ...policy };
  const p = vaultPaths(root);
  const items: QueueItem[] = [];
  let bytes = 0;
  for (const file of await listJsonFiles(path.join(p.queue, projectId))) {
    try {
      const item = await readJson<QueueItem>(file);
      if (item.status !== "pending" && item.status !== "failed") continue;
      items.push(item);
      for (const rawFile of await listJsonFiles(path.join(p.raw, projectId))) {
        try { if ((await readJson<{ event_id: string }>(rawFile)).event_id === item.event_id) bytes += (await stat(rawFile)).size; } catch { /* doctor reports */ }
      }
    } catch { /* doctor reports */ }
  }
  const base = { pending_items: items.length, pending_bytes: bytes, limit: config.max_items_per_run, max_estimated_tokens: config.max_estimated_tokens_per_run };
  if (!items.length) return { should_run: false, reason: "no_pending", ...base };
  if (trigger === "manual") return { should_run: true, reason: "manual", ...base };
  const historyFile = path.join(p.registry, "processing-runs", `${projectId}.json`);
  const history = await readHistory(historyFile);
  const cutoff = now.getTime() - 60 * 60 * 1000;
  if (history.filter(value => Date.parse(value) >= cutoff).length >= config.max_runs_per_hour) return { should_run: false, reason: "rate_limited", ...base };
  if (trigger === "startup") return { should_run: true, reason: "startup", ...base };
  if (items.some(item => item.priority === "explicit")) return { should_run: true, reason: "explicit", ...base };
  if (bytes >= config.threshold_bytes) return { should_run: true, reason: "size_threshold", ...base };
  const oldest = Math.min(...items.map(item => Date.parse(item.created_at)));
  if (now.getTime() - oldest >= config.max_wait_ms) return { should_run: true, reason: "max_wait", ...base };
  return { should_run: false, reason: "below_threshold", ...base };
}

export async function recordProcessingRun(root: string, projectId: string, timestamp = new Date()): Promise<void> {
  const file = path.join(vaultPaths(root).registry, "processing-runs", `${projectId}.json`);
  const history = await readHistory(file);
  const cutoff = timestamp.getTime() - 24 * 60 * 60 * 1000;
  await atomicJson(file, { runs: [...history.filter(value => Date.parse(value) >= cutoff), timestamp.toISOString()] });
}

async function readHistory(file: string): Promise<string[]> { try { return (await readJson<{ runs: string[] }>(file)).runs ?? []; } catch { return []; } }
