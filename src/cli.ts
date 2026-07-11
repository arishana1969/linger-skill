#!/usr/bin/env node
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { capture } from "./capture.js";
import { capabilityReport } from "./adapters.js";
import { forget, inspect } from "./control.js";
import { appendDecision, getDecisionTrail, listDecisionViews, type DecisionKind, type DecisionSource, type DecisionStatus } from "./decisions.js";
import { doctor } from "./doctor.js";
import { install, uninstall } from "./installer.js";
import { processQueue } from "./processing.js";
import { search } from "./search.js";
import { initVault, projectId, setPaused, vaultStats } from "./vault.js";

const args = process.argv.slice(2);
const command = args.shift();
const vault = option("--vault") ?? process.env.CONTINUITY_VAULT ?? path.join(os.homedir(), ".continuity", "vault");
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
    case "install": { const home = option("--home") ?? os.homedir(); flag("--yes"); output(await install({ home, packageRoot })); break; }
    case "uninstall": { if (!flag("--yes")) throw new Error("uninstall requires --yes; vault will be preserved"); output(await uninstall(option("--home") ?? os.homedir())); break; }
    case "capabilities": output(await capabilityReport(option("--home") ?? os.homedir())); break;
    case "init": output(await initVault(vault)); break;
    case "project-id": console.log(await projectId(option("--cwd") ?? process.cwd())); break;
    case "capture": {
      const event = await capture(vault, {
        projectId: option("--project") ?? await projectId(process.cwd()), sessionId: option("--session") ?? "manual",
        turnId: option("--turn") ?? `turn-${Date.now()}`, role: (option("--role") ?? "user") as "user" | "assistant" | "system",
        content: required("--content"), sourceAgent: option("--agent") ?? "manual", savepointStatus: flag("--partial") ? "partial" : "complete",
        explicit: flag("--explicit"), sensitivity: flag("--secret") ? "secret" : flag("--sensitive") ? "sensitive" : "normal"
      });
      output(event ?? { skipped: "paused" }); break;
    }
    case "process": output(await processQueue(vault, option("--project"))); break;
    case "search": output(await search(vault, { projectId: option("--project") ?? await projectId(process.cwd()), query: option("--query") ?? args.join(" "), includeRaw: flag("--include-raw") })); break;
    case "decision-add": output(await appendDecision(vault, {
      projectId: required("--project"), topic: required("--topic"), kind: (option("--kind") ?? "decision") as DecisionKind,
      status: (option("--status") ?? "current") as DecisionStatus, statement: required("--statement"), rationale: option("--rationale"),
      source: (option("--source") ?? "agent_inferred") as DecisionSource, confidence: numberOption("--confidence", 0.8),
      evidenceRefs: required("--evidence").split(",").filter(Boolean), supersedes: option("--supersedes")?.split(",").filter(Boolean)
    })); break;
    case "decision-get": output(await getDecisionTrail(vault, required("--project"), required("--topic")) ?? { found: false }); break;
    case "decision-list": output(await listDecisionViews(vault, required("--project"))); break;
    case "forget": output(await forget(vault, required("--project"), required("--memory"))); break;
    case "inspect": output(await inspect(vault, required("--project"), required("--memory"))); break;
    case "pause": output(await setPaused(vault, true)); break;
    case "resume": output(await setPaused(vault, false)); break;
    case "status": output(await vaultStats(vault)); break;
    case "doctor": output(await doctor(vault)); break;
    default:
      console.log("continuity <install|uninstall|capabilities|init|project-id|capture|process|search|decision-add|decision-get|decision-list|forget|inspect|pause|resume|status|doctor> [options]");
      if (command) process.exitCode = 2;
  }
}

function output(value: unknown): void { console.log(JSON.stringify(value, null, 2)); }
function throwError(message: string): never { throw new Error(message); }
main().catch(error => { console.error(`continuity: ${(error as Error).message}`); process.exitCode = 1; });
