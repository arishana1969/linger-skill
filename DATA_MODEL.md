# Data model

## Raw event

Each event is an independent JSON file containing schema version, event/session/project/turn IDs, sequence number, role, timestamp, visible content, content hash, savepoint status, capture status, sensitivity, and raw reference.

Raw files contain mechanical capture data only. Topic boundaries and semantic summaries belong to processed records.

## Queue item

Queue items are independent JSON files with pending, processing, failed, or done state. Explicit user memories receive priority. One process lock serializes the local worker.

## Processed memory

Each processed memory has a machine-readable JSON record and a human-readable Markdown/frontmatter representation with the same identity and provenance. Records contain summaries, content and predictive tags, retrieval phrases, evidence event IDs and source hash, confidence, source type, recall status, and supersession references. Delete keeps both representations synchronized.

## Decision trail

Decision events are append-only. A topic's `current.json` is derived from its event stream and may be rebuilt. User-explicit evidence outranks inferred evidence, and low-confidence inference cannot set current state.

## Source-of-truth boundary

Raw events, processed memories, and decision events are durable memory records. Current decision views, tag/term registries, processing histories, queue state, and future indexes are derived or operational files.

## Search contract

Search is project-scoped by default and reads only active, non-revoked records. Options bound scanned files, snippets, total evidence characters, raw fragment characters, an inclusive time range, and a wall-clock deadline. Timeout is an explicit retrieval failure, not a `no_reliable_memory_found` result.
