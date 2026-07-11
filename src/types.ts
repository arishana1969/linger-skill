export type Role = "user" | "assistant" | "system";
export type SavepointStatus = "pending" | "complete" | "partial";
export type MemorySource = "user_explicit" | "agent_inferred";

export interface RawEvent {
  schema_version: 1;
  event_id: string;
  session_id: string;
  project_id: string;
  seq_id: number;
  turn_id: string;
  role: Role;
  timestamp: string;
  source_agent: string;
  source_model?: string;
  content: string;
  content_hash: string;
  savepoint_status: SavepointStatus;
  capture_status: "captured";
  sensitivity: "normal" | "sensitive" | "secret";
  raw_ref: string;
}

export interface QueueItem {
  schema_version: 1;
  task_id: string;
  event_id: string;
  project_id: string;
  priority: "normal" | "explicit";
  status: "pending" | "processing" | "failed" | "done";
  attempts: number;
  created_at: string;
  updated_at: string;
  error?: string;
}

export interface ProcessedMemory {
  schema_version: 1;
  id: string;
  type: "conversation" | "idea" | "preference" | "proposal" | "rationale" | "constraint" | "rejection" | "decision" | "current_state" | "todo" | "correction";
  scope: "project" | "global";
  project_id: string;
  title: string;
  summary: string;
  tags: string[];
  predictive_tags: string[];
  retrieval_phrases: string[];
  source_events: string[];
  confidence: number;
  source: MemorySource;
  status: "active" | "revoked" | "superseded";
  sensitivity: "normal" | "sensitive";
  supersedes: string[];
  superseded_by: string[];
  created_at: string;
  updated_at: string;
  agent: string;
  model?: string;
}

export interface SearchHit {
  match_type: "exact_record" | "similar_record" | "possible_match" | "unprocessed_raw";
  confidence: number;
  score: number;
  source: string;
  snippet: string;
  raw_ref: string[];
  warning_flags: string[];
  sensitivity_flags: string[];
}
