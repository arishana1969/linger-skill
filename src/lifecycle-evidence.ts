import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AdapterName } from "./adapters.js";
import { assertReadableInside, assertWritableInside, ensureDir, readJson } from "./io.js";
import { listVaultJsonCandidates } from "./vault-candidates.js";
import { assertSafeId, vaultPaths } from "./paths.js";
import { resolveSettings } from "./settings.js";
import { readProjectRecord, vaultStats } from "./vault.js";
import { assertRawRecordPath } from "./record-paths.js";
import { assertRawEvent } from "./schema-validation.js";

export type LifecycleRecordKind = "hook_started" | "capture_terminal" | "hook_terminal";
export type LifecycleOutcome = "success" | "skip" | "failure";

export interface LifecycleEvidence {
  schema_version: 3;
  record_id: string;
  operation_id: string;
  record_kind: LifecycleRecordKind;
  adapter: AdapterName;
  runtime_identity: string;
  project_id: string;
  project_root_identity: string;
  session_identity?: string;
  turn_identity?: string;
  lifecycle_event: "SessionStart" | "SessionEnd" | "UserPromptSubmit" | "Stop" | "StopFailure";
  observed_at: string;
  outcome: LifecycleOutcome;
  stage: "hook" | "capture" | "processing";
  error_code?: "capture_paused" | "capture_failed" | "hook_failed";
  captured_event_id?: string;
  savepoint_status?: "pending" | "complete" | "partial";
  partial: boolean;
}

export interface HealthDomain {
  state: "paused" | "broken" | "degraded" | "healthy" | "unknown";
  reason_codes: string[];
  observed_at?: string;
}

export interface HealthReport {
  schema_version: 1;
  project_id: string;
  overall: HealthDomain;
  adapter_capability: HealthDomain;
  static_integration: HealthDomain;
  capture_health: HealthDomain;
  pipeline_health: HealthDomain;
  builtin_policy: { evidence_freshness_hours: 24; started_terminal_grace_seconds: 30 };
}

export interface VerifiedLiveSession {
  session_id: string;
  project_id: string;
  runtime_identity: string;
}

export function runtimeIdentity(locator?: { node: string; cli: string; vault: string }, supplied?: string): string {
  if (/^[a-f0-9]{64}$/.test(supplied ?? "")) return supplied!;
  return createHash("sha256").update(JSON.stringify(locator ?? { node: process.execPath })).digest("hex");
}

export function rootIdentity(cwd: string): string {
  return createHash("sha256").update(path.resolve(cwd)).digest("hex");
}

export async function operationalEvidenceEnabled(root: string): Promise<boolean> {
  return (await resolveSettings(root)).values["capture_health.operational_evidence"].value === "minimal";
}

export async function recordLifecycleEvidence(root: string, input: Omit<LifecycleEvidence, "schema_version" | "record_id" | "observed_at"> & { observedAt?: string }): Promise<LifecycleEvidence> {
  const project = assertSafeId(input.project_id, "lifecycle project id");
  assertEvidenceInput(input);
  const record: LifecycleEvidence = {
    schema_version: 3,
    record_id: `obs_${randomUUID()}`,
    operation_id: assertSafeId(input.operation_id, "lifecycle operation id"),
    record_kind: input.record_kind,
    adapter: input.adapter,
    runtime_identity: input.runtime_identity,
    project_id: project,
    project_root_identity: input.project_root_identity,
    ...(input.session_identity ? { session_identity: assertSafeId(input.session_identity, "lifecycle session id") } : {}),
    ...(input.turn_identity ? { turn_identity: assertSafeId(input.turn_identity, "lifecycle turn id") } : {}),
    lifecycle_event: input.lifecycle_event,
    observed_at: input.observedAt ?? new Date().toISOString(),
    outcome: input.outcome,
    stage: input.stage,
    ...(input.error_code ? { error_code: input.error_code } : {}),
    ...(input.captured_event_id ? { captured_event_id: assertSafeId(input.captured_event_id, "captured event id") } : {}),
    ...(input.savepoint_status ? { savepoint_status: input.savepoint_status } : {}),
    partial: input.partial
  };
  assertLifecycleEvidence(record);
  const day = record.observed_at.slice(0, 10);
  const dir = path.join(vaultPaths(root).registry, "lifecycle-evidence", "v3", record.adapter, project, day);
  const file = path.join(dir, `${record.record_id}.json`);
  await assertWritableInside(root, file);
  await ensureDir(dir);
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return record;
}

export async function healthReport(root: string, input: { projectId: string; home?: string; now?: Date }): Promise<HealthReport> {
  const projectId = assertSafeId(input.projectId, "project id");
  const now = input.now ?? new Date();
  const settings = await resolveSettings(root, { projectId });
  const paused = settings.values["capture.paused"].value === true;
  const evidenceEnabled = settings.values["capture_health.operational_evidence"].value === "minimal";
  const records = evidenceEnabled ? await readLifecycleEvidence(root, projectId) : [];
  const { capabilityReport } = await import("./adapters.js");
  const capabilities = await capabilityReport(input.home ?? os.homedir()).catch(() => []);

  const adapterCapability = domain(
    capabilities.some(item => item.level >= 2) ? "healthy" : capabilities.some(item => item.level >= 1) ? "degraded" : "unknown",
    capabilities.some(item => item.level >= 2) ? "lifecycle_capability_available" : capabilities.some(item => item.level >= 1) ? "rule_only_capability" : "adapter_not_detected"
  );
  const staticIntegration = domain(
    capabilities.some(item => item.installed) ? "healthy" : "unknown",
    capabilities.some(item => item.installed) ? "managed_entry_present" : "managed_entry_unobserved"
  );
  let capture = reduceCapture(records, now, paused, evidenceEnabled);
  const project = await readProjectRecord(root, projectId).catch(() => undefined);
  if (!paused && project?.identity_changed) capture = domain("degraded", [...capture.reason_codes, "project_identity_changed"]);
  const stats = await vaultStats(root, projectId);
  const pipeline = reducePipeline(stats, paused);
  const overall = reduceOverall(paused, [capture, pipeline]);
  return {
    schema_version: 1,
    project_id: projectId,
    overall,
    adapter_capability: adapterCapability,
    static_integration: staticIntegration,
    capture_health: capture,
    pipeline_health: pipeline,
    builtin_policy: { evidence_freshness_hours: 24, started_terminal_grace_seconds: 30 }
  };
}

export async function readLifecycleEvidence(root: string, projectId: string): Promise<LifecycleEvidence[]> {
  const project = assertSafeId(projectId, "project id");
  const base = path.join(vaultPaths(root).registry, "lifecycle-evidence", "v3");
  const candidates = (await listVaultJsonCandidates(base, vaultPaths(root).root))
    .filter(file => file.includes(`${path.sep}${project}${path.sep}`))
    .slice(-2000);
  const records: LifecycleEvidence[] = [];
  for (const file of candidates) {
    try {
      const value = JSON.parse(await readFile(file, "utf8")) as unknown;
      assertLifecycleEvidence(value);
      assertLifecycleEvidencePath(root, file, value);
      if (value.project_id === project) records.push(value);
    } catch { /* invalid evidence is ignored here and reported by Doctor */ }
  }
  return records.sort((a, b) => a.observed_at.localeCompare(b.observed_at) || a.record_id.localeCompare(b.record_id));
}

export async function verifiedCodexLifecycleSession(root: string, runtimeIdentities: string[]): Promise<VerifiedLiveSession | undefined> {
  const allowed = new Set(runtimeIdentities.filter(identity => /^[a-f0-9]{64}$/.test(identity)));
  if (!allowed.size) return undefined;
  const base = path.join(vaultPaths(root).registry, "lifecycle-evidence", "v3", "codex");
  const groups = new Map<string, LifecycleEvidence[]>();
  for (const file of (await listVaultJsonCandidates(base, vaultPaths(root).root)).slice(-2000)) {
    try {
      const value = await readJson<unknown>(file);
      assertLifecycleEvidence(value);
      assertLifecycleEvidencePath(root, file, value);
      if (!value.session_identity || !allowed.has(value.runtime_identity)) continue;
      const key = `${value.session_identity}\0${value.project_id}\0${value.runtime_identity}`;
      groups.set(key, [...(groups.get(key) ?? []), value]);
    } catch { /* Doctor reports invalid evidence. */ }
  }
  for (const records of [...groups.values()].sort((a, b) => latest(b).localeCompare(latest(a)))) {
    const first = records[0]!;
    if (!hasTerminal(records, "SessionStart")) continue;
    const user = captured(records, "UserPromptSubmit");
    const assistant = captured(records, "Stop");
    if (!user || !assistant) continue;
    if (await verifiedRawCapture(root, first, user, "user") && await verifiedRawCapture(root, first, assistant, "assistant")) {
      return { session_id: first.session_identity!, project_id: first.project_id, runtime_identity: first.runtime_identity };
    }
  }
  return undefined;
}

export function assertLifecycleEvidencePath(root: string, file: string, record: LifecycleEvidence): void {
  const expected = path.join(vaultPaths(root).registry, "lifecycle-evidence", "v3", record.adapter, record.project_id, record.observed_at.slice(0, 10), `${record.record_id}.json`);
  if (path.resolve(file) !== path.resolve(expected)) throw new Error("Invalid lifecycle evidence path");
}

export function assertLifecycleEvidence(value: unknown): asserts value is LifecycleEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid lifecycle evidence");
  const item = value as Record<string, unknown>;
  if (item.schema_version !== 3) throw new Error("Invalid lifecycle evidence schema");
  for (const key of ["record_id", "operation_id", "record_kind", "adapter", "runtime_identity", "project_id", "project_root_identity", "lifecycle_event", "observed_at", "outcome", "stage"] as const) {
    if (typeof item[key] !== "string" || !(item[key] as string).length) throw new Error(`Invalid lifecycle evidence ${key}`);
  }
  assertSafeId(item.record_id as string, "lifecycle record id");
  assertSafeId(item.operation_id as string, "lifecycle operation id");
  assertSafeId(item.project_id as string, "lifecycle project id");
  if (!/^[a-f0-9]{64}$/.test(item.runtime_identity as string) || !/^[a-f0-9]{64}$/.test(item.project_root_identity as string)) throw new Error("Invalid lifecycle identity");
  if (!["hook_started", "capture_terminal", "hook_terminal"].includes(item.record_kind as string)) throw new Error("Invalid lifecycle record kind");
  if (!["claude-code", "codex"].includes(item.adapter as string)) throw new Error("Invalid lifecycle adapter");
  if (!["SessionStart", "SessionEnd", "UserPromptSubmit", "Stop", "StopFailure"].includes(item.lifecycle_event as string)) throw new Error("Invalid lifecycle event");
  if (!["success", "skip", "failure"].includes(item.outcome as string) || !["hook", "capture", "processing"].includes(item.stage as string)) throw new Error("Invalid lifecycle terminal");
  if (!Number.isFinite(Date.parse(item.observed_at as string)) || typeof item.partial !== "boolean") throw new Error("Invalid lifecycle timestamp");
  if (item.session_identity !== undefined) assertSafeId(String(item.session_identity), "lifecycle session id");
  if (item.turn_identity !== undefined) assertSafeId(String(item.turn_identity), "lifecycle turn id");
  if (item.captured_event_id !== undefined) assertSafeId(String(item.captured_event_id), "captured event id");
  if (item.error_code !== undefined && !["capture_paused", "capture_failed", "hook_failed"].includes(String(item.error_code))) throw new Error("Invalid lifecycle error code");
  if (item.record_kind === "capture_terminal" && item.outcome === "success" && typeof item.captured_event_id !== "string") throw new Error("Lifecycle capture success lacks event id");
}

function assertEvidenceInput(input: Omit<LifecycleEvidence, "schema_version" | "record_id" | "observed_at">): void {
  if (!/^[a-f0-9]{64}$/.test(input.runtime_identity) || !/^[a-f0-9]{64}$/.test(input.project_root_identity)) throw new Error("Invalid lifecycle identity");
}

function hasTerminal(records: LifecycleEvidence[], event: LifecycleEvidence["lifecycle_event"]): boolean {
  return records.some(record => record.lifecycle_event === event && record.record_kind === "hook_terminal" && record.outcome === "success");
}

function captured(records: LifecycleEvidence[], event: LifecycleEvidence["lifecycle_event"]): string | undefined {
  return [...records].reverse().find(record => record.lifecycle_event === event && record.record_kind === "capture_terminal" && record.outcome === "success")?.captured_event_id;
}

function latest(records: LifecycleEvidence[]): string {
  return records.reduce((value, record) => value > record.observed_at ? value : record.observed_at, "");
}

async function verifiedRawCapture(root: string, session: LifecycleEvidence, eventId: string, role: "user" | "assistant"): Promise<boolean> {
  const p = vaultPaths(root);
  const file = path.join(p.raw, session.project_id, session.session_identity!, `${eventId}.json`);
  try {
    await assertReadableInside(root, file);
    const event = await readJson<unknown>(file);
    assertRawEvent(event);
    assertRawRecordPath(p, file, event);
    return event.event_id === eventId
      && event.project_id === session.project_id
      && event.session_id === session.session_identity
      && event.role === role
      && event.source_agent === "codex"
      && event.content_hash === createHash("sha256").update(event.content).digest("hex");
  } catch {
    return false;
  }
}

function reduceCapture(records: LifecycleEvidence[], now: Date, paused: boolean, enabled: boolean): HealthDomain {
  if (paused) return domain("paused", "capture_paused");
  if (!enabled) return domain("unknown", "operational_evidence_disabled");
  const freshSince = now.getTime() - 24 * 60 * 60 * 1000;
  const fresh = records.filter(record => Date.parse(record.observed_at) >= freshSince);
  const capture = [...fresh].reverse().find(record => record.record_kind === "capture_terminal");
  if (capture?.outcome === "success") return { ...domain("healthy", "fresh_capture_terminal"), observed_at: capture.observed_at };
  if (capture?.outcome === "failure") return { ...domain("broken", capture.error_code ?? "capture_failed"), observed_at: capture.observed_at };
  const terminals = new Set(fresh.filter(record => record.record_kind === "hook_terminal").map(record => record.operation_id));
  const incomplete = [...fresh].reverse().find(record => record.record_kind === "hook_started" && !terminals.has(record.operation_id) && now.getTime() - Date.parse(record.observed_at) > 30000);
  if (incomplete) return { ...domain("degraded", "lifecycle_incomplete"), observed_at: incomplete.observed_at };
  return domain("unknown", fresh.length ? "capture_terminal_unobserved" : "fresh_lifecycle_unobserved");
}

function reducePipeline(stats: Record<string, number | boolean | string>, paused: boolean): HealthDomain {
  if (paused) return domain("paused", "capture_paused");
  if (!stats.initialized) return domain("unknown", "vault_not_initialized");
  if (Number(stats.queue_invalid) > 0 || Number(stats.queue_failed) > 0 || Number(stats.pending_captures) > 0) return domain("broken", "pipeline_failure_or_recovery_required");
  if (Number(stats.queue_pending) > 0 || Number(stats.queue_processing) > 0) return domain("degraded", "pipeline_backlog");
  return domain("healthy", "pipeline_clear");
}

function reduceOverall(paused: boolean, domains: HealthDomain[]): HealthDomain {
  if (paused) return domain("paused", "capture_paused");
  for (const state of ["broken", "degraded", "unknown"] as const) {
    const matches = domains.filter(item => item.state === state);
    if (matches.length) return { state, reason_codes: [...new Set(matches.flatMap(item => item.reason_codes))] };
  }
  return domain("healthy", "capture_and_pipeline_healthy");
}

function domain(state: HealthDomain["state"], reason: string | string[]): HealthDomain { return { state, reason_codes: [...new Set(Array.isArray(reason) ? reason : [reason])] }; }
