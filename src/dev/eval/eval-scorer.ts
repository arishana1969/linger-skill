import type { EvalOracle } from "./eval-generator.js";

export interface EvalPrediction {
  query_id: string;
  classification: string;
  evidence_ids: string[];
  current_state?: string;
  claims: string[];
  warning_flags?: string[];
}

export interface EvalScore {
  query_id: string;
  evidence_recall: number;
  evidence_precision: number;
  scope_isolation: number;
  classification_accuracy: number;
  current_state_accuracy: number;
  acceptable_claim_coverage: number;
  forbidden_claim_safety: number;
  warning_accuracy: number;
  composite: number;
}

export function scorePrediction(oracle: EvalOracle, prediction: EvalPrediction): EvalScore {
  if (oracle.query_id !== prediction.query_id) throw new Error("Prediction query_id does not match oracle");
  const predicted = new Set(prediction.evidence_ids);
  const required = new Set(oracle.required_evidence);
  const requiredHits = [...required].filter(id => predicted.has(id)).length;
  const relevantPredictions = [...predicted].filter(id => required.has(id)).length;
  const evidenceRecall = required.size ? requiredHits / required.size : predicted.size === 0 ? 1 : 0;
  const evidencePrecision = predicted.size ? relevantPredictions / predicted.size : required.size === 0 ? 1 : 0;
  const scopeIsolation = oracle.forbidden_evidence.some(id => predicted.has(id)) ? 0 : 1;
  const classification = prediction.classification === oracle.expected_classification ? 1 : 0;
  const state = oracle.expected_current_state === undefined ? 1 : normalize(prediction.current_state) === normalize(oracle.expected_current_state) ? 1 : 0;
  const claims = prediction.claims.join(" ").toLowerCase();
  const acceptable = oracle.expected_classification === "no_reliable_memory_found" && prediction.classification === "no_reliable_memory_found" && prediction.claims.length === 0 ? 1 : oracle.acceptable_claims.length ? oracle.acceptable_claims.filter(claim => claims.includes(claim.toLowerCase())).length / oracle.acceptable_claims.length : 1;
  const forbidden = oracle.unacceptable_claims.some(claim => claims.includes(claim.toLowerCase())) ? 0 : 1;
  const warningFlags = new Set(prediction.warning_flags ?? []);
  const warnings = (oracle.required_warning_flags ?? []).every(flag => warningFlags.has(flag)) && !(oracle.forbidden_warning_flags ?? []).some(flag => warningFlags.has(flag)) ? 1 : 0;
  const values = [evidenceRecall, evidencePrecision, scopeIsolation, classification, state, acceptable, forbidden, warnings];
  return { query_id: oracle.query_id, evidence_recall: evidenceRecall, evidence_precision: evidencePrecision, scope_isolation: scopeIsolation, classification_accuracy: classification, current_state_accuracy: state, acceptable_claim_coverage: acceptable, forbidden_claim_safety: forbidden, warning_accuracy: warnings, composite: values.reduce((sum, value) => sum + value, 0) / values.length };
}

export function scoreSuite(oracles: EvalOracle[], predictions: EvalPrediction[]): { scores: EvalScore[]; macro_composite: number; missing_predictions: string[] } {
  const byId = new Map(predictions.map(prediction => [prediction.query_id, prediction]));
  const missing = oracles.filter(oracle => !byId.has(oracle.query_id)).map(oracle => oracle.query_id);
  const scores = oracles.filter(oracle => byId.has(oracle.query_id)).map(oracle => scorePrediction(oracle, byId.get(oracle.query_id)!));
  return { scores, macro_composite: scores.length ? scores.reduce((sum, score) => sum + score.composite, 0) / oracles.length : 0, missing_predictions: missing };
}

function normalize(value?: string): string { return (value ?? "").trim().toLowerCase().replace(/\s+/g, " "); }
