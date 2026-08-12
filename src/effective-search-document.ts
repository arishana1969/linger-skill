import { createHash } from "node:crypto";
import path from "node:path";
import { readJson } from "./io.js";
import { effectiveMemoryStates, type EffectiveMemoryState } from "./memory-events.js";
import { assertSafeId, vaultPaths } from "./paths.js";
import { assertProcessedMemory, assertRawEvent } from "./schema-validation.js";
import { assertProcessedRecordPath, assertRawRecordPath } from "./record-paths.js";
import { classifySensitivity } from "./sensitivity.js";
import type { EnrichmentOverlay } from "./enrichment.js";
import { assertEnrichmentOverlay, readEnrichmentOverlays } from "./enrichment.js";
import type { ProcessedMemory, RawEvent, SavepointStatus } from "./types.js";
import { listJsonFiles } from "./vault.js";

export type EvidenceStatus = "verified" | "missing" | "tampered" | "wrong_project" | "invalid_path";
export type EffectiveIntegrity = "verified" | "partial" | "missing" | "tampered" | "mismatch" | "wrong_project" | "invalid_path";

export interface EvidenceDescriptor {
  event_id: string;
  project_id?: string;
  canonical_raw_ref?: string;
  declared_content_hash?: string;
  computed_content_hash?: string;
  savepoint_status?: SavepointStatus;
  sensitivity?: RawEvent["sensitivity"];
  schema_version?: number;
  path_verified: boolean;
  hash_verified: boolean;
  status: EvidenceStatus;
  excerpt?: string;
}

export interface EvidenceAssessment {
  integrity: EffectiveIntegrity;
  sensitivity: RawEvent["sensitivity"];
  source_savepoint_status: SavepointStatus;
  reasons: string[];
  warning_flags: string[];
}

export interface EffectiveSearchDocument {
  schema_version: 1;
  content_schema_version: "linger-effective-search-document/v1";
  project_id: string;
  memory_id: string;
  canonical_text: string;
  effective_content_hash: string;
  evidence_descriptors: EvidenceDescriptor[];
  evidence_digest: string;
  memory_identity: string;
  control_identity: string;
  overlay_identity?: string;
  source_savepoint_status: SavepointStatus;
  sensitivity: "normal" | "sensitive" | "secret";
  integrity: EffectiveIntegrity;
  effective_status: "active" | "revoked" | "superseded" | "deleted";
  eligibility: {
    lexical_default: boolean;
    lexical_explicit_sensitive: boolean;
    index: boolean;
  };
  ineligible_reasons: string[];
  warning_flags: string[];
  content_truncated: boolean;
  created_at: string;
  confidence: number;
  source: ProcessedMemory["source"];
  display_summary: string;
  search_tags: string[];
}

interface EvidenceCandidate {
  event?: RawEvent;
  pathVerified: boolean;
  computedHash?: string;
}

const CONTENT_SCHEMA_VERSION = "linger-effective-search-document/v1" as const;
const MAX_CONTENT_CODE_POINTS = 12_000;

export async function resolveEffectiveSearchDocuments(
  root: string,
  projectId: string,
  options: { maxFiles?: number } = {}
): Promise<EffectiveSearchDocument[]> {
  const project = assertSafeId(projectId, "project id");
  const p = vaultPaths(root);
  const maxFiles = boundedFiles(options.maxFiles ?? 5_000);
  const evidence = await loadEvidenceCandidates(root, maxFiles);
  const controls = await effectiveMemoryStates(root, project);
  const overlays = await readEnrichmentOverlays(root, project);
  const documents: EffectiveSearchDocument[] = [];
  const files = (await listJsonFiles(path.join(p.processed, project), p.root)).slice(0, maxFiles);
  for (const file of files) {
    try {
      const memory = await readJson<unknown>(file);
      assertProcessedMemory(memory);
      assertProcessedRecordPath(p, file, memory);
      documents.push(resolveDocument(memory, controls.get(memory.id), overlays.get(memory.id), evidence));
    } catch { /* Doctor reports invalid records. */ }
  }
  return documents.sort((left, right) => left.created_at.localeCompare(right.created_at) || left.memory_id.localeCompare(right.memory_id));
}

export async function resolveEvidenceDescriptors(
  root: string,
  projectId: string,
  eventIds: string[],
  options: { maxFiles?: number } = {}
): Promise<EvidenceDescriptor[]> {
  const project = assertSafeId(projectId, "project id");
  const evidence = await loadEvidenceCandidates(root, boundedFiles(options.maxFiles ?? 5_000));
  return descriptorsFor(project, eventIds, evidence);
}

export function assessEvidence(
  eventIds: string[],
  descriptors: EvidenceDescriptor[],
  options: { sourceHash?: string; requireLegacySingleHash?: boolean } = {}
): EvidenceAssessment {
  const reasons = new Set<string>();
  const warnings = new Set<string>();
  const unique = [...new Set(eventIds)];
  if (!eventIds.length) reasons.add("missing_source");
  if (unique.length !== eventIds.length) reasons.add("source_set_mismatch");
  const byId = new Map(descriptors.map(descriptor => [descriptor.event_id, descriptor]));
  const required = unique.map(eventId => byId.get(eventId) ?? missingDescriptor(eventId));
  for (const descriptor of required) {
    if (descriptor.status === "missing") reasons.add("missing_source");
    if (descriptor.status === "tampered") reasons.add("tampered_source");
    if (descriptor.status === "wrong_project") reasons.add("wrong_project");
    if (descriptor.status === "invalid_path") reasons.add("invalid_source_path");
    if (descriptor.savepoint_status === "partial" || descriptor.savepoint_status === "pending") warnings.add("partial_source");
    if (descriptor.sensitivity === "sensitive") warnings.add("sensitive_source");
    if (descriptor.sensitivity === "secret") warnings.add("secret_source");
  }
  if (unique.length === 1 && options.requireLegacySingleHash) {
    const actual = required[0]?.computed_content_hash;
    if (!options.sourceHash) warnings.add("unverified_source");
    else if (!actual || options.sourceHash !== actual) reasons.add("source_hash_mismatch");
  }

  const sensitivity = strongestSensitivity(required.map(descriptor => descriptor.sensitivity));
  const sourceSavepointStatus = strongestSavepoint(required.map(descriptor => descriptor.savepoint_status));
  let integrity: EffectiveIntegrity = sourceSavepointStatus === "complete" ? "verified" : "partial";
  if (reasons.has("wrong_project")) integrity = "wrong_project";
  else if (reasons.has("invalid_source_path")) integrity = "invalid_path";
  else if (reasons.has("tampered_source")) integrity = "tampered";
  else if (reasons.has("source_hash_mismatch") || reasons.has("source_set_mismatch")) integrity = "mismatch";
  else if (reasons.has("missing_source")) integrity = "missing";
  return {
    integrity,
    sensitivity,
    source_savepoint_status: sourceSavepointStatus,
    reasons: [...reasons].sort(),
    warning_flags: [...warnings].sort()
  };
}

function resolveDocument(
  memory: ProcessedMemory,
  control: EffectiveMemoryState | undefined,
  overlay: EnrichmentOverlay | undefined,
  evidence: Map<string, EvidenceCandidate[]>
): EffectiveSearchDocument {
  const descriptors = descriptorsFor(memory.project_id, memory.source_events, evidence);
  const assessment = assessEvidence(memory.source_events, descriptors, {
    sourceHash: memory.source_hash,
    requireLegacySingleHash: memory.type !== "correction"
  });
  const effectiveStatus = control?.status ?? memory.status;
  const ineligible = new Set(assessment.reasons);
  if (effectiveStatus !== "active") ineligible.add(effectiveStatus);
  const warnings = new Set(assessment.warning_flags);
  const usableOverlay = validateOverlay(memory, overlay);
  if (overlay && !usableOverlay.valid) warnings.add(usableOverlay.reason);
  const combinedSensitivity = strongestSensitivity([
    memory.sensitivity,
    assessment.sensitivity,
    usableOverlay.valid ? classifySensitivity(overlayText(usableOverlay.overlay)).level : undefined
  ]);
  if (combinedSensitivity === "sensitive") ineligible.add("sensitive_source");
  if (combinedSensitivity === "secret") ineligible.add("secret_source");
  const content = canonicalContent(memory, usableOverlay.valid ? usableOverlay.overlay : undefined);
  if (content.truncated) warnings.add("content_over_budget");
  const evidenceDigest = hashJson(descriptors.map(descriptor => ({
    event_id: descriptor.event_id,
    project_id: descriptor.project_id,
    canonical_raw_ref: descriptor.canonical_raw_ref,
    declared_content_hash: descriptor.declared_content_hash,
    computed_content_hash: descriptor.computed_content_hash,
    savepoint_status: descriptor.savepoint_status,
    sensitivity: descriptor.sensitivity,
    schema_version: descriptor.schema_version,
    path_verified: descriptor.path_verified,
    hash_verified: descriptor.hash_verified,
    status: descriptor.status
  })));
  const baseEligible = effectiveStatus === "active" && !assessment.reasons.length;
  const completeVerified = baseEligible && assessment.integrity === "verified";
  const normal = combinedSensitivity === "normal";
  return {
    schema_version: 1,
    content_schema_version: CONTENT_SCHEMA_VERSION,
    project_id: memory.project_id,
    memory_id: memory.id,
    canonical_text: content.text,
    effective_content_hash: sha256(content.text),
    evidence_descriptors: descriptors,
    evidence_digest: evidenceDigest,
    memory_identity: hashJson(memoryIdentity(memory)),
    control_identity: hashJson(control ?? { status: memory.status, event_ids: [] }),
    ...(usableOverlay.valid ? { overlay_identity: hashJson(usableOverlay.overlay) } : {}),
    source_savepoint_status: assessment.source_savepoint_status,
    sensitivity: combinedSensitivity,
    integrity: assessment.integrity,
    effective_status: effectiveStatus,
    eligibility: {
      lexical_default: baseEligible && normal,
      lexical_explicit_sensitive: baseEligible && combinedSensitivity !== "secret",
      index: completeVerified && normal
    },
    ineligible_reasons: [...ineligible].sort(),
    warning_flags: [...warnings].sort(),
    content_truncated: content.truncated,
    created_at: memory.created_at,
    confidence: memory.confidence,
    source: memory.source,
    display_summary: usableOverlay.valid ? usableOverlay.overlay.summary : memory.summary,
    search_tags: uniqueSorted([...(memory.tags ?? []), ...(usableOverlay.valid ? usableOverlay.overlay.tags : [])])
  };
}

async function loadEvidenceCandidates(root: string, maxFiles: number): Promise<Map<string, EvidenceCandidate[]>> {
  const p = vaultPaths(root);
  const result = new Map<string, EvidenceCandidate[]>();
  const files = (await listJsonFiles(p.raw, p.root)).slice(0, maxFiles);
  for (const file of files) {
    let value: unknown;
    try { value = await readJson<unknown>(file); } catch { continue; }
    const eventId = objectString(value, "event_id");
    if (!eventId) continue;
    let event: RawEvent | undefined;
    let pathVerified = false;
    let computedHash: string | undefined;
    try {
      assertRawEvent(value);
      event = value;
      computedHash = sha256(event.content);
      assertRawRecordPath(p, file, event);
      pathVerified = true;
    } catch { /* Preserve identifiable invalid evidence for fail-closed reporting. */ }
    const entries = result.get(eventId) ?? [];
    entries.push({ event, pathVerified, computedHash });
    result.set(eventId, entries);
  }
  return result;
}

function descriptorsFor(projectId: string, eventIds: string[], evidence: Map<string, EvidenceCandidate[]>): EvidenceDescriptor[] {
  return [...new Set(eventIds)].sort(compareUtf8).map(eventId => {
    const candidates = evidence.get(eventId) ?? [];
    const sameProject = candidates.find(candidate => candidate.event?.project_id === projectId);
    const candidate = sameProject ?? candidates[0];
    if (!candidate) return missingDescriptor(eventId);
    if (!sameProject && candidate.event) return descriptor(candidate, "wrong_project");
    if (!candidate.event || !candidate.pathVerified) return descriptor(candidate, "invalid_path", eventId);
    const hashVerified = candidate.computedHash === candidate.event.content_hash;
    return descriptor(candidate, hashVerified ? "verified" : "tampered");
  });
}

function descriptor(candidate: EvidenceCandidate, status: EvidenceStatus, fallbackId?: string): EvidenceDescriptor {
  const event = candidate.event;
  const hidden = event?.sensitivity !== "normal";
  return {
    event_id: event?.event_id ?? fallbackId ?? "unknown",
    ...(event ? {
      project_id: event.project_id,
      canonical_raw_ref: event.raw_ref,
      declared_content_hash: event.content_hash,
      ...(candidate.computedHash ? { computed_content_hash: candidate.computedHash } : {}),
      savepoint_status: event.savepoint_status,
      sensitivity: event.sensitivity,
      schema_version: event.schema_version,
      excerpt: hidden ? "[sensitive evidence hidden]" : codePointSlice(normalizeText(event.content), 500)
    } : {}),
    path_verified: candidate.pathVerified,
    hash_verified: Boolean(event && candidate.computedHash === event.content_hash),
    status
  };
}

function missingDescriptor(eventId: string): EvidenceDescriptor {
  return { event_id: eventId, path_verified: false, hash_verified: false, status: "missing" };
}

function validateOverlay(memory: ProcessedMemory, overlay: EnrichmentOverlay | undefined):
  | { valid: true; overlay: EnrichmentOverlay }
  | { valid: false; reason: "invalid_overlay" | "stale_overlay" } {
  if (!overlay) return { valid: false, reason: "invalid_overlay" };
  try { assertEnrichmentOverlay(overlay); } catch { return { valid: false, reason: "invalid_overlay" }; }
  if (overlay.project_id !== memory.project_id || overlay.memory_id !== memory.id || overlay.source_hash !== memory.source_hash || !sameSet(overlay.source_events, memory.source_events)) {
    return { valid: false, reason: "stale_overlay" };
  }
  if (classifySensitivity(overlayText(overlay)).level !== "normal") return { valid: false, reason: "invalid_overlay" };
  return { valid: true, overlay };
}

function canonicalContent(memory: ProcessedMemory, overlay?: EnrichmentOverlay): { text: string; truncated: boolean } {
  const fields: Array<[string, string[]]> = [
    ["deterministic.title", [memory.title]],
    ["deterministic.summary", [memory.summary]],
    ["deterministic.tags", uniqueSorted(memory.tags)],
    ["deterministic.predictive_tags", uniqueSorted(memory.predictive_tags)],
    ["deterministic.retrieval_phrases", uniqueSorted(memory.retrieval_phrases)]
  ];
  if (overlay) {
    fields.push(
      ["overlay.title", [overlay.title]],
      ["overlay.summary", [overlay.summary]],
      ["overlay.tags", withoutBaseline(overlay.tags, memory.tags)],
      ["overlay.predictive_tags", withoutBaseline(overlay.predictive_tags, memory.predictive_tags)],
      ["overlay.retrieval_phrases", withoutBaseline(overlay.retrieval_phrases, memory.retrieval_phrases)]
    );
  }
  const lines = fields.flatMap(([label, values]) => values.map(value => `${label}: ${normalizeText(value)}`).filter(line => !line.endsWith(": ")));
  const full = lines.join("\n");
  const points = [...full];
  return { text: points.slice(0, MAX_CONTENT_CODE_POINTS).join(""), truncated: points.length > MAX_CONTENT_CODE_POINTS };
}

function memoryIdentity(memory: ProcessedMemory): object {
  return {
    schema_version: memory.schema_version,
    id: memory.id,
    project_id: memory.project_id,
    type: memory.type,
    source_events: [...memory.source_events],
    source_hash: memory.source_hash,
    source_savepoint_status: memory.source_savepoint_status,
    sensitivity: memory.sensitivity,
    status: memory.status,
    updated_at: memory.updated_at
  };
}

function overlayText(overlay: EnrichmentOverlay): string {
  return [overlay.title, overlay.summary, ...overlay.tags, ...overlay.predictive_tags, ...overlay.retrieval_phrases].join("\n");
}

function withoutBaseline(values: string[], baseline: string[]): string[] {
  const existing = new Set(uniqueSorted(baseline));
  return uniqueSorted(values).filter(value => !existing.has(value));
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map(normalizeText).filter(Boolean))].sort(compareUtf8);
}

function normalizeText(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ");
}

function codePointSlice(value: string, max: number): string { return [...value].slice(0, max).join(""); }
function compareUtf8(left: string, right: string): number { return Buffer.compare(Buffer.from(left), Buffer.from(right)); }
function sha256(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function hashJson(value: unknown): string { return sha256(JSON.stringify(value)); }
function sameSet(left: string[], right: string[]): boolean { return left.length === right.length && new Set(left).size === left.length && left.every(value => right.includes(value)); }
function boundedFiles(value: number): number { if (!Number.isInteger(value) || value < 1 || value > 50_000) throw new Error("maxFiles must be an integer from 1 to 50000"); return value; }
function objectString(value: unknown, key: string): string | undefined { return value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>)[key] === "string" ? (value as Record<string, string>)[key] : undefined; }

function strongestSensitivity(values: Array<RawEvent["sensitivity"] | ProcessedMemory["sensitivity"] | undefined>): "normal" | "sensitive" | "secret" {
  const rank = { normal: 0, sensitive: 1, secret: 2 } as const;
  return values.filter((value): value is "normal" | "sensitive" | "secret" => Boolean(value)).reduce((strongest, value) => rank[value] > rank[strongest] ? value : strongest, "normal" as "normal" | "sensitive" | "secret");
}

function strongestSavepoint(values: Array<SavepointStatus | undefined>): SavepointStatus {
  if (values.some(value => value === "pending")) return "pending";
  if (values.some(value => value === "partial")) return "partial";
  return "complete";
}
