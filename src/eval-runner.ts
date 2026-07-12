import { capture } from "./capture.js";
import type { EvalDataset } from "./eval-generator.js";
import { processQueue } from "./processing.js";
import { recall } from "./recall.js";
import { scoreSuite, type EvalPrediction } from "./eval-scorer.js";

export async function runEvalDataset(root: string, dataset: EvalDataset): Promise<{ predictions: EvalPrediction[]; scores: ReturnType<typeof scoreSuite>; imported: number; skipped: number }> {
  const rawToFixture = new Map<string, string>();
  let imported = 0;
  let skipped = 0;
  for (const item of dataset.events) {
    if (!item.save) { skipped += 1; continue; }
    const captured = await capture(root, { projectId: item.project_id, sessionId: item.session_id, turnId: item.turn_id, role: item.role, content: item.content, sourceAgent: "eval-fixture", savepointStatus: item.savepoint_status ?? (item.role === "user" ? "pending" : "complete"), sensitivity: item.expected_sensitivity, timestamp: item.timestamp });
    if (captured) { rawToFixture.set(captured.event_id, item.event_id); imported += 1; }
  }
  for (const project of [...new Set(dataset.events.map(event => event.project_id))]) await processQueue(root, project);
  const predictions: EvalPrediction[] = [];
  for (const oracle of dataset.oracle) {
    const result = await recall(root, { projectId: oracle.project_id, query: oracle.query, maxCharacters: 4000 });
    predictions.push({
      query_id: oracle.query_id,
      classification: result.classification,
      evidence_ids: [...new Set(result.hits.flatMap(hit => hit.raw_ref).map(id => rawToFixture.get(id)).filter((id): id is string => Boolean(id)))],
      claims: result.hits.map(hit => hit.snippet),
      current_state: result.current_state
    });
  }
  return { predictions, scores: scoreSuite(dataset.oracle, predictions), imported, skipped };
}
