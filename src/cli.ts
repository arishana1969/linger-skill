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
import { quarantineInvalidFiles } from "./repair.js";
import { recall } from "./recall.js";
import { parseSettingValue, resolveSettings, setSetting } from "./settings.js";
import { attachProject, confirmProjectIdentity, initVault, listProjects, projectId, registerProject, setPaused } from "./vault.js";
import { assertDecisionEvidenceNotHookOwned } from "./hook-ownership.js";
import { why } from "./why.js";
import { deleteEmbeddingIndex } from "./local/embedding-index.js";
import { localEmbeddingStatus } from "./local/local-embedding.js";
import { localHybridSearch, rebuildLocalEmbeddingIndex, setLocalEmbeddingEnabled } from "./local/local-embedding-runtime.js";
import { installLocalEmbeddingForProject, localEmbeddingInstallPlan, removeLocalEmbeddingRuntime } from "./local/local-embedding-install.js";
import { assertSupportedRuntime } from "./runtime-support.js";
import { disableSession, enableSession, sessionControlStatus } from "./session-control.js";
import { lingerStatus } from "./status.js";

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
function required(name: string): string {
  return option(name) ?? throwError(`${name} is required`);
}
function flag(name: string): boolean {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}
function numberOption(name: string, fallback: number): number {
  const raw = option(name);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return value;
}
function optionalNumberOption(name: string): number | undefined {
  const raw = option(name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return value;
}

async function main(): Promise<void> {
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }
  if (command === "version" || command === "--version" || command === "-v") {
    const value = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as { version?: unknown };
    if (typeof value.version !== "string") throw new Error("Invalid package version");
    console.log(value.version);
    return;
  }
  if (command !== "uninstall" && command !== "purge") await assertSupportedRuntime();
  switch (command) {
    case "install": {
      const home = option("--home") ?? os.homedir();
      const adapters = parseAdapterSelection(option("--adapters"));
      const conflict = option("--on-entry-conflict") ?? "error";
      if (conflict !== "error" && conflict !== "cli-only") throw new Error("--on-entry-conflict must be error or cli-only");
      if (!flag("--yes")) {
        if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error(`install requires --yes when stdin/stdout are non-interactive. Review privacy boundary first: ${PRIVACY_NOTICE}`);
        if (!await confirmPrivacyConsent(process.stdin, process.stdout)) throw new Error("install cancelled: privacy consent was not confirmed");
      }
      output(await install({ home, packageRoot, adapters, onEntryConflict: conflict })); break;
    }
    case "uninstall": {
      if (!flag("--yes")) throw new Error("uninstall requires --yes; vault will be preserved");
      output(await uninstall(option("--home") ?? os.homedir()));
      break;
    }
    case "purge": output(await purge(option("--home") ?? os.homedir(), { yes: flag("--yes"), phrase: required("--confirm") })); break;
    case "capabilities": output(await capabilityReport(option("--home") ?? os.homedir())); break;
    case "init": output(await initVault(vault)); break;
    case "project-id": console.log(await projectId(option("--cwd") ?? process.cwd(), vault)); break;
    case "projects": output(await listProjects(vault)); break;
    case "project-attach": output(await attachProject(vault, required("--project"), option("--cwd") ?? process.cwd(), flag("--yes"))); break;
    case "project-confirm-identity": output(await confirmProjectIdentity(vault, required("--project"), option("--cwd") ?? process.cwd(), flag("--yes"))); break;
    case "config": {
      const subcommand = args.shift();
      const projectId = option("--project");
      if (subcommand === "show" || subcommand === "validate") {
        output(subcommand === "show" ? await resolveSettings(vault, { projectId }) : { ok: true, settings: await resolveSettings(vault, { projectId }) });
        break;
      }
      if (subcommand === "set") {
        const scope = required("--scope");
        if (scope !== "global" && scope !== "project") throw new Error("--scope must be global or project");
        const key = required("--key");
        output(await setSetting(vault, { scope, key, value: parseSettingValue(key, required("--value")), projectId, ifRevision: optionalNumberOption("--if-revision") }));
        break;
      }
      throw new Error("config requires show, validate, or set");
    }
    case "capture": {
      const explicit = flag("--explicit");
      const event = await capture(vault, {
        projectId: option("--project") ?? (await registerProject(vault, process.cwd())).project_id,
        sessionId: option("--session") ?? "manual",
        turnId: option("--turn") ?? `turn-${Date.now()}`,
        role: (option("--role") ?? "user") as "user" | "assistant" | "system",
        content: required("--content"),
        sourceAgent: option("--agent") ?? "manual",
        savepointStatus: flag("--partial") ? "partial" : "complete",
        explicit,
        reuseRecentHookCapture: true,
        sensitivity: flag("--secret") ? "secret" : flag("--sensitive") ? "sensitive" : "normal"
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
    case "embedding-status": {
      const embeddingProject = option("--project") ?? await projectId(option("--cwd") ?? process.cwd(), vault);
      output(await localEmbeddingStatus(vault, embeddingProject)); break;
    }
    case "embedding-install-plan": output(await localEmbeddingInstallPlan(packageRoot)); break;
    case "embedding-install": {
      if (!flag("--yes")) throw new Error("embedding-install requires --yes after reviewing embedding-install-plan");
      output(await installLocalEmbeddingForProject(vault, { projectId: required("--project"), packageRoot })); break;
    }
    case "embedding-enable": output(await setLocalEmbeddingEnabled(vault, required("--project"), true)); break;
    case "embedding-disable": output(await setLocalEmbeddingEnabled(vault, required("--project"), false)); break;
    case "embedding-remove-runtime": output(await removeLocalEmbeddingRuntime(vault, required("--project"), flag("--yes"))); break;
    case "embedding-rebuild": output(await rebuildLocalEmbeddingIndex(vault, required("--project"))); break;
    case "embedding-delete-index": output(await deleteEmbeddingIndex(vault, required("--project"), flag("--yes"))); break;
    case "recall": {
      const projectId = option("--project") ?? (await registerProject(vault, process.cwd())).project_id;
      if (flag("--sample")) throw new Error("recall sampling is a developer-only evaluation tool in v1");
      const includeRaw = flag("--include-raw");
      const maxCharacters = optionalNumberOption("--max-characters");
      const maxFiles = optionalNumberOption("--max-files");
      const maxRawFragmentCharacters = optionalNumberOption("--max-raw-fragment-characters");
      const timeoutMs = optionalNumberOption("--timeout-ms");
      const from = option("--from");
      const to = option("--to");
      const query = option("--query") ?? args.join(" ");
      const hybrid = await localHybridSearch(vault, { projectId, query, includeRaw, maxFiles, maxRawFragmentCharacters, timeoutMs, from, to });
      const retrievalMode = hybrid.effective_mode === "hybrid"
        ? "hybrid"
        : hybrid.semantic_status === "failed" || hybrid.semantic_status === "timeout"
          ? "deterministic_fallback"
          : "deterministic";
      const result = await recall(vault, {
        projectId,
        query,
        includeRaw,
        maxCharacters,
        maxFiles,
        maxRawFragmentCharacters,
        timeoutMs,
        from,
        to,
        initialHits: hybrid.hits,
        retrievalMode,
        degradedReason: hybrid.degraded_reason
      });
      output(result); break;
    }
    case "search": {
      const result = await localHybridSearch(vault, {
        projectId: option("--project") ?? (await registerProject(vault, process.cwd())).project_id,
        query: option("--query") ?? args.join(" "),
        includeRaw: flag("--include-raw"),
        maxFiles: optionalNumberOption("--max-files"),
        maxRawFragmentCharacters: optionalNumberOption("--max-raw-fragment-characters"),
        timeoutMs: optionalNumberOption("--timeout-ms"),
        from: option("--from"),
        to: option("--to")
      });
      output(result.hits);
      break;
    }
    case "decision-add": {
      const projectId = required("--project");
      const evidenceRefs = required("--evidence").split(",").filter(Boolean);
      await assertDecisionEvidenceNotHookOwned(vault, projectId, evidenceRefs);
      output(await appendDecision(vault, {
        projectId,
        topic: required("--topic"),
        kind: (option("--kind") ?? "decision") as DecisionKind,
        status: (option("--status") ?? "current") as DecisionStatus,
        statement: required("--statement"),
        rationale: option("--rationale"),
        source: (option("--source") ?? "agent_inferred") as DecisionSource,
        confidence: numberOption("--confidence", 0.8),
        evidenceRefs,
        supersedes: option("--supersedes")?.split(",").filter(Boolean)
      })); break;
    }
    case "decision-get": output(await getDecisionTrail(vault, required("--project"), required("--topic")) ?? { found: false }); break;
    case "decision-list": output(await listDecisionViews(vault, required("--project"))); break;
    case "why": {
      const whyProject = option("--project") ?? await projectId(option("--cwd") ?? process.cwd(), vault);
      const evaluatedAt = option("--at");
      const topic = option("--topic") ?? args.join(" ");
      output(await why(vault, { projectId: whyProject, topic, ...(evaluatedAt ? { now: new Date(evaluatedAt) } : {}) }));
      break;
    }
    case "forget": output(await forget(vault, required("--project"), required("--memory"))); break;
    case "correct": output(await correct(
      vault,
      required("--project"),
      required("--memory"),
      required("--summary"),
      required("--evidence").split(",").filter(Boolean),
      option("--reason")
    )); break;
    case "delete": output(await deleteRecord(vault, {
      projectId: required("--project"),
      target: required("--type") as DeleteTarget,
      id: required("--id"),
      confirmed: flag("--yes"),
      reason: option("--reason")
    })); break;
    case "delete-last": output(await deleteLastRecord(vault, {
      projectId: required("--project"),
      target: required("--type") as DeleteTarget,
      confirmed: flag("--yes"),
      reason: option("--reason")
    })); break;
    case "inspect": output(await inspect(vault, required("--project"), required("--memory"))); break;
    case "pause": output(await setPaused(vault, true)); break;
    case "resume": output(await setPaused(vault, false)); break;
    case "session-off": output(await disableSession(vault, required("--token"))); break;
    case "session-on": output(await enableSession(vault, required("--token"))); break;
    case "session-status": output(await sessionControlStatus(vault, required("--token"))); break;
    case "status": output(await lingerStatus(vault, {
      projectId: option("--project"),
      cwd: option("--cwd"),
      home: option("--home") ?? os.homedir(),
      sessionToken: option("--session-token")
    })); break;
    case "doctor": output(await doctor(vault)); break;
    case "doctor-repair": { if (!flag("--yes")) throw new Error("doctor-repair requires --yes"); output(await quarantineInvalidFiles(vault)); break; }
    default:
      printHelp();
      process.exitCode = 2;
  }
}

function output(value: unknown): void { console.log(JSON.stringify(value, null, 2)); }
function throwError(message: string): never { throw new Error(message); }
async function readSubmission(file: string): Promise<unknown> {
  const resolved = path.resolve(file);
  if ((await stat(resolved)).size > 512 * 1024) throw new Error("Enrichment submission is too large");
  return JSON.parse(await readFile(resolved, "utf8")) as unknown;
}
function printHelp(): void {
  console.log(`linger <command> [options]

Core: status, recall, search, why, inspect, forget, correct, delete
Session: session-off, session-on, session-status
Control: pause, resume, doctor, doctor-repair
Projects: project-id, projects, project-attach, project-confirm-identity
Local embedding: embedding-status, embedding-install-plan, embedding-install, embedding-enable, embedding-disable, embedding-rebuild, embedding-delete-index, embedding-remove-runtime
Install: install, uninstall, purge, capabilities
Run "linger <command> --help" is not yet supported; see the installed Linger Skill protocol for exact options.`);
}
main().catch(error => { console.error(`linger: ${(error as Error).message}`); process.exitCode = 1; });
