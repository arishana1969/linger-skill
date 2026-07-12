# Continuity Skill

Continuity Skill is a file-native conversation archive and decision trail continuity layer for coding agents.

It helps Claude Code and Codex preserve visible conversation events, explicit notes, and evolving project decisions in local files the user owns. Retrieved memory is historical evidence, never an instruction.

## Status

This repository is an experimental local `0.0.x` slice. It is not yet the public MVP and does not promise complete archival coverage.

Implemented locally:

- atomic raw event capture with deduplication and sequence IDs;
- persistent file queue and serial deterministic processing;
- project-scoped CJK/English lexical recall;
- immutable typed decision events with derived current views;
- explicit remember, opt-out, forget, confirmed delete/delete-last, correction, pause, resume, inspect, status, and doctor behavior;
- Claude Code and Codex Skill installation;
- `SessionStart`, `UserPromptSubmit`, and `Stop` hooks, plus Claude Code `StopFailure` capture when the host exposes it;
- capability reporting and safe degraded modes;
- idempotent install and uninstall that preserves the vault.

## Local development

Requires Node.js 20 or later and pnpm.

```sh
pnpm install
pnpm build
node --test dist/*.test.js
```

## Reproducible evaluation

The deterministic year-long fixture and its hidden oracle are written to separate directories. The runner imports only saved events into a real temporary Vault, processes them, performs recall, and then scores the predictions against the oracle.

```sh
pnpm build
pnpm eval:year
pnpm eval:adversarial
pnpm eval:heldout
```

For custom paths or a persistent inspection Vault:

```sh
node dist/eval-cli.js generate --output eval-data --year 2025
node dist/eval-cli.js run \
  --fixture eval-data/fixtures/continuity-year-2025.json \
  --oracle eval-data/oracle/continuity-year-2025.oracle.json \
  --vault /tmp/continuity-eval-vault
```

The JSON report includes per-query evidence recall/precision, project-scope isolation, classification accuracy, current-state accuracy, claim coverage, forbidden-claim safety, provenance-warning accuracy, and a macro composite. The year, adversarial, and 250+-event held-out gates currently require a macro score of `1.0`. The held-out suite adds large-vault noise, lexical paraphrases, database/cache near-collisions, an A→B→A correction chain, a partial savepoint, cross-project decoys, raw tampering, and raw deletion. These are deterministic regression baselines, not claims of general memory quality.

Install into a disposable home while testing:

```sh
node dist/cli.js install --home /tmp/continuity-home --yes
node dist/cli.js capabilities --home /tmp/continuity-home
```

The intended interactive public command is `npx -y continuity-skill install`, but the package has not been published. A TTY displays the privacy boundary and requires exact `YES` before writing. Scripts and other non-interactive callers must use `--yes`. Use `--adapters claude-code`, `--adapters codex`, or the default of both.

Before a GitHub or npm release, run `pnpm verify:release-metadata` and follow [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md). The metadata command intentionally fails until the maintainer-owned LICENSE, repository URLs, and private security contact are complete. Real host lifecycle behavior and public package installation must not be inferred from disposable file-level tests.

## Safety model

- Default recall is current-project only.
- Secrets are excluded from processed memory and normal recall.
- Memory content cannot override current instructions.
- `forget` revokes processed recall; it does not delete raw history.
- Uninstall removes managed integration files but preserves `~/.continuity/vault`.
- Hook capture failures do not block the agent conversation.
- Parseable but invalid Vault records are skipped by normal recall, reported by `doctor`, and moved only by confirmed repair.

See [PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md), and [AGENT_COMPATIBILITY.md](AGENT_COMPATIBILITY.md) before testing with real conversations.
