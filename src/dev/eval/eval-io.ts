import path from "node:path";
import { atomicJson, ensureDir } from "../../io.js";
import { generateYearDataset } from "./eval-generator.js";

export async function writeYearDataset(output: string, year = 2025): Promise<{ fixture: string; oracle: string; events: number; queries: number }> {
  const dataset = generateYearDataset(year);
  const root = path.resolve(output);
  const fixture = path.join(root, "fixtures", `${dataset.name}.json`);
  const oracle = path.join(root, "oracle", `${dataset.name}.oracle.json`);
  await ensureDir(path.dirname(fixture));
  await ensureDir(path.dirname(oracle));
  await atomicJson(fixture, { schema_version: dataset.schema_version, name: dataset.name, start: dataset.start, end: dataset.end, events: dataset.events, ...(dataset.mutations ? { mutations: dataset.mutations } : {}) });
  await atomicJson(oracle, { schema_version: dataset.schema_version, name: dataset.name, oracle: dataset.oracle });
  return { fixture, oracle, events: dataset.events.length, queries: dataset.oracle.length };
}
