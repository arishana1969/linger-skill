import assert from "node:assert/strict";
import test from "node:test";
import { generateYearDataset } from "./eval-generator.js";
import { scorePrediction, scoreSuite } from "./eval-scorer.js";

test("perfect evidence and claims score one", () => {
  const oracle = generateYearDataset().oracle[0]!;
  const score = scorePrediction(oracle, { query_id: oracle.query_id, classification: oracle.expected_classification, evidence_ids: oracle.required_evidence, current_state: oracle.expected_current_state, claims: oracle.acceptable_claims });
  assert.equal(score.composite, 1);
});

test("cross-project evidence and forbidden claim are penalized", () => {
  const oracle = generateYearDataset().oracle[0]!;
  const score = scorePrediction(oracle, { query_id: oracle.query_id, classification: oracle.expected_classification, evidence_ids: [...oracle.required_evidence, ...oracle.forbidden_evidence], current_state: oracle.expected_current_state, claims: [...oracle.acceptable_claims, ...oracle.unacceptable_claims] });
  assert.equal(score.scope_isolation, 0);
  assert.equal(score.forbidden_claim_safety, 0);
  assert.ok(score.evidence_precision < 1);
});

test("suite reports missing predictions", () => {
  const dataset = generateYearDataset();
  const result = scoreSuite(dataset.oracle, []);
  assert.equal(result.macro_composite, 0);
  assert.equal(result.missing_predictions.length, dataset.oracle.length);
});

test("scores required and forbidden provenance warnings", () => {
  const oracle = { ...generateYearDataset().oracle[0]!, required_warning_flags: ["partial_source"], forbidden_warning_flags: ["unverified_source"] };
  const base = { query_id: oracle.query_id, classification: oracle.expected_classification, evidence_ids: oracle.required_evidence, current_state: oracle.expected_current_state, claims: oracle.acceptable_claims };
  assert.equal(scorePrediction(oracle, { ...base, warning_flags: ["partial_source"] }).warning_accuracy, 1);
  assert.equal(scorePrediction(oracle, { ...base, warning_flags: ["partial_source", "unverified_source"] }).warning_accuracy, 0);
});
