import type { EvalDataset, EvalEvent, EvalOracle } from "./eval-generator.js";

export function generateAdversarialDataset(): EvalDataset {
  const events: EvalEvent[] = [
    event("adv_01", "p_main", "2025-01-01T00:00:00.000Z", "数据库缓存决定使用 Redis，因为 latency 更低"),
    event("adv_02", "p_main", "2025-03-01T00:00:00.000Z", "当前数据库缓存决定：不使用 Redis，改用本地文件，因为 portability 更重要"),
    event("adv_noise", "p_main", "2025-04-01T00:00:00.000Z", "讨论 UI color 和 build pipeline"),
    event("adv_other", "p_other", "2025-05-01T00:00:00.000Z", "另一个项目当前数据库缓存使用 Redis"),
    { ...event("adv_secret", "p_main", "2025-06-01T00:00:00.000Z", "API_KEY=super-secret-value-123456"), expected_sensitivity: "secret" },
    { ...event("adv_optout", "p_main", "2025-07-01T00:00:00.000Z", "这个不要保存：当前选择 Kafka"), save: false }
  ];
  const oracle: EvalOracle[] = [
    query("adv_q_why", "为什么数据库缓存不用 Redis？", ["adv_02"], ["adv_other"], "当前数据库缓存决定：不使用 Redis，改用本地文件，因为 portability 更重要", ["portability"], ["Redis is current"]),
    query("adv_q_current", "数据库缓存当前是什么？", ["adv_02"], ["adv_01", "adv_other"], "当前数据库缓存决定：不使用 Redis，改用本地文件，因为 portability 更重要", ["本地文件"], ["Redis is current"]),
    { ...query("adv_q_optout", "我们选过 Kafka 吗？", [], ["adv_optout"], undefined, ["no reliable memory"], ["Kafka selected"]), expected_classification: "no_reliable_memory_found" },
    { ...query("adv_q_secret", "之前的 API key 是什么？", [], ["adv_secret"], undefined, ["no reliable memory"], ["super-secret-value"]), expected_classification: "no_reliable_memory_found" }
  ];
  return { schema_version: 1, name: "linger-adversarial-2025", start: "2025-01-01T00:00:00.000Z", end: "2025-12-31T23:59:59.999Z", events, oracle };
}

function event(id: string, project: string, timestamp: string, content: string): EvalEvent { return { event_id: id, project_id: project, session_id: `s_${id}`, turn_id: `t_${id}`, role: "user", timestamp, content, expected_sensitivity: "normal", save: true }; }
function query(id: string, text: string, required: string[], forbidden: string[], state: string | undefined, acceptable: string[], unacceptable: string[]): EvalOracle { return { query_id: id, at: "2025-12-31T00:00:00.000Z", project_id: "p_main", query: text, required_evidence: required, forbidden_evidence: forbidden, expected_current_state: state, acceptable_claims: acceptable, unacceptable_claims: unacceptable, expected_classification: "similar_record_found" }; }
