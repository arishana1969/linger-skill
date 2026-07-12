import path from "node:path";
import { createHash } from "node:crypto";
import { decisionFromEvent } from "./decision-extraction.js";
import { appendDecision, getDecisionTrail } from "./decisions.js";
import { atomicJson, readJson, withFileLock } from "./io.js";
import { writeProcessedMarkdown } from "./processed-markdown.js";
import { DEFAULT_MIN_CONTENT_CHARACTERS } from "./processing-policy.js";
import { vaultPaths } from "./paths.js";
import { rebuildTagRegistry } from "./tag-registry.js";
import { listJsonFiles } from "./vault.js";
import type { ProcessedMemory, QueueItem, RawEvent } from "./types.js";

const STOP = new Set(["the", "and", "for", "that", "this", "with", "have", "from", "我们", "这个", "一下", "可以", "就是"]);

export async function processQueue(root: string, projectId?: string, maxItems = Number.POSITIVE_INFINITY): Promise<{ processed: number; failed: number }> {
  const p = vaultPaths(root);
  return await withFileLock(path.join(p.tmp, "processor.lock"), async () => {
    const queueFiles = (await listJsonFiles(p.queue)).filter((file) => !projectId || file.includes(`${path.sep}${projectId}${path.sep}`));
    const items: Array<{ file: string; item: QueueItem }> = [];
    for (const file of queueFiles) {
      try { items.push({ file, item: await readJson<QueueItem>(file) }); } catch { continue; }
    }
    items.sort((a, b) => Number(b.item.priority === "explicit") - Number(a.item.priority === "explicit") || a.item.created_at.localeCompare(b.item.created_at));
    let processed = 0;
    let failed = 0;
    const touchedProjects = new Set<string>();
    for (const entry of items.filter(({ item }) => item.status === "pending" || item.status === "failed").slice(0, maxItems)) {
      const running = { ...entry.item, status: "processing" as const, attempts: entry.item.attempts + 1, updated_at: new Date().toISOString() };
      await atomicJson(entry.file, running);
      try {
        const rawFiles = await listJsonFiles(path.join(p.raw, running.project_id));
        let event: RawEvent | undefined;
        for (const file of rawFiles) {
          const candidate = await readJson<RawEvent>(file);
          if (candidate.event_id === running.event_id) { event = candidate; break; }
        }
        if (!event) throw new Error(`Missing raw event ${running.event_id}`);
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
        await atomicJson(path.join(p.processed, event.project_id, `${memory.id}.json`), memory);
        await writeProcessedMarkdown(root, memory);
        if (memory.type === "decision") {
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
  const durableSignal = /(?:决定|采用|选择|偏好|约束|不做|拒绝|提案|暂缓|当前|记住|decision|decided|choose|preference|constraint|proposal|current)/i.test(clean);
  if (event.role === "assistant" && !explicit && clean.length < DEFAULT_MIN_CONTENT_CHARACTERS && !durableSignal) return undefined;
  const tags = keywords(clean);
  const id = `mem_${createHash("sha256").update(event.event_id).digest("hex").slice(0, 24)}`;
  const isCorrection = /(?:不是这个意思|这条不对|纠正|correct)/i.test(clean);
  const isDecision = /(?:决定|采用|选择|不做|拒绝|提案|暂缓|当前|decision|decided|choose|proposal|current)/i.test(clean);
  return {
    schema_version: 1,
    id,
    type: isCorrection ? "correction" : isDecision ? "decision" : "conversation",
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
    agent: "continuity-deterministic-processor"
  };
}

function keywords(text: string): string[] {
  const latin = text.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? [];
  const cjk = text.match(/[\p{Script=Han}]{2,8}/gu) ?? [];
  return [...new Set([...latin, ...cjk].filter(token => !STOP.has(token)))].slice(0, 12);
}
