import path from "node:path";
import { createHash } from "node:crypto";
import { decisionFromEvent, decisionKindFromContent } from "./decision-extraction.js";
import { appendDecision, getDecisionTrail } from "./decisions.js";
import { assertWritableInside, atomicJson, readJson, withFileLock } from "./io.js";
import { writeProcessedMarkdown } from "./processed-markdown.js";
import { DEFAULT_MIN_CONTENT_CHARACTERS } from "./processing-policy.js";
import { assertSafeId, vaultPaths } from "./paths.js";
import { assertQueueItem, assertRawEvent } from "./schema-validation.js";
import { assertQueueRecordPath, assertRawRecordPath } from "./record-paths.js";
import { rebuildTagRegistry } from "./tag-registry.js";
import { listJsonFiles } from "./vault.js";
import type { ProcessedMemory, QueueItem, RawEvent } from "./types.js";

const STOP = new Set(["the", "and", "for", "that", "this", "with", "have", "from", "我们", "这个", "一下", "可以", "就是"]);

export async function processQueue(root: string, projectId?: string, maxItems = Number.POSITIVE_INFINITY, maxEstimatedTokens = Number.POSITIVE_INFINITY): Promise<{ processed: number; failed: number }> {
  if (!(maxEstimatedTokens > 0)) throw new Error("maxEstimatedTokens must be greater than zero");
  if (projectId) assertSafeId(projectId, "project id");
  const p = vaultPaths(root);
  return await withFileLock(path.join(p.tmp, "processor.lock"), async () => {
    const queueFiles = (await listJsonFiles(p.queue)).filter((file) => !projectId || file.includes(`${path.sep}${projectId}${path.sep}`));
    const items: Array<{ file: string; item: QueueItem }> = [];
    for (const file of queueFiles) {
      try { const item = await readJson<unknown>(file); assertQueueItem(item); assertQueueRecordPath(p, file, item); items.push({ file, item }); } catch { continue; }
    }
    items.sort((a, b) => Number(b.item.priority === "explicit") - Number(a.item.priority === "explicit") || a.item.created_at.localeCompare(b.item.created_at));
    let processed = 0;
    let failed = 0;
    let estimatedTokens = 0;
    const touchedProjects = new Set<string>();
    const rawEventsByProject = new Map<string, Map<string, RawEvent>>();
    for (const entry of items.filter(({ item }) => item.status === "pending" || item.status === "failed").slice(0, maxItems)) {
      const running = { ...entry.item, status: "processing" as const, attempts: entry.item.attempts + 1, updated_at: new Date().toISOString() };
      try {
        let rawEvents = rawEventsByProject.get(running.project_id);
        if (!rawEvents) {
          rawEvents = new Map<string, RawEvent>();
          for (const file of await listJsonFiles(path.join(p.raw, running.project_id))) {
            try {
              const candidate = await readJson<unknown>(file);
              assertRawEvent(candidate);
              assertRawRecordPath(p, file, candidate);
              rawEvents.set(candidate.event_id, candidate);
            } catch { continue; }
          }
          rawEventsByProject.set(running.project_id, rawEvents);
        }
        const event = rawEvents.get(running.event_id);
        if (!event) throw new Error(`Missing raw event ${running.event_id}`);
        const itemTokens = Math.max(1, Math.ceil(event.content.length / 4));
        if (processed + failed > 0 && estimatedTokens + itemTokens > maxEstimatedTokens) break;
        await atomicJson(entry.file, running);
        estimatedTokens += itemTokens;
        if (event.sensitivity === "secret") {
          await atomicJson(entry.file, { ...running, status: "done", updated_at: new Date().toISOString() });
          processed += 1;
          continue;
        }
        const memory = memoryFromEvent(event, running.priority === "explicit");
        if (!memory) {
          await atomicJson(entry.file, { ...running, status: "done", updated_at: new Date().toISOString() });
          processed += 1;
          continue;
        }
        const memoryFile = path.join(p.processed, event.project_id, `${memory.id}.json`);
        await assertWritableInside(p.root, memoryFile);
        await atomicJson(memoryFile, memory);
        await writeProcessedMarkdown(root, memory);
        if (memory.type !== "conversation") {
          const decision = decisionFromEvent(event, memory.source === "user_explicit");
          if (/(?:当前|现在|目前|current|currently|now)/i.test(event.content)) {
            const trail = await getDecisionTrail(root, event.project_id, decision.topic);
            if (trail?.view.current_event_id) decision.supersedes = [trail.view.current_event_id];
          }
          await appendDecision(root, decision).catch(() => undefined);
        }
        touchedProjects.add(event.project_id);
        await atomicJson(entry.file, { ...running, status: "done", updated_at: new Date().toISOString() });
        processed += 1;
      } catch (error) {
        await atomicJson(entry.file, { ...running, status: "failed", error: (error as Error).message, updated_at: new Date().toISOString() });
        failed += 1;
      }
    }
    for (const project of touchedProjects) await rebuildTagRegistry(root, project).catch(() => undefined);
    return { processed, failed };
  });
}

function memoryFromEvent(event: RawEvent, explicit: boolean): ProcessedMemory | undefined {
  const clean = event.content.replace(/\s+/g, " ").trim();
  const decisionKind = decisionKindFromContent(clean);
  const durableSignal = Boolean(decisionKind) || /(?:记住|remember)/i.test(clean);
  if (event.role === "assistant" && !explicit && clean.length < DEFAULT_MIN_CONTENT_CHARACTERS && !durableSignal) return undefined;
  const tags = keywords(clean);
  const id = `mem_${createHash("sha256").update(event.event_id).digest("hex").slice(0, 24)}`;
  return {
    schema_version: 1,
    id,
    type: decisionKind ?? "conversation",
    scope: "project",
    project_id: event.project_id,
    title: clean.slice(0, 80),
    summary: clean.slice(0, 1000),
    tags,
    predictive_tags: tags,
    retrieval_phrases: tags.map(tag => `关于 ${tag} 的讨论`),
    source_events: [event.event_id],
    source_hash: event.content_hash,
    source_savepoint_status: event.savepoint_status,
    confidence: explicit ? 1 : 0.65,
    source: explicit ? "user_explicit" : "agent_inferred",
    status: "active",
    sensitivity: event.sensitivity === "sensitive" ? "sensitive" : "normal",
    supersedes: [],
    superseded_by: [],
    created_at: event.timestamp,
    updated_at: event.timestamp,
    agent: "linger-deterministic-processor"
  };
}

function keywords(text: string): string[] {
  const latin = text.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? [];
  const cjk = text.match(/[\p{Script=Han}]{2,8}/gu) ?? [];
  return [...new Set([...latin, ...cjk].filter(token => !STOP.has(token)))].slice(0, 12);
}
