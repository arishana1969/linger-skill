import { getDecisionTrail, isStateSettingDecision, listDecisionViews, type DecisionEvent, type DecisionView } from "./decisions.js";
import { assessEvidence, resolveEvidenceDescriptors, type EvidenceAssessment, type EvidenceDescriptor } from "./effective-search-document.js";
import { healthReport, type HealthDomain } from "./lifecycle-evidence.js";
import { assertSafeId } from "./paths.js";
import { resolveSettings } from "./settings.js";

const DAY_MS = 86_400_000;

export type WhyClassification = "exact_trail" | "ambiguous_topic" | "incomplete_trail" | "conflicting_trail" | "no_reliable_trail" | "retrieval_failure";

export interface DecisionStaleness {
  schema_version: 1;
  project_id: string;
  canonical_topic_id?: string;
  current_event_id?: string;
  current_event_at?: string;
  current_event_age_days?: number;
  last_topic_activity_at?: string;
  last_state_setting_event_at?: string;
  threshold_days: number;
  threshold_source: string;
  warning_enabled: boolean;
  possibly_stale: boolean | null;
  staleness_status: "fresh" | "possibly_stale" | "unknown" | "not_applicable";
  capture_health: HealthDomain;
  observation_complete: boolean;
  warning_flags: string[];
  evaluated_at: string;
}

export interface WhyTimelineNode {
  event_id: string;
  timestamp: string;
  kind: DecisionEvent["kind"];
  status: DecisionEvent["status"];
  statement: string;
  rationale?: string;
  source: DecisionEvent["source"];
  confidence: number;
  evidence_refs: string[];
  supersedes: string[];
  current: boolean;
  warning_flags: string[];
}

export interface WhyResult {
  schema_version: 1;
  project_id: string;
  query: string;
  classification: WhyClassification;
  candidates: Array<{ canonical_id: string; topic: string; score: number }>;
  topic?: string;
  canonical_topic_id?: string;
  current_event_id?: string;
  current_state?: string;
  current_rationale?: string;
  conflicts?: string[];
  timeline?: WhyTimelineNode[];
  provenance?: EvidenceDescriptor[];
  staleness?: DecisionStaleness;
  warning_flags: string[];
}

export async function why(
  root: string,
  input: { projectId: string; topic: string; now?: Date; home?: string }
): Promise<WhyResult> {
  const projectId = assertSafeId(input.projectId, "project id");
  const query = input.topic.trim();
  if (!query) throw new Error("Why topic is required");
  const views = await listDecisionViews(root, projectId);
  const ranked = rankTopics(query, views);
  const selected = selectTopic(ranked);
  if (!selected) {
    return {
      schema_version: 1,
      project_id: projectId,
      query,
      classification: ranked.length ? "ambiguous_topic" : "no_reliable_trail",
      candidates: ranked.slice(0, 8).map(({ view, score }) => ({ canonical_id: view.canonical_id, topic: view.topic, score })),
      warning_flags: ranked.length ? ["topic_ambiguous"] : ["topic_absent"]
    };
  }

  const trail = await getDecisionTrail(root, projectId, selected.view.topic);
  if (!trail) return failure(projectId, query, "decision_trail_missing");
  const evidenceIds = [...new Set(trail.events.flatMap(event => event.evidence_refs))];
  const descriptors = await resolveEvidenceDescriptors(root, projectId, evidenceIds);
  const current = trail.events.find(event => event.event_id === trail.view.current_event_id);
  const currentAssessment = current ? assessEvidence(current.evidence_refs, descriptors) : undefined;
  const timeline = trail.events.map(event => timelineNode(event, trail.view, assessEvidence(event.evidence_refs, descriptors)));
  const staleness = await decisionStaleness(root, projectId, trail.view, trail.events, current, currentAssessment, input.now ?? new Date(), input.home);
  const warningFlags = new Set<string>(staleness.warning_flags);
  if (trail.view.conflicts.length) warningFlags.add("conflicting_current");
  for (const reason of currentAssessment?.reasons ?? []) warningFlags.add(reason);
  const reliable = Boolean(current && currentAssessment && !currentAssessment.reasons.length);
  const hidden = currentAssessment?.sensitivity !== "normal";
  const classification: WhyClassification = !current ? "no_reliable_trail"
    : !reliable ? "incomplete_trail"
      : trail.view.conflicts.length ? "conflicting_trail"
        : "exact_trail";
  return {
    schema_version: 1,
    project_id: projectId,
    query,
    classification,
    candidates: [{ canonical_id: selected.view.canonical_id, topic: selected.view.topic, score: selected.score }],
    topic: trail.view.topic,
    canonical_topic_id: trail.view.canonical_id,
    ...(current ? {
      current_event_id: current.event_id,
      current_state: hidden ? "[sensitive evidence hidden]" : current.statement,
      ...(current.rationale ? { current_rationale: hidden ? "[sensitive evidence hidden]" : current.rationale } : {})
    } : {}),
    conflicts: [...trail.view.conflicts],
    timeline,
    provenance: descriptors,
    staleness,
    warning_flags: [...warningFlags].sort()
  };
}

async function decisionStaleness(
  root: string,
  projectId: string,
  view: DecisionView,
  events: DecisionEvent[],
  current: DecisionEvent | undefined,
  assessment: EvidenceAssessment | undefined,
  now: Date,
  home?: string
): Promise<DecisionStaleness> {
  const evaluatedMs = now.getTime();
  if (!Number.isFinite(evaluatedMs)) throw new Error("Invalid evaluation time");
  const settings = await resolveSettings(root, { projectId });
  const threshold = settings.values["staleness.threshold_days"];
  const warning = settings.values["staleness.warning_enabled"];
  const thresholdDays = threshold.value as number;
  const health = await healthReport(root, { projectId, home, now });
  const captureHealth = health.capture_health;
  const warnings = new Set<string>();
  const observationComplete = captureHealth.state === "healthy";
  if (!observationComplete) warnings.add("capture_may_have_missed_updates");
  if (view.conflicts.length) warnings.add("conflicting_current");

  const activity = latestTimestamp(events);
  const stateSetting = latestTimestamp(events.filter(isStateSettingDecision));
  if (activity !== undefined && activity > evaluatedMs) warnings.add("future_topic_activity");
  const base = {
    schema_version: 1 as const,
    project_id: projectId,
    canonical_topic_id: view.canonical_id,
    ...(activity !== undefined ? { last_topic_activity_at: new Date(activity).toISOString() } : {}),
    ...(stateSetting !== undefined ? { last_state_setting_event_at: new Date(stateSetting).toISOString() } : {}),
    threshold_days: thresholdDays,
    threshold_source: threshold.source,
    warning_enabled: warning.value as boolean,
    capture_health: captureHealth,
    observation_complete: observationComplete,
    evaluated_at: new Date(evaluatedMs).toISOString()
  };
  if (!current || !assessment) {
    return { ...base, possibly_stale: null, staleness_status: "not_applicable", warning_flags: [...warnings].sort() };
  }
  const currentMs = Date.parse(current.timestamp);
  for (const reason of assessment.reasons) warnings.add(reason);
  for (const flag of assessment.warning_flags) warnings.add(flag);
  if (currentMs > evaluatedMs) warnings.add("future_timestamp");
  if (!Number.isFinite(currentMs) || currentMs > evaluatedMs || assessment.reasons.length) {
    return {
      ...base,
      current_event_id: current.event_id,
      current_event_at: new Date(currentMs).toISOString(),
      possibly_stale: null,
      staleness_status: "unknown",
      warning_flags: [...warnings].sort()
    };
  }
  const elapsed = evaluatedMs - currentMs;
  const possiblyStale = elapsed >= thresholdDays * DAY_MS;
  if (possiblyStale && warning.value === true) warnings.add("decision_possibly_stale");
  return {
    ...base,
    current_event_id: current.event_id,
    current_event_at: new Date(currentMs).toISOString(),
    current_event_age_days: Math.floor(elapsed / DAY_MS),
    possibly_stale: possiblyStale,
    staleness_status: possiblyStale ? "possibly_stale" : "fresh",
    warning_flags: [...warnings].sort()
  };
}

function timelineNode(event: DecisionEvent, view: DecisionView, assessment: EvidenceAssessment): WhyTimelineNode {
  const hidden = assessment.sensitivity !== "normal";
  return {
    event_id: event.event_id,
    timestamp: event.timestamp,
    kind: event.kind,
    status: event.status,
    statement: hidden ? "[sensitive evidence hidden]" : event.statement,
    ...(event.rationale ? { rationale: hidden ? "[sensitive evidence hidden]" : event.rationale } : {}),
    source: event.source,
    confidence: event.confidence,
    evidence_refs: [...event.evidence_refs],
    supersedes: [...event.supersedes],
    current: event.event_id === view.current_event_id,
    warning_flags: [...new Set([...assessment.reasons, ...assessment.warning_flags, "untrusted_evidence_text"])].sort()
  };
}

function rankTopics(query: string, views: DecisionView[]): Array<{ view: DecisionView; score: number }> {
  const normalizedQuery = normalizeTopic(query);
  return views.map(view => {
    const names = [view.topic, ...view.aliases].map(normalizeTopic);
    const exact = names.includes(normalizedQuery);
    const prefix = names.some(name => name.startsWith(normalizedQuery) || normalizedQuery.startsWith(name));
    const contains = names.some(name => name.includes(normalizedQuery) || normalizedQuery.includes(name));
    const queryTokens = new Set(normalizedQuery.split(" ").filter(Boolean));
    const overlap = Math.max(0, ...names.map(name => name.split(" ").filter(token => queryTokens.has(token)).length));
    return { view, score: exact ? 100 : prefix ? 60 + overlap : contains ? 40 + overlap : overlap * 10 };
  }).filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || left.view.topic.localeCompare(right.view.topic) || left.view.canonical_id.localeCompare(right.view.canonical_id));
}

function selectTopic(ranked: Array<{ view: DecisionView; score: number }>): { view: DecisionView; score: number } | undefined {
  const first = ranked[0];
  if (!first || first.score < 60 || ranked[1]?.score === first.score) return undefined;
  return first;
}

function normalizeTopic(value: string): string {
  return value.normalize("NFC").trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

function latestTimestamp(events: DecisionEvent[]): number | undefined {
  const values = events.map(event => Date.parse(event.timestamp)).filter(Number.isFinite);
  return values.length ? Math.max(...values) : undefined;
}

function failure(projectId: string, query: string, warning: string): WhyResult {
  return { schema_version: 1, project_id: projectId, query, classification: "retrieval_failure", candidates: [], warning_flags: [warning] };
}
