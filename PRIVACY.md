# Privacy

Linger stores visible agent conversations and derived project memory in local files under `~/.linger/vault` by default.

## Data stored locally

The Vault can contain visible user and assistant messages, project display names and absolute root paths, processed summaries, tags, decision trails, queue state, and integrity metadata. Remote repository URLs may influence a hashed project ID but are not stored in the project registry.

Recall-quality sampling is off by default. When explicitly enabled for a query, the query, returned evidence references, and later feedback remain local in the Vault.

Linger installs no telemetry, analytics, cloud sync, embeddings, or background daemon.

## Data sent to the active model provider

Local-first does not mean data never leaves the device. Recalled evidence and bounded host-enrichment batches enter the current Claude Code or Codex context and may be sent to the model provider configured in that host.

Linger does not select another provider, request a separate API key, or send evidence to an additional Linger service. If host enrichment does not run, deterministic local processing and recall continue normally.

## Sensitive content

High-confidence credential patterns are redacted before raw persistence, marked secret, and excluded from normal processing, enrichment, and recall. Contact-like sensitive records are also excluded from ordinary recall by default.

Detection is not complete. Unknown secret formats may be missed, and unrecognized content explicitly marked secret may remain in raw storage. Do not use this experimental build for data that requires audited compliance controls.

## Host memory and removal

Linger operates as a sidecar and does not disable, replace, rewrite, or delete memory owned by Claude Code, Codex, or future host adapters. A host may independently store some of the same visible content in its own location and under its own privacy boundary. Linger recall sends only a bounded relevant evidence package into the active host context; duplicated host and Linger context should be treated as one underlying event, not independent corroboration.

Uninstall removes Linger-managed host integration but preserves the Vault. A full `purge` is separate and requires both `--yes` and the exact `PURGE` confirmation phrase.

See [SECURITY.md](SECURITY.md) for the security boundary and private vulnerability-reporting channel.
