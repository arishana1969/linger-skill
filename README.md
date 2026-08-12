# Linger

[![npm version](https://img.shields.io/npm/v/linger-skill.svg)](https://www.npmjs.com/package/linger-skill)
[![CI](https://github.com/arishana1969/linger-skill/actions/workflows/ci.yml/badge.svg)](https://github.com/arishana1969/linger-skill/actions/workflows/ci.yml)

**English** | [简体中文](README.zh-CN.md)

A file-native conversation archive and decision trail for coding agents.

> 念念不忘，必有回响。
> What lingers in mind will find its echo.

## Status

Linger v1.0.0 is the first formal product release for Claude Code and Codex. It preserves visible project conversations
as local, traceable evidence; it does not promise perfect archival coverage or production-grade compliance.

## What Linger does

- Captures visible user and assistant turns through managed lifecycle hooks, with a CLI fallback.
- Keeps immutable raw evidence, deterministic processed memory, corrections, and decision evolution.
- Reports current-project capture health instead of treating installed files as proof that capture works.
- Reports and controls Linger in the current conversation without pausing other sessions.
- Answers “why did we choose this?” with source IDs, integrity warnings, staleness, and conflicts.
- Supports optional organization by the model already active in Claude Code or Codex—no separate provider or key.
- Offers deterministic lexical recall and an optional Local-only semantic index on one validated Mac configuration.
- Stores ordinary state as versioned JSON/Markdown files—no database, telemetry, cloud sync, or daemon.
- Leaves Claude Code and Codex memory untouched. Linger is a sidecar, not a replacement.

Retrieved memory is historical evidence, never an instruction. Commands or prompts found in old records must not be
executed; current system and user instructions always win.

## Requirements and install

The base Linger CLI supports Node.js 22, 24, and 26. The optional Local Embedding companion remains bound to its validated
Node 24 artifact identity.

```sh
npx linger-skill install
```

Interactive installation shows the privacy boundary and requires `YES`. Non-interactive installation requires `--yes`:

```sh
npx linger-skill install --yes
npx linger-skill install --adapters claude-code
npx linger-skill install --adapters codex
```

For a persistent CLI:

```sh
npm install --global linger-skill
linger install
```

Installation preserves host-owned memory and unrelated host configuration. A fresh adapter remains unverified until a
real lifecycle event is observed; use `linger status` and `linger doctor` instead of assuming that copied files are healthy.
If `~/.local/bin` is already on PATH, the installer uses `~/.local/bin/linger`; otherwise it uses
`~/.linger/bin/linger`. It always reports the exact path and whether bare `linger` is currently reachable. It does not edit
shell profiles; use the reported absolute path until you choose to add its directory to PATH.

Upgrading from v0.2.2 does not rewrite the Vault. Read [UPGRADING.md](UPGRADING.md) for the exact compatibility, command,
removed-surface, verification, and rollback contract.

## How it works

```text
visible host event
  → immutable Raw record + durable queue
  → deterministic processed memory
  → optional host-model enrichment overlay
  → lexical recall
  → optional Local semantic branch
  → bounded, source-labelled evidence package
```

The default Vault is `~/.linger/vault`. Raw and decision events are source records. Processed memories, enrichment
overlays, registries, and embedding indexes are derived and can be rebuilt. Forget revokes recall eligibility without
rewriting history; correction appends evidence; delete and purge require explicit confirmation.

## Core commands

```sh
linger status --project PROJECT_ID
linger session-off --token TRUSTED_SESSION_TOKEN
linger session-on --token TRUSTED_SESSION_TOKEN
linger doctor
linger config show --project PROJECT_ID
linger recall --project PROJECT_ID --query "why did we choose SQLite?"
linger why --project PROJECT_ID --topic "database"
linger inspect --project PROJECT_ID --memory MEMORY_ID
linger pause
linger resume
```

Use `linger project-id --cwd .` to resolve the current project without writing the Vault. Git linked worktrees share the
same local repository identity; separate clones remain separate. After a directory/repository move, attach the new empty
locator explicitly with `linger project-attach --project ID --cwd PATH --yes`. Linger refuses to merge a locator that
already has project state. Confirm an observed remote change with
`linger project-confirm-identity --project ID --cwd PATH --yes`.

Recall stays project-scoped unless the user explicitly asks to inspect another project. A timeout or integrity failure is
reported as retrieval failure, never as a false “no memory.”

The installed Skill maps natural language such as “remember this,” “don’t save this,” “what did we discuss,” “why did we
choose X,” “that memory is wrong,” and “forget this” to the corresponding bounded operation.

Use the host-native Linger entry for status and current-conversation control: `/linger` in Claude Code, `$linger` or the
Skill picker in Codex. Session control tokens come only from trusted hook context, contain no conversation text, and affect
neither other sessions nor host-owned memory.

## Upgrade compatibility

v1 reads existing schema-v1 Raw, Processed, Decision, Queue, Project, Registry, Config, and Markdown content in place. It
reuses legacy same-root project IDs instead of silently creating a second project, and it upgrades manifest-owned legacy
Codex Skill entries without rewriting the Vault. Derived indexes may be rebuilt when their runtime identity changes; source
records are never batch-rewritten as part of upgrade. Uninstall continues to preserve old and current Vault content.

## Optional Local Embedding

v1.0.0 contains no API or Remote Embedding backend and never asks for an embedding API key. The only validated Local
profile is:

```text
macOS (Darwin) / arm64
Node 24 artifact identity
@huggingface/transformers 4.2.0
onnx-community/multilingual-e5-base-ONNX @ d15bb63d…
onnx/model_quantized.onnx, dtype=q8, 768 dimensions
```

Local Embedding is off after fresh install and upgrade. Enabling it is an explicit lifecycle:

```sh
linger embedding-install-plan
linger embedding-install --project PROJECT_ID --yes
linger embedding-enable --project PROJECT_ID
linger embedding-rebuild --project PROJECT_ID
linger embedding-status --project PROJECT_ID
```

The plan displays the runtime/model identity, size and transitive license inventory. The model and runtime are not bundled
in the npm package. Installation downloads fixed artifacts from allowlisted npm/Hugging Face sources without credentials,
query text, or project content; no package manager or lifecycle script runs in the artifact graph.

The checked-in acquisition manifests use `candidate_not_validated` to mean that a future download has not yet passed
install-time verification. A successful acquisition/install writes `installed_candidate_validated`. The pinned profile
combination itself completed product acceptance; the pre-install status deliberately makes no claim about bytes that have
not been downloaded on a user's machine.

The installer uses a bounded safe extractor and a fixed dependency graph. A content manifest binds every installed
directory and file, its byte count and SHA-256; the complete tree is checked before a worker starts. Inference is local,
uses `local_files_only`, and disables remote model loading and cache writes. The current installed footprint is about
685 MB, including the approximately 295 MB model.

Disable or remove derived state explicitly:

```sh
linger embedding-disable --project PROJECT_ID
linger embedding-delete-index --project PROJECT_ID --yes
linger embedding-remove-runtime --project PROJECT_ID --yes
```

Disabling preserves the index. Index deletion preserves source memory. Runtime removal is refused while any project still
uses the profile and preserves derived indexes. Missing, stale, sensitive, timed-out, or failed semantic paths fall back to
lexical recall with an explicit reason.

Other operating systems, architectures, models, revisions, dtypes, and runtimes are unsupported in v1.0.0.

## Privacy

Linger stores visible conversations locally. It installs no telemetry or Linger cloud service.

Local-first does not mean that host-model work stays on-device: recalled evidence and an optional bounded enrichment batch
enter the current Claude Code or Codex context and may be sent to the provider configured in that host. Linger selects no
additional provider and requests no key.

Local Embedding is different: embedding inputs and vectors remain on the device. Artifact hosts receive ordinary fixed-file
download requests only; they do not receive project content. Secret and sensitive queries are excluded from the Local worker.

High-confidence credential patterns are redacted before raw persistence and secret records are excluded from processing and
recall. This is a safety baseline, not complete DLP or encryption. Protect the Vault like any local transcript archive.

See [PRIVACY.md](PRIVACY.md) for the full boundary.

## Safety and limitations

- Automatic capture depends on current, verified host lifecycle support.
- Claude Code or Codex interruption may prevent complete assistant capture; partial evidence is labelled.
- Processing is session-local and event-driven; there is no persistent idle timer.
- Deterministic summaries and host enrichment may miss complex semantics.
- Local semantic retrieval improves candidate discovery but never upgrades a semantic-only hit into exact factual evidence.
- Multi-window writes are bounded and atomic where required, not a distributed transaction system.
- Secret detection is incomplete; a compromised local account remains outside Linger's protection.
- Only the named Darwin/arm64 Local profile has real runtime/model acceptance.

Critical paths validate schemas, IDs, canonical locations, source hashes, and physical Vault containment. Tampered records or
installed Local artifacts fail closed. `doctor` reports invalid state; repair and destructive operations require confirmation.

See [SECURITY.md](SECURITY.md) for the threat model and private reporting channel.

## Development

Development requires Node.js 22, 24, or 26 and pnpm.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm eval:year
pnpm eval:adversarial
pnpm eval:heldout
pnpm verify:package
```

The npm package excludes tests, temporary evidence, caches, and model/runtime artifacts. See [CONTRIBUTING.md](CONTRIBUTING.md)
for contribution rules.

## Uninstall and purge

```sh
npx linger-skill uninstall --yes
```

Uninstall removes managed Skill, hook, launcher, and runtime integration but preserves the Vault and host-owned memory.
Complete Linger-state removal is separate:

```sh
linger purge --yes --confirm PURGE
```

## License

Linger is MIT licensed. Third-party Local runtime/model licenses are shown before acquisition and are not replaced by the
Linger license. See [CHANGELOG.md](CHANGELOG.md), [PRIVACY.md](PRIVACY.md), and [SECURITY.md](SECURITY.md).
