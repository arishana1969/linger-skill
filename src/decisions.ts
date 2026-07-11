import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { atomicJson, readJson, withFileLock } from "./io.js";
import { assertSafeId, vaultPaths } from "./paths.js";
import { listJsonFiles } from "./vault.js";

export type DecisionKind = "idea" | "preference" | "proposal" | "rationale" | "constraint" | "rejection" | "decision" | "current_state" | "todo" | "correction";
export type DecisionStatus = "proposed" | "accepted" | "rejected" | "superseded" | "reopened" | "current" | "unknown";
export type DecisionSource = "user_explicit" | "agent_inferred";

export interface DecisionEvent {
  schema_version: 1;
  event_id: string;
  canonical_id: string;
  project_id: string;
  topic: string;
  aliases: string[];
  kind: DecisionKind;
  status: DecisionStatus;
  statement: string;
  rationale?: string;
  source: DecisionSource;
  confidence: number;
  evidence_refs: string[];
  supersedes: string[];
  timestamp: string;
}

export interface DecisionView {
  schema_version: 1;
  canonical_id: string;
  project_id: string;
  topic: string;
  aliases: string[];
  event_ids: string[];
  current_event_id?: string;
  current_evidence_refs?: string[];
  current_state?: string;
  current_status: DecisionStatus;
  confidence: number;
  source_events: string[];
  conflicts: string[];
  updated_at: string;
}

export interface AppendDecisionInput {
  projectId: string;
  topic: string;
  kind: DecisionKind;
  status: DecisionStatus;
  statement: string;
  source: DecisionSource;
  confidence: number;
  evidenceRefs: string[];
  aliases?: string[];
  rationale?: string;
  supersedes?: string[];
  timestamp?: string;
}

export async function appendDecision(root: string, input: AppendDecisionInput): Promise<{ event: DecisionEvent; view: DecisionView }> {
  validateInput(input);
  const project = assertSafeId(input.projectId, "project id");
  const canonicalId = canonicalDecisionId(project, input.topic);
  const p = vaultPaths(root);
  const topicDir = path.join(p.decisions, project, canonicalId);
  return await withFileLock(path.join(p.tmp, `${project}.${canonicalId}.decision.lock`), async () => {
    const timestamp = input.timestamp ?? new Date().toISOString();
    const event: DecisionEvent = {
      schema_version: 1,
      event_id: `de_${randomUUID()}`,
      canonical_id: canonicalId,
      project_id: project,
      topic: input.topic.trim(),
      aliases: normalized(input.aliases ?? []),
      kind: input.kind,
      status: input.status,
      statement: input.statement.trim(),
      rationale: input.rationale?.trim() || undefined,
      source: input.source,
      confidence: input.confidence,
      evidence_refs: [...new Set(input.evidenceRefs)],
      supersedes: [...new Set(input.supersedes ?? [])],
      timestamp
    };
    await atomicJson(path.join(topicDir, "events", `${timestamp.replaceAll(":", "-")}-${event.event_id}.json`), event);
    const view = await rebuildDecisionView(root, project, canonicalId);
    return { event, view };
  });
}

export async function rebuildDecisionView(root: string, projectId: string, canonicalId: string): Promise<DecisionView> {
  const p = vaultPaths(root);
  const topicDir = path.join(p.decisions, assertSafeId(projectId, "project id"), assertSafeId(canonicalId, "decision id"));
  const files = await listJsonFiles(path.join(topicDir, "events"));
  const events = (await Promise.all(files.map(readJson<DecisionEvent>))).sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.event_id.localeCompare(b.event_id));
  if (!events.length) throw new Error(`No decision events for ${canonicalId}`);
  const superseded = new Set(events.flatMap(event => event.supersedes));
  const eligible = events.filter(event => !superseded.has(event.event_id) && canSetCurrent(event));
  const explicit = eligible.filter(event => event.source === "user_explicit");
  const candidates = explicit.length ? explicit : eligible;
  const current = candidates.at(-1);
  const conflicts = findConflicts(candidates);
  const last = events.at(-1)!;
  const view: DecisionView = {
    schema_version: 1,
    canonical_id: canonicalId,
    project_id: projectId,
    topic: events[0]!.topic,
    aliases: normalized(events.flatMap(event => event.aliases)),
    event_ids: events.map(event => event.event_id),
    current_event_id: current?.event_id,
    current_evidence_refs: current?.evidence_refs,
    current_state: current?.statement,
    current_status: current?.status ?? "unknown",
    confidence: current?.confidence ?? 0,
    source_events: [...new Set(events.flatMap(event => event.evidence_refs))],
    conflicts,
    updated_at: last.timestamp
  };
  await atomicJson(path.join(topicDir, "current.json"), view);
  return view;
}

export async function getDecisionTrail(root: string, projectId: string, topic: string): Promise<{ view: DecisionView; events: DecisionEvent[] } | undefined> {
  const project = assertSafeId(projectId, "project id");
  const id = canonicalDecisionId(project, topic);
  const topicDir = path.join(vaultPaths(root).decisions, project, id);
  try {
    const view = await readJson<DecisionView>(path.join(topicDir, "current.json"));
    const events = (await Promise.all((await listJsonFiles(path.join(topicDir, "events"))).map(readJson<DecisionEvent>))).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return { view, events };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function listDecisionViews(root: string, projectId: string): Promise<DecisionView[]> {
  const base = path.join(vaultPaths(root).decisions, assertSafeId(projectId, "project id"));
  const files = (await listJsonFiles(base)).filter(file => path.basename(file) === "current.json");
  return await Promise.all(files.map(readJson<DecisionView>));
}

function canonicalDecisionId(projectId: string, topic: string): string {
  return `d_${createHash("sha256").update(`${projectId}\0${topic.trim().toLowerCase()}`).digest("hex").slice(0, 20)}`;
}

function validateInput(input: AppendDecisionInput): void {
  if (!input.topic.trim() || !input.statement.trim()) throw new Error("Decision topic and statement are required");
  if (!input.evidenceRefs.length) throw new Error("Decision events require evidence");
  if (input.confidence < 0 || input.confidence > 1) throw new Error("Confidence must be between 0 and 1");
}

function canSetCurrent(event: DecisionEvent): boolean {
  if (event.source === "agent_inferred" && event.confidence < 0.75) return false;
  return ["accepted", "rejected", "reopened", "current"].includes(event.status) && ["decision", "current_state", "correction", "rejection"].includes(event.kind);
}

function normalized(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))].sort();
}

function findConflicts(events: DecisionEvent[]): string[] {
  const current = events.filter(event => event.status === "current" || event.status === "accepted");
  if (new Set(current.map(event => event.statement.trim().toLowerCase())).size <= 1) return [];
  return current.map(event => event.event_id);
}
