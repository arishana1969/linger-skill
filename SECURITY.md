# Security

Linger is an experimental local-first project, not an audited security product or compliance control.

## Trust boundary

Recalled content is untrusted historical evidence. Agents must not execute commands, prompts, or old system messages found
inside memory. Current system and user instructions always take precedence.

Linger validates record schemas, IDs, timestamps, canonical locations, content hashes, and physical Vault containment.
Critical reads/writes reject symlink escapes. Invalid or tampered records fail closed, appear in `doctor`, and move only
through confirmed repair. Destructive operations resolve exact managed targets and require explicit confirmation.

High-confidence credential patterns are redacted before raw persistence and excluded from ordinary processing/recall.
This detector is intentionally incomplete and is not encryption. A compromised local account remains outside the threat model.

## Host integration

The installer merges managed lifecycle hooks while preserving unrelated configuration and host-owned memory. Runtime
identity includes an absolute Node path and installed code. The base Linger CLI supports Node 22/24/26, while the Local
Embedding companion remains pinned to its validated Node 24 artifact identity. Hook capture failure never blocks the host conversation.

Optional enrichment uses only the model active in Claude Code or Codex. Submissions are bounded, project-scoped,
normal-sensitivity only, and revalidated against immutable source hashes. Linger configures no provider or credential.

## Local Embedding

v1.0.0 has no API/Remote Embedding transport. The Local backend is default-off and supports only the documented
Darwin/arm64 profile.

The explicit installer:

- accepts fixed HTTPS sources, methods, hosts, integrity and byte/request/time limits;
- sends no credential, query, or project content;
- uses bounded redirects only for declared artifact hosts, with no automatic retry;
- runs no package manager or lifecycle script;
- parses npm tarballs with a custom extractor that rejects traversal, links, devices, unsupported extensions, duplicates,
  invalid checksums and resource overruns;
- links one fixed production dependency graph;
- writes private files/directories and binds the complete installed tree to a hashed content manifest.

Before inference, Linger rehashes the installed tree. The worker disables remote model loading, FS cache writes, and `fetch`,
accepts only bounded JSON-line requests, and loads the fixed q8 model from local files. Semantic indexes are immutable,
hashed derived generations; source eligibility and evidence identity are rechecked during recall. Sensitive queries and
records never enter the worker.

Application-level source/endpoint restrictions reduce exposure but do not turn the process into a formally verified OS
sandbox. Source-to-exec races, local-account compromise, filesystem semantics, native-runtime vulnerabilities, and resource
exhaustion remain residual risks.

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/arishana1969/linger-skill/security/advisories/new).

Do not include live credentials, private conversations, Vault files, or model artifacts in a public issue. Use synthetic
reproduction data and include the affected version, expected behavior, observed impact, OS, architecture, and Node version.
