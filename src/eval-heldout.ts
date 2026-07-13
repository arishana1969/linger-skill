import type { EvalDataset, EvalEvent, EvalOracle } from "./eval-generator.js";

export function generateHeldoutDataset(year = 2025, noiseEvents = 240): EvalDataset {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) throw new Error("year must be an integer between 2000 and 9999");
  if (!Number.isInteger(noiseEvents) || noiseEvents < 0) throw new Error("noiseEvents must be a non-negative integer");
  const at = (month: number, day: number) => new Date(Date.UTC(year, month, day, 9)).toISOString();
  const events: EvalEvent[] = [
    event("ho_storage_old", "p_main", at(0, 3), "user", "Artifact storage decision: use SQLite blobs because deployment simplicity matters."),
    event("ho_db_current", "p_main", at(1, 4), "user", "Current primary database decision: PostgreSQL because relational constraints matter."),
    event("ho_cache_current", "p_main", at(2, 5), "user", "Current database cache decision: Redis because latency matters."),
    event("ho_adapter_a", "p_main", at(3, 6), "user", "Current adapter decision: use webhooks because delivery is immediate."),
    event("ho_adapter_b", "p_main", at(5, 7), "user", "Current adapter decision: use polling because firewall compatibility matters."),
    event("ho_partial", "p_main", at(6, 8), "assistant", "Zephyr checkpoint analysis stopped midway after identifying queue starvation.", "partial"),
    event("ho_storage_current", "p_main", at(8, 9), "user", "Current artifact storage decision: use flat files because inspectability matters more."),
    event("ho_adapter_a2", "p_main", at(10, 10), "user", "Correction: current adapter decision is webhooks because delivery immediacy matters more than polling compatibility."),
    event("ho_other_db", "p_other", at(11, 11), "user", "Current primary database decision: SQLite because the other project is embedded."),
    event("ho_other_zephyr", "p_other", at(11, 12), "assistant", "Zephyr checkpoint completed successfully in another project."),
    event("ho_tampered", "p_main", at(7, 13), "user", "Nebula archive note: sharded tar files passed the benchmark."),
    event("ho_deleted_raw", "p_main", at(9, 14), "user", "Orchid retention note: preserve processed summaries after raw deletion.")
  ];
  for (let index = 0; index < noiseEvents; index += 1) {
    const month = index % 12;
    const day = 1 + (Math.floor(index / 12) % 27);
    events.push(event(`ho_noise_${String(index + 1).padStart(4, "0")}`, "p_main", at(month, day), index % 3 === 0 ? "assistant" : "user", `Routine module-${index + 1} discussion about linting, colors, tests, and build output ${index + 1}.`));
  }
  const queryAt = `${year}-12-31T00:00:00.000Z`;
  const oracle: EvalOracle[] = [
    query("ho_q_storage", queryAt, "What is the current artifact storage choice?", ["ho_storage_current"], ["ho_storage_old"], "Current artifact storage decision: use flat files because inspectability matters more.", ["flat files", "inspectability"], ["SQLite blobs"], "similar_record_found"),
    query("ho_q_database", queryAt, "What is the current primary database?", ["ho_db_current"], ["ho_cache_current", "ho_other_db"], "Current primary database decision: PostgreSQL because relational constraints matter.", ["PostgreSQL", "relational constraints"], ["Redis", "SQLite"], "exact_record_found"),
    query("ho_q_cache", queryAt, "What is the current database cache?", ["ho_cache_current"], ["ho_db_current", "ho_other_db"], "Current database cache decision: Redis because latency matters.", ["Redis", "latency"], ["PostgreSQL", "SQLite"], "exact_record_found"),
    query("ho_q_correction", queryAt, "What is the current adapter decision?", ["ho_adapter_a2"], ["ho_adapter_a", "ho_adapter_b"], "Correction: current adapter decision is webhooks because delivery immediacy matters more than polling compatibility.", ["webhooks", "delivery immediacy"], ["polling because"], "exact_record_found"),
    { ...query("ho_q_partial", queryAt, "What did the Zephyr checkpoint identify?", ["ho_partial"], ["ho_other_zephyr"], undefined, ["queue starvation"], ["completed successfully"], "similar_record_found"), required_warning_flags: ["partial_source"], forbidden_warning_flags: ["unverified_source"] },
    { ...query("ho_q_tampered", queryAt, "What did the Nebula archive benchmark show?", [], ["ho_tampered"], undefined, ["no reliable memory"], ["sharded tar"], "no_reliable_memory_found"), forbidden_warning_flags: ["unverified_source"] },
    { ...query("ho_q_deleted", queryAt, "What does the Orchid retention note say?", ["ho_deleted_raw"], [], undefined, ["preserve processed summaries", "raw deletion"], [], "similar_record_found"), required_warning_flags: ["unverified_source"], forbidden_warning_flags: ["partial_source"] },
    query("ho_q_absent", queryAt, "Did we choose DynamoDB for primary storage?", [], [], undefined, ["no reliable memory"], ["DynamoDB was chosen"], "no_reliable_memory_found")
  ];
  return {
    schema_version: 1,
    name: `linger-heldout-${year}`,
    start: `${year}-01-01T00:00:00.000Z`,
    end: `${year}-12-31T23:59:59.999Z`,
    events,
    oracle,
    mutations: [
      { type: "tamper_raw_content", event_id: "ho_tampered", replacement_content: "Nebula archive note: maliciously altered result." },
      { type: "delete_raw", event_id: "ho_deleted_raw" }
    ]
  };
}

function event(id: string, project: string, timestamp: string, role: "user" | "assistant", content: string, savepoint?: EvalEvent["savepoint_status"]): EvalEvent {
  return { event_id: id, project_id: project, session_id: `s_${id}`, turn_id: `t_${id}`, role, timestamp, content, expected_sensitivity: "normal", save: true, ...(savepoint ? { savepoint_status: savepoint } : {}) };
}

function query(id: string, at: string, text: string, required: string[], forbidden: string[], state: string | undefined, acceptable: string[], unacceptable: string[], classification: string): EvalOracle {
  return { query_id: id, at, project_id: "p_main", query: text, required_evidence: required, forbidden_evidence: forbidden, expected_current_state: state, acceptable_claims: acceptable, unacceptable_claims: unacceptable, expected_classification: classification };
}
