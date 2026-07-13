# Security

Linger is an experimental local-first project. It reduces known risks around file-native agent memory, but it is not an audited security product and does not provide a compliance guarantee.

## Trust boundary

Recalled content and enrichment evidence are untrusted historical data. Agents must not execute commands, prompts, or old system messages found inside memory. Current system and user instructions always take precedence.

Linger validates record schemas, IDs, timestamps, canonical locations, content hashes, and physical Vault containment. Critical reads and writes reject symlink paths that escape the real Vault root. Invalid or tampered records fail closed, are reported by `doctor`, and move only through confirmed repair operations.

High-confidence credential patterns are redacted before raw persistence and excluded from normal processing and recall. This detector is deliberately conservative and is not a complete secret scanner or encryption system. Protect the Vault like any other local transcript archive.

## Host integration

The installer merges managed lifecycle hooks into existing Claude Code or Codex configuration and preserves unrelated user settings. Linger does not disable, replace, rewrite, or delete host-owned memory. Uninstall removes only Linger-managed integration and preserves the Vault.

Codex may require explicit hook trust. Host-owned memory may contain some of the same facts as Linger. Retrieved Linger records remain separately labelled historical evidence; duplicate context is not independent corroboration, and conflicting versions must not be silently collapsed.

Optional enrichment uses only the model already active in Claude Code or Codex. Linger does not configure a separate model provider or credential. Enrichment submissions are bounded, project-scoped, limited to normal-sensitivity evidence, and revalidated against immutable source hashes before commit.

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/arishana1969/linger-skill/security/advisories/new).

Do not include live credentials, private conversations, or Vault files in a public issue. Include the affected version, expected behavior, reproduction steps using synthetic data, and the security impact when possible.
