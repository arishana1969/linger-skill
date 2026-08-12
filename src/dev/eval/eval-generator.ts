export interface EvalEvent {
  event_id: string;
  project_id: string;
  session_id: string;
  turn_id: string;
  role: "user" | "assistant";
  timestamp: string;
  content: string;
  expected_sensitivity: "normal" | "sensitive" | "secret";
  save: boolean;
  savepoint_status?: "pending" | "complete" | "partial";
}

export interface EvalOracle {
  query_id: string;
  at: string;
  project_id: string;
  query: string;
  required_evidence: string[];
  forbidden_evidence: string[];
  expected_current_state?: string;
  acceptable_claims: string[];
  unacceptable_claims: string[];
  expected_classification: string;
  required_warning_flags?: string[];
  forbidden_warning_flags?: string[];
}

export interface EvalMutation {
  type: "tamper_raw_content" | "delete_raw";
  event_id: string;
  replacement_content?: string;
}

export interface EvalDataset {
  schema_version: 1;
  name: string;
  start: string;
  end: string;
  events: EvalEvent[];
  oracle: EvalOracle[];
  mutations?: EvalMutation[];
}

export function generateYearDataset(year = 2025): EvalDataset {
  const events: EvalEvent[] = [];
  for (let month = 0; month < 12; month += 1) {
    for (let session = 0; session < 4; session += 1) {
      const id = `evt_${String(month + 1).padStart(2, "0")}_${session + 1}`;
      const timestamp = new Date(Date.UTC(year, month, 2 + session * 7, 9)).toISOString();
      events.push(event(id, "p_linger", timestamp, "user", session === 0 ? milestone(month) : `Month ${month + 1} unrelated implementation discussion ${session}.`));
      events.push(event(`${id}_a`, "p_linger", new Date(Date.parse(timestamp) + 60_000).toISOString(), "assistant", `Visible assistant response for ${id}.`));
    }
  }
  events.push({ ...event("evt_secret", "p_linger", new Date(Date.UTC(year, 5, 15)).toISOString(), "user", "API_KEY=abcdefghijklmnopqrstuvwxyz"), expected_sensitivity: "secret" });
  events.push({ ...event("evt_optout", "p_linger", new Date(Date.UTC(year, 6, 15)).toISOString(), "user", "这个不要保存：临时选择 MongoDB"), save: false });
  events.push(event("evt_other_pg", "p_other", new Date(Date.UTC(year, 8, 1)).toISOString(), "user", "另一个项目已经上线 PostgreSQL"));
  return {
    schema_version: 1,
    name: `linger-year-${year}`,
    start: `${year}-01-01T00:00:00.000Z`,
    end: `${year}-12-31T23:59:59.999Z`,
    events,
    oracle: [
      oracle("q_rationale", year, "之前为什么没有迁移 PostgreSQL？", ["evt_02_1", "evt_09_1"], ["evt_other_pg"], ["deployment complexity", "operations cost"], ["PostgreSQL is live"]),
      oracle("q_current", year, "数据库最后定了什么？", ["evt_12_1"], ["evt_other_pg", "evt_optout"], ["SQLite", "migration deferred"], ["MongoDB selected"]),
      { ...oracle("q_absent", year, "我们讨论过 Cassandra 吗？", [], [], ["no reliable memory"], ["Cassandra was rejected"]), expected_classification: "no_reliable_memory_found", expected_current_state: undefined }
    ]
  };
}

function event(id: string, project: string, timestamp: string, role: "user" | "assistant", content: string): EvalEvent {
  return { event_id: id, project_id: project, session_id: `s_${id}`, turn_id: `t_${id.replace(/_a$/, "")}`, role, timestamp, content, expected_sensitivity: "normal", save: true };
}

function oracle(id: string, year: number, query: string, required: string[], forbidden: string[], acceptable: string[], unacceptable: string[]): EvalOracle {
  return { query_id: id, at: `${year}-12-31T00:00:00.000Z`, project_id: "p_linger", query, required_evidence: required, forbidden_evidence: forbidden, expected_current_state: "当前数据库决定：SQLite，PostgreSQL migration deferred", acceptable_claims: acceptable, unacceptable_claims: unacceptable, expected_classification: "similar_record_found" };
}

function milestone(month: number): string {
  return ["提出使用 PostgreSQL", "拒绝立即迁移 PostgreSQL，因 deployment complexity 决定先用 SQLite", "SQLite prototype works", "讨论 file-native vault", "重新评估 PostgreSQL migration", "记录 API safety constraints", "提案迁移 PostgreSQL", "评估 migration workload", "因 operations cost 暂缓 PostgreSQL", "继续使用 SQLite", "保留 PostgreSQL migration plan", "当前数据库决定：SQLite，PostgreSQL migration deferred"][month]!;
}
