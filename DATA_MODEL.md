# Data model

## Raw event

Each event is an independent JSON file containing schema version, event/session/project/turn IDs, sequence number, role, timestamp, visible content, content hash, savepoint status, capture status, sensitivity, and raw reference.

Raw files contain mechanical capture data only. Topic boundaries and semantic summaries belong to processed records.

## Queue item

Queue items are independent JSON files with pending, processing, failed, or done state. Explicit user memories receive priority. One process lock serializes the local worker.

## Processed memory

Processed memories contain summaries, content and predictive tags, retrieval phrases, evidence event IDs, confidence, source type, recall status, and supersession references.

## Decision trail

Decision events are append-only. A topic's `current.json` is derived from its event stream and may be rebuilt. User-explicit evidence outranks inferred evidence, and low-confidence inference cannot set current state.

## Source-of-truth boundary

Raw events, processed memories, and decision events are durable memory records. Current decision views, registries, and future indexes are derived or operational files.
