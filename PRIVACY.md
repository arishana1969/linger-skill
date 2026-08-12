# Privacy

Linger stores visible agent conversations and derived project memory in local files under `~/.linger/vault` by default.
It installs no telemetry, analytics, cloud sync, or background daemon.

## Local data

The Vault can contain visible user and assistant messages, project display names and absolute roots, processed summaries,
tags, decision trails, queue/config/health state, integrity metadata, recall samples explicitly opted into by the user, and
optional Local embedding vectors.

Raw evidence and decision events are source records. Enrichment overlays, registries, and indexes are derived. Disabling
Local Embedding preserves its index; deleting an index does not delete source memory. Uninstall preserves the Vault. Full
`purge` is separate and requires `--yes` plus the exact `PURGE` phrase.

## Host-model data path

Local-first does not mean that all host activity stays on the device. Recalled evidence and an optional bounded enrichment
batch enter the current Claude Code or Codex context and may be sent to the provider configured in that host.

Linger does not select another provider, request a separate API key, or send evidence to a Linger service. Enrichment uses
only normal-sensitivity, hash-verified records and continues to be optional; deterministic processing works without it.

## Local Embedding data path

v1.0.0 has no API or Remote Embedding backend. It never reads an embedding provider key.

When Local Embedding is explicitly enabled, eligible normal-sensitivity memory text is sent only to a short-lived local
worker on the same machine. Vectors and index metadata remain in the Vault. Secret or sensitive queries do not enter the
worker, and no query/vector telemetry is emitted.

The separately confirmed installer downloads fixed runtime/model artifacts from allowlisted npm and Hugging Face sources.
Those requests contain no project content, query text, credential, Authorization header, or Linger identifier beyond
ordinary HTTP metadata. Model/runtime artifacts are not bundled in the npm package.

## Sensitive content

High-confidence credential patterns are redacted before raw persistence, marked secret, and excluded from normal
processing, host enrichment, Local Embedding, and recall. Contact-like sensitive records are excluded from ordinary recall
and Local Embedding by default.

Detection is not complete. Unknown formats may be missed, and unrecognized content explicitly marked secret may remain in
raw storage. Linger is not encryption or an audited DLP system. Protect the Vault like any local transcript archive.

## Host-owned memory

Linger is a sidecar. It does not disable, replace, rewrite, or delete memory owned by Claude Code, Codex, or future host
adapters. A host may independently retain the same visible content under its own privacy boundary. Duplicate host and
Linger context represents one underlying event, not independent corroboration; conflicts must remain visible.

See [SECURITY.md](SECURITY.md) for the security boundary and private vulnerability-reporting channel.
