#!/usr/bin/env node
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateAdversarialDataset } from "./eval-adversarial.js";
import { generateHeldoutDataset } from "./eval-heldout.js";
import type { EvalDataset, EvalEvent, EvalMutation, EvalOracle } from "./eval-generator.js";
import { writeYearDataset } from "./eval-io.js";
import { runEvalDataset } from "./eval-runner.js";
import { assertSupportedRuntime } from "../../runtime-support.js";

const args = process.argv.slice(2);
const command = args.shift();

function option(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  args.splice(index, 2);
  return value;
}

function required(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function readDataset(fixturePath: string, oraclePath: string): Promise<EvalDataset> {
  const fixture = JSON.parse(await readFile(path.resolve(fixturePath), "utf8")) as Partial<EvalDataset>;
  const oracle = JSON.parse(await readFile(path.resolve(oraclePath), "utf8")) as { oracle?: EvalOracle[] };
  if (fixture.schema_version !== 1 || !fixture.name || !fixture.start || !fixture.end || !Array.isArray(fixture.events)) throw new Error("invalid fixture dataset");
  if (!Array.isArray(oracle.oracle)) throw new Error("invalid oracle dataset");
  const mutations = (fixture as { mutations?: unknown }).mutations;
  if (mutations !== undefined && !Array.isArray(mutations)) throw new Error("invalid fixture mutations");
  if (mutations?.some(item => !isEvalMutation(item))) throw new Error("invalid fixture mutation");
  return { schema_version: 1, name: fixture.name, start: fixture.start, end: fixture.end, events: fixture.events as EvalEvent[], oracle: oracle.oracle, ...(mutations ? { mutations } : {}) };
}

function isEvalMutation(value: unknown): value is EvalMutation {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return ["tamper_raw_content", "delete_raw"].includes(String(item.type)) && typeof item.event_id === "string" && item.event_id.length > 0 && (item.replacement_content === undefined || typeof item.replacement_content === "string");
}

async function main(): Promise<void> {
  await assertSupportedRuntime();
  if (command === "generate") {
    const year = Number(option("--year") ?? "2025");
    if (!Number.isInteger(year) || year < 2000 || year > 9999) throw new Error("--year must be an integer between 2000 and 9999");
    console.log(JSON.stringify(await writeYearDataset(option("--output") ?? "eval-data", year), null, 2));
    return;
  }
  if (command === "run") {
    const dataset = await readDataset(required("--fixture"), required("--oracle"));
    const vault = option("--vault") ?? await mkdtemp(path.join(os.tmpdir(), "linger-eval-"));
    console.log(JSON.stringify({ dataset: dataset.name, vault, ...await runEvalDataset(vault, dataset) }, null, 2));
    return;
  }
  if (command === "adversarial") {
    const vault = option("--vault") ?? await mkdtemp(path.join(os.tmpdir(), "linger-eval-adversarial-"));
    const dataset = generateAdversarialDataset();
    console.log(JSON.stringify({ dataset: dataset.name, vault, ...await runEvalDataset(vault, dataset) }, null, 2));
    return;
  }
  if (command === "heldout") {
    const year = Number(option("--year") ?? "2025");
    const noise = Number(option("--noise") ?? "240");
    const vault = option("--vault") ?? await mkdtemp(path.join(os.tmpdir(), "linger-eval-heldout-"));
    const dataset = generateHeldoutDataset(year, noise);
    console.log(JSON.stringify({ dataset: dataset.name, vault, ...await runEvalDataset(vault, dataset) }, null, 2));
    return;
  }
  console.log("linger-eval <generate|run|adversarial|heldout> [options]");
  if (command) process.exitCode = 2;
}

main().catch(error => {
  console.error(`linger-eval: ${(error as Error).message}`);
  process.exitCode = 1;
});
