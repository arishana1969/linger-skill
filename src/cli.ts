#!/usr/bin/env node
import os from "node:os";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { capture } from "./capture.js";
import { capabilityReport } from "./adapters.js";
import { correct, forget, inspect } from "./control.js";
import { appendDecision, getDecisionTrail, listDecisionViews, type DecisionKind, type DecisionSource, type DecisionStatus } from "./decisions.js";
import { deleteLastRecord, deleteRecord, type DeleteTarget } from "./delete.js";
import { doctor } from "./doctor.js";
import { commitEnrichment, enrichmentStatus, prepareEnrichmentBatch } from "./enrichment.js";
import { confirmPrivacyConsent, parseAdapterSelection } from "./install-consent.js";
import { install, PRIVACY_NOTICE, uninstall } from "./installer.js";
import { recoverPending } from "./pending.js";
import { purge } from "./purge.js";
import { processQueue } from "./processing.js";
import { rebuildTagRegistry } from "./tag-registry.js";
import { addTermRelation, type TermRelationType } from "./term-graph.js";
import { quarantineInvalidFiles } from "./repair.js";
import { recall } from "./recall.js";
import { recallSamplingReport, recordRecallAttempt, recordRecallFeedback, type RawLocated, type RecallFeedbackOutcome } from "./recall-sampling.js";
import { search } from "./search.js";
import { initVault, listProjects, registerProject, setPaused, vaultStats } from "./vault.js";
import { assertDecisionEvidenceNotHookOwned } from "./hook-ownership.js";

const args = process.argv.slice(2);
const vault = option("--vault") ?? process.env.LINGER_VAULT ?? path.join(os.homedir(), ".linger", "vault");
const command = args.shift();
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function option(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  args.splice(index, 2);
  return value;
}
function required(name: string): string { return option(name) ?? throwError(`${name} is required`); }
function flag(name: string): boolean { const index = args.indexOf(name); if (index < 0) return false; args.splice(index, 1); return true; }
function numberOption(name: string, fallback: number): number { const raw = option(name); const value = raw === undefined ? fallback : Number(raw); if (!Number.isFinite(value)) throw new Error(`${name} must be a number`); return value; }

async function main(): Promise<void> {
  switch (command) {
    case "install": {
      const home = option("--home") ?? os.homedir();
      const adapters = parseAdapterSelection(option("--adapters"));
      if (!flag("--yes")) {
        if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error(`install requires --yes when stdin/stdout are non-interactive. Review privacy boundary first: ${PRIVACY_NOTICE}`);
        if (!await confirmPrivacyConsent(process.stdin, process.stdout)) throw new Error("install cancelled: privacy consent was not confirmed");
      }
      output(await install({ home, packageRoot, adapters })); break;
    }
    case "uninstall": { if (!flag("--yes")) throw new Error("uninstall requires --yes; vault will be preserved"); output(await uninstall(option("--home") ?? os.homedir())); break; }
    case "purge": output(await purge(option("--home") ?? os.homedir(), { yes: flag("--yes"), phrase: required("--confirm") })); break;
    case "capabilities": output(await capabilityReport(option("--home") ?? os.homedir())); break;
    case "init": output(await initVault(vault)); break;
    case "project-id": console.log((await registerProject(vault, option("--cwd") ?? process.cwd())).project_id); break;
    case "projects": output(await listProjects(vault)); break;
    case "capture": {
      const explicit = flag("--explicit");
      const event = await capture(vault, {
        projectId: option("--project") ?? (await registerProject(vault, process.cwd())).project_id, sessionId: option("--session") ?? "manual",
        turnId: option("--turn") ?? `turn-${Date.now()}`, role: (option("--role") ?? "user") as "user" | "assistant" | "system",
        content: required("--content"), sourceAgent: option("--agent") ?? "manual", savepointStatus: flag("--partial") ? "partial" : "complete",
        explicit, reuseRecentHookCapture: true, sensitivity: flag("--secret") ? "secret" : flag("--sensitive") ? "sensitive" : "normal"
      });
      output(event ?? { skipped: "paused" }); break;
    }
    case "recover": output(await recoverPending(vault)); break;
    case "process": output(await processQueue(vault, option("--project"))); break;
    case "enrich-pull": {
      const projectId = option("--project") ?? (await registerProject(vault, process.cwd())).project_id;
      const batch = await prepareEnrichmentBatch(vault, projectId, { limit: numberOption("--limit", 6), maxCharacters: numberOption("--max-characters", 12000) });
      output(batch ?? { pending: false, project_id: projectId }); break;
    }
    case "enrich-commit": output(await commitEnrichment(vault, await readSubmission(required("--input")))); break;
    case "enrich-status": output(await enrichmentStatus(vault, option("--project") ?? (await registerProject(vault, process.cwd())).project_id)); break;
    case "tags-rebuild": output(await rebuildTagRegistry(vault, required("--project"))); break;
    case "term-add": output(await addTermRelation(vault, { project_id: required("--project"), term_a: required("--term-a"), term_b: required("--term-b"), relation_type: required("--relation") as TermRelationType, confidence: numberOption("--confidence", 0.8), context_tags: option("--context")?.split(",").filter(Boolean) ?? [], evidence_refs: required("--evidence").split(",").filter(Boolean) })); break;
    case "recall": {
      const projectId = option("--project") ?? (await registerProject(vault, process.cwd())).project_id;
      const sample = flag("--sample");
      const includeRaw = flag("--include-raw");
      const maxCharacters = numberOption("--max-characters", 12000);
      const maxFiles = numberOption("--max-files", 5000);
      const maxRawFragmentCharacters = numberOption("--max-raw-fragment-characters", 500);
      const timeoutMs = numberOption("--timeout-ms", 2000);
      const from = option("--from");
      const to = option("--to");
      const query = option("--query") ?? args.join(" ");
      const result = await recall(vault, { projectId, query, includeRaw, maxCharacters, maxFiles, maxRawFragmentCharacters, timeoutMs, from, to });
      if (!sample) { output(result); break; }
      const attempt = await recordRecallAttempt(vault, { projectId, query, result });
      output({ ...result, attempt_id: attempt.attempt_id }); break;
    }
    case "recall-feedback": output(await recordRecallFeedback(vault, {
      projectId: required("--project"),
      attemptId: required("--attempt"),
      outcome: required("--outcome") as RecallFeedbackOutcome,
      rawLocated: (option("--raw-located") ?? "unknown") as RawLocated,
      decisionTrailUsed: flag("--decision-used"),
      note: option("--note")
    })); break;
    case "recall-samples": output(await recallSamplingReport(vault, required("--project"))); break;
    case "search": output(await search(vault, { projectId: option("--project") ?? (await registerProject(vault, process.cwd())).project_id, query: option("--query") ?? args.join(" "), includeRaw: flag("--include-raw"), maxFiles: numberOption("--max-files", 5000), maxRawFragmentCharacters: numberOption("--max-raw-fragment-characters", 500), timeoutMs: numberOption("--timeout-ms", 2000), from: option("--from"), to: option("--to") })); break;
    case "decision-add": {
      const projectId = required("--project");
      const evidenceRefs = required("--evidence").split(",").filter(Boolean);
      await assertDecisionEvidenceNotHookOwned(vault, projectId, evidenceRefs);
      output(await appendDecision(vault, {
      projectId, topic: required("--topic"), kind: (option("--kind") ?? "decision") as DecisionKind,
      status: (option("--status") ?? "current") as DecisionStatus, statement: required("--statement"), rationale: option("--rationale"),
      source: (option("--source") ?? "agent_inferred") as DecisionSource, confidence: numberOption("--confidence", 0.8),
      evidenceRefs, supersedes: option("--supersedes")?.split(",").filter(Boolean)
      })); break;
    }
    case "decision-get": output(await getDecisionTrail(vault, required("--project"), required("--topic")) ?? { found: false }); break;
    case "decision-list": output(await listDecisionViews(vault, required("--project"))); break;
    case "forget": output(await forget(vault, required("--project"), required("--memory"))); break;
    case "correct": output(await correct(vault, required("--project"), required("--memory"), required("--summary"), required("--evidence").split(",").filter(Boolean), option("--reason"))); break;
    case "delete": output(await deleteRecord(vault, { projectId: required("--project"), target: required("--type") as DeleteTarget, id: required("--id"), confirmed: flag("--yes"), reason: option("--reason") })); break;
    case "delete-last": output(await deleteLastRecord(vault, { projectId: required("--project"), target: required("--type") as DeleteTarget, confirmed: flag("--yes"), reason: option("--reason") })); break;
    case "inspect": output(await inspect(vault, required("--project"), required("--memory"))); break;
    case "pause": output(await setPaused(vault, true)); break;
    case "resume": output(await setPaused(vault, false)); break;
    case "status": output(await vaultStats(vault)); break;
    case "doctor": output(await doctor(vault)); break;
    case "doctor-repair": { if (!flag("--yes")) throw new Error("doctor-repair requires --yes"); output(await quarantineInvalidFiles(vault)); break; }
    default:
      console.log("linger <install|uninstall|purge|capabilities|init|project-id|projects|capture|recover|process|enrich-pull|enrich-commit|enrich-status|tags-rebuild|term-add|recall|recall-feedback|recall-samples|search|decision-add|decision-get|decision-list|forget|correct|delete|delete-last|inspect|pause|resume|status|doctor|doctor-repair> [options]");
      if (command) process.exitCode = 2;
  }
}

function output(value: unknown): void { console.log(JSON.stringify(value, null, 2)); }
function throwError(message: string): never { throw new Error(message); }
async function readSubmission(file: string): Promise<unknown> {
  const resolved = path.resolve(file);
  if ((await stat(resolved)).size > 512 * 1024) throw new Error("Enrichment submission is too large");
  return JSON.parse(await readFile(resolved, "utf8")) as unknown;
}
main().catch(error => { console.error(`linger: ${(error as Error).message}`); process.exitCode = 1; });
