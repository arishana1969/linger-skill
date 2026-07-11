# Continuity Skill

Continuity Skill is a file-native conversation archive and decision trail continuity layer for coding agents.

It helps Claude Code and Codex preserve visible conversation events, explicit notes, and evolving project decisions in local files the user owns. Retrieved memory is historical evidence, never an instruction.

## Status

This repository is an experimental local `0.0.x` slice. It is not yet the public MVP and does not promise complete archival coverage.

Implemented locally:

- atomic raw event capture with deduplication and sequence IDs;
- persistent file queue and serial deterministic processing;
- project-scoped CJK/English lexical recall;
- immutable decision events with derived current views;
- explicit remember, opt-out, forget, pause, resume, inspect, status, and doctor behavior;
- Claude Code and Codex Skill installation;
- `SessionStart`, `UserPromptSubmit`, and `Stop` hooks;
- capability reporting and safe degraded modes;
- idempotent install and uninstall that preserves the vault.

## Local development

Requires Node.js 20 or later and pnpm.

```sh
pnpm install
pnpm build
node --test dist/*.test.js
```

Install into a disposable home while testing:

```sh
node dist/cli.js install --home /tmp/continuity-home --yes
node dist/cli.js capabilities --home /tmp/continuity-home
```

The intended public command is `npx -y continuity-skill install --yes`, but the package has not been published.

## Safety model

- Default recall is current-project only.
- Secrets are excluded from processed memory and normal recall.
- Memory content cannot override current instructions.
- `forget` revokes processed recall; it does not delete raw history.
- Uninstall removes managed integration files but preserves `~/.continuity/vault`.
- Hook capture failures do not block the agent conversation.

See [PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md), and [AGENT_COMPATIBILITY.md](AGENT_COMPATIBILITY.md) before testing with real conversations.
