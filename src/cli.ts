#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { capture } from "./capture.js";
import { forget, inspect } from "./control.js";
import { doctor } from "./doctor.js";
import { processQueue } from "./processing.js";
import { search } from "./search.js";
import { initVault, projectId, setPaused, vaultStats } from "./vault.js";

const args = process.argv.slice(2);
const command = args.shift();
const vault = option("--vault") ?? process.env.CONTINUITY_VAULT ?? path.join(os.homedir(), ".continuity", "vault");

function option(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  args.splice(index, 2);
  return value;
}

function flag(name: string): boolean {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

async function main(): Promise<void> {
  switch (command) {
    case "init":
      console.log(JSON.stringify(await initVault(vault), null, 2)); break;
    case "project-id":
      console.log(await projectId(option("--cwd") ?? process.cwd())); break;
    case "capture": {
      const project = option("--project") ?? await projectId(process.cwd());
      const content = option("--content") ?? throwError("--content is required");
      const event = await capture(vault, {
        projectId: project,
        sessionId: option("--session") ?? "manual",
        turnId: option("--turn") ?? `turn-${Date.now()}`,
        role: (option("--role") ?? "user") as "user" | "assistant" | "system",
        content,
        sourceAgent: option("--agent") ?? "manual",
        savepointStatus: flag("--partial") ? "partial" : "complete",
        explicit: flag("--explicit"),
        sensitivity: flag("--secret") ? "secret" : flag("--sensitive") ? "sensitive" : "normal"
      });
      console.log(JSON.stringify(event ?? { skipped: "paused" }, null, 2)); break;
    }
    case "process":
      console.log(JSON.stringify(await processQueue(vault, option("--project")), null, 2)); break;
    case "search": {
      const project = option("--project") ?? await projectId(process.cwd());
      const query = option("--query") ?? args.join(" ");
      console.log(JSON.stringify(await search(vault, { projectId: project, query, includeRaw: flag("--include-raw") }), null, 2)); break;
    }
    case "forget":
      console.log(JSON.stringify(await forget(vault, option("--project") ?? throwError("--project is required"), option("--memory") ?? throwError("--memory is required")), null, 2)); break;
    case "inspect":
      console.log(JSON.stringify(await inspect(vault, option("--project") ?? throwError("--project is required"), option("--memory") ?? throwError("--memory is required")), null, 2)); break;
    case "pause": console.log(JSON.stringify(await setPaused(vault, true), null, 2)); break;
    case "resume": console.log(JSON.stringify(await setPaused(vault, false), null, 2)); break;
    case "status": console.log(JSON.stringify(await vaultStats(vault), null, 2)); break;
    case "doctor": console.log(JSON.stringify(await doctor(vault), null, 2)); break;
    default:
      console.log("continuity <init|project-id|capture|process|search|forget|inspect|pause|resume|status|doctor> [options]");
      if (command) process.exitCode = 2;
  }
}

function throwError(message: string): never { throw new Error(message); }
main().catch(error => { console.error(`continuity: ${(error as Error).message}`); process.exitCode = 1; });
