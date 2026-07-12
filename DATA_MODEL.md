# Data model

## Raw event

Each event is an independent JSON file containing schema version, event/session/project/turn IDs, sequence number, role, timestamp, visible content, content hash, savepoint status, capture status, sensitivity, and raw reference.

Raw files contain mechanical capture data only. Topic boundaries and semantic summaries belong to processed records.

Deduplication never weakens raw immutability. Before returning an already-present event, capture revalidates its schema, canonical path, identity fields, declared content hash, and computed content hash. A malformed or tampered existing file causes an integrity failure and is neither returned nor overwritten.

## Queue item

Queue items are independent JSON files with pending, processing, failed, or done state. Explicit user memories receive priority. One process lock serializes the local worker.

Per-project sequence counters and processing-run histories are operational JSON records. New writes carry `schema_version: 1`; legacy records without that field remain readable when their value/runs shape is valid. Invalid counters are never silently reset, and invalid run history never silently bypasses scheduler accounting. `doctor` reports either condition and confirmed repair quarantines the bad file.

## Project registry

Project records map a stable project ID to a local display name, root path, identity source, and last-seen time. Git projects use remote plus Git root when a remote exists, Git root otherwise; non-Git directories use their absolute path. Remote URLs are hashed into the ID but are not persisted. Listing known projects never broadens recall automatically.

## Processed memory

Each processed memory has a machine-readable JSON record and a human-readable Markdown/frontmatter representation with the same identity and provenance. Records contain summaries, content and predictive tags, retrieval phrases, evidence event IDs and source hash, source savepoint status, confidence, source type, recall status, and supersession references. Delete keeps both representations synchronized. Recall labels evidence derived from interrupted answers with `partial_source` rather than presenting it as complete.

## Decision trail

Decision events are append-only and retain typed visible evolution: idea, preference, proposal, rationale, constraint, rejection, decision, current_state, todo, and correction. A topic's `current.json` is derived from its event stream and may be rebuilt. User-explicit evidence outranks inferred evidence, and low-confidence inference cannot set current state.

## Source-of-truth boundary

Raw events, processed memories, and decision events are durable memory records. Current decision views, tag/term registries, processing histories, queue state, and future indexes are derived or operational files.

Forget, correction, and processed deletion rebuild the affected project's tag registry after the append-only control event or confirmed deletion succeeds. Candidate fallback therefore does not continue advertising revoked records.

Opening a schema-v1 Vault backfills missing config defaults while preserving existing values, creation time, and unknown forward-compatible fields. Known config fields are runtime-validated; invalid types/bounds and unsupported schema versions fail explicitly rather than being silently rewritten. `doctor-repair --yes` may quarantine an invalid config, after which initialization creates a fresh default config.

## Search contract

Search is project-scoped by default and reads only active, non-revoked records. Options bound scanned files, snippets, total evidence characters, raw fragment characters, an inclusive time range, and a wall-clock deadline. Timeout is an explicit retrieval failure, not a `no_reliable_memory_found` result.
