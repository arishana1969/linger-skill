import type { AppendDecisionInput, DecisionKind } from "./decisions.js";
import type { RawEvent } from "./types.js";

export function decisionFromEvent(event: RawEvent, explicitMemory = false): AppendDecisionInput {
  const content = event.content.replace(/\s+/g, " ").trim();
  const kind = decisionKindFromContent(content) ?? "decision";
  const current = /(?:当前|现在|目前|决定|选择|采用|current|currently|decided|choose|chosen|adopt)/i.test(content);
  return {
    projectId: event.project_id,
    topic: topic(content),
    kind,
    status: kind === "rejection" ? "rejected" : ["decision", "current_state", "correction"].includes(kind) && current ? "current" : "proposed",
    statement: content,
    source: event.role === "user" ? "user_explicit" : "agent_inferred",
    confidence: event.role === "user" ? (explicitMemory ? 1 : 0.95) : 0.7,
    evidenceRefs: [event.event_id],
    aliases: aliases(content),
    timestamp: event.timestamp
  };
}

export function decisionKindFromContent(content: string): DecisionKind | undefined {
  if (/(?:不是这个意思|这条不对|纠正|correct(?:ion)?)/i.test(content)) return "correction";
  if (/(?:拒绝|不做|暂缓|否决|defer|reject)/i.test(content)) return "rejection";
  if (/(?:提案|建议|proposal|propose|suggest)/i.test(content)) return "proposal";
  if (/(?:想法|灵感|idea)/i.test(content)) return "idea";
  if (/(?:偏好|更喜欢|preference|prefer)/i.test(content)) return "preference";
  if (/(?:待办|要做|todo|to-do)/i.test(content)) return "todo";
  if (/(?:决定|选择|采用|decision|decided|choose|chosen|adopt)/i.test(content)) return "decision";
  if (/(?:当前|现在|目前|current|currently)/i.test(content)) return "current_state";
  if (/(?:约束|限制|必须|不能|constraint|must|cannot|can't)/i.test(content)) return "constraint";
  if (/(?:理由|原因|因为|由于|rationale|reason|because)/i.test(content)) return "rationale";
  return undefined;
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
