import type { AppendDecisionInput } from "./decisions.js";
import type { RawEvent } from "./types.js";

export function decisionFromEvent(event: RawEvent, explicitMemory = false): AppendDecisionInput {
  const content = event.content.replace(/\s+/g, " ").trim();
  const correction = /(?:不是这个意思|这条不对|纠正|correct(?:ion)?)/i.test(content);
  const rejection = /(?:拒绝|不做|暂缓|defer|reject)/i.test(content);
  const current = /(?:当前|决定|选择|采用|current|decided|choose)/i.test(content);
  return {
    projectId: event.project_id,
    topic: topic(content),
    kind: correction ? "correction" : rejection ? "rejection" : "decision",
    status: rejection ? "rejected" : current ? "current" : "proposed",
    statement: content,
    source: event.role === "user" ? "user_explicit" : "agent_inferred",
    confidence: event.role === "user" ? (explicitMemory ? 1 : 0.95) : 0.7,
    evidenceRefs: [event.event_id],
    aliases: aliases(content),
    timestamp: event.timestamp
  };
}

function topic(content: string): string {
  if (/(?:缓存|cache)/i.test(content) && /(?:数据库|sqlite|postgres|database|redis)/i.test(content)) return "database-cache";
  if (/(?:数据库|sqlite|postgres|database)/i.test(content)) return "database";
  if (/(?:存储|storage|vault|file-native)/i.test(content)) return "storage";
  if (/(?:adapter|hook|适配器)/i.test(content)) return "adapter";
  const latin = content.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/)?.[0];
  return latin ?? content.slice(0, 32);
}

function aliases(content: string): string[] {
  const values: string[] = [];
  if (/(?:数据库|database)/i.test(content)) values.push("数据库", "db");
  if (/postgres/i.test(content)) values.push("postgres", "postgresql", "pg");
  if (/sqlite/i.test(content)) values.push("sqlite");
  return [...new Set(values)];
}
