import { rm } from "node:fs/promises";
import path from "node:path";
import { capture } from "./capture.js";
import type { EvalDataset } from "./eval-generator.js";
import { atomicJson, readJson } from "./io.js";
import { processQueue } from "./processing.js";
import { recall } from "./recall.js";
import { scoreSuite, type EvalPrediction } from "./eval-scorer.js";
import type { RawEvent } from "./types.js";

export async function runEvalDataset(root: string, dataset: EvalDataset): Promise<{ predictions: EvalPrediction[]; scores: ReturnType<typeof scoreSuite>; imported: number; skipped: number }> {
  const rawToFixture = new Map<string, string>();
  const fixtureToRaw = new Map<string, RawEvent>();
  let imported = 0;
  let skipped = 0;
  for (const item of dataset.events) {
    if (!item.save) { skipped += 1; continue; }
    const captured = await capture(root, { projectId: item.project_id, sessionId: item.session_id, turnId: item.turn_id, role: item.role, content: item.content, sourceAgent: "eval-fixture", savepointStatus: item.savepoint_status ?? (item.role === "user" ? "pending" : "complete"), sensitivity: item.expected_sensitivity, timestamp: item.timestamp });
    if (captured) { rawToFixture.set(captured.event_id, item.event_id); fixtureToRaw.set(item.event_id, captured); imported += 1; }
  }
  for (const project of [...new Set(dataset.events.map(event => event.project_id))]) await processQueue(root, project);
  for (const mutation of dataset.mutations ?? []) {
    const captured = fixtureToRaw.get(mutation.event_id);
    if (!captured) throw new Error(`Mutation references uncaptured event ${mutation.event_id}`);
    const rawPath = path.resolve(root, captured.raw_ref);
    const vaultRoot = path.resolve(root);
    if (!rawPath.startsWith(`${vaultRoot}${path.sep}`)) throw new Error(`Mutation escaped evaluation Vault: ${mutation.event_id}`);
    if (mutation.type === "delete_raw") await rm(rawPath);
    else {
      const raw = await readJson<RawEvent>(rawPath);
      await atomicJson(rawPath, { ...raw, content: mutation.replacement_content ?? `${raw.content} [tampered]` });
    }
  }
  const predictions: EvalPrediction[] = [];
  for (const oracle of dataset.oracle) {
    const result = await recall(root, { projectId: oracle.project_id, query: oracle.query, maxCharacters: 4000 });
    predictions.push({
      query_id: oracle.query_id,
      classification: result.classification,
      evidence_ids: [...new Set(result.hits.flatMap(hit => hit.raw_ref).map(id => rawToFixture.get(id)).filter((id): id is string => Boolean(id)))],
      claims: result.hits.map(hit => hit.snippet),
      warning_flags: [...new Set(result.hits.flatMap(hit => hit.warning_flags))],
      current_state: result.current_state
    });
  }
  return { predictions, scores: scoreSuite(dataset.oracle, predictions), imported, skipped };
}
