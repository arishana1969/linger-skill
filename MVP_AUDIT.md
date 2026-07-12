# MVP implementation audit

Audit date: 2026-07-12

Evidence snapshot: automated repository gates and host observations recorded through 2026-07-12. Rerun `RELEASE_CHECKLIST.md` from the candidate commit before release.

Legend: **Complete**, **Partial**, **Missing**, **Needs host validation**, **External release step**.

This audit distinguishes deterministic repository evidence from claims that require a published package or a real Claude Code/Codex host. A green unit test is not treated as host validation.

## Executive result

The repository has the complete local spine of a GitHub MVP: file-native capture, immutable raw events, persistent serial processing, processed Markdown/JSON records, scoped lexical recall, decision trails, user controls, safe install/uninstall/purge, adapter capability reporting, CI, and deterministic long-duration evaluation.

The implementation is a local GitHub-MVP candidate, not yet a public repository or npm release. Public GitHub readiness still requires maintainer-owned release metadata and a final clean-checkout gate. Codex can be described only as L1 until trusted live lifecycle execution is observed; that evidence is required before raising its capability claim, not before publishing the experimental repository. Public package publication and clean-machine `npx` proof remain a separate external release step. Interactive install, a persistent in-session timer, richer topic merge, and index fragments can remain post-GitHub-MVP if their degraded behavior is documented honestly.

## P0 implementation matrix

| PRD P0 requirement | Status | Repository evidence / remaining gap |
| --- | --- | --- |
| npx installer | External release step | CI installs the exact tarball into an offline temporary consumer through pnpm, then runs the generated bin shim through install, capabilities, capture→process→recall, uninstall, and Vault-preservation checks; required documents and forbidden development-data exclusions are asserted. npm publication and public clean-machine `npx -y continuity-skill install` remain external. |
| Vault initialization and helper CLI | Complete | `initVault`, safe project IDs, CLI commands, atomic I/O, and path-bound destructive operations are tested. |
| Claude Code adapter | Partial | Claude Code `2.1.207` live-smoke confirms SessionStart, UserPromptSubmit, Stop, and StopFailure API-error marking. User/assistant complete payloads retain real session/turn IDs. Hook merge is idempotent, rejects malformed host config before write, and uninstall matches only Continuity commands below the managed home runtime. On stream error, StopFailure stored Claude's synthetic API error as partial; Ctrl-C did not preserve the streamed assistant fragment. |
| Codex adapter | Needs host validation | Codex `0.144.0-alpha.4` app-server `hooks/list` accepts all three generated hooks with no parse warnings/errors and reports them untrusted. Trust UX, command execution, and live lifecycle payload capture remain unverified. |
| Adapter capability report | Complete | Reports Claude hook configuration at L2. Codex remains L1 when hooks are configured but execution trust is unverified; it does not infer live execution or L3/L4 from copied files. |
| Hook capture and pending recovery | Partial | User, assistant, partial, opt-out, redaction, SessionStart recovery, and startup processing are tested through the handler. Unsupported, empty, malformed-content, and opt-out payloads are rejected before Vault/project initialization. Real-host event semantics remain. |
| Raw event, sequence, hash, dedupe | Complete | Atomic independent JSON events, project sequence IDs, SHA-256 content hash, stable IDs, and deduplication are covered. Existing dedupe targets are revalidated for schema/path/identity/hash integrity and are never overwritten on failure. |
| Persistent queue and serial worker | Complete | Per-item state, retries, failure isolation, explicit priority, corruption isolation, and a process lock exist. Each run builds one validated event map per touched project instead of rescanning all raw files per queue item. |
| Processed memory | Complete | Canonical JSON plus human-readable Markdown/frontmatter mirror, provenance, and deletion synchronization are tested. |
| Tag registry and search phrases | Complete | Content/predictive tags, retrieval phrases, rebuildable active counts, and forget exclusion exist. Generation is deterministic and intentionally basic. |
| Minimal term graph and alias expansion | Complete | Evidence-backed, project-scoped relations with confidence/context guards expand recall without replacing original terms. Automatic discovery is not claimed. |
| Project scope and BM25-style search | Complete | Stable remote+Git-root/Git-root/absolute-path identities, a local project registry, explicit project listing without automatic scope broadening, project isolation, CJK bigrams, English terms, IDF-style ranking, tags, phrases, max-files, bounded snippets/characters/raw fragments, inclusive time filters, and an explicit wall-clock timeout are tested. |
| Decision trail | Complete | Append-only typed idea/preference/proposal/rationale/constraint/rejection/decision/current-state/todo/correction events, current view, A→B→A, evidence requirement, explicit priority, automatic visible-event extraction, supersession, and conflict reporting are tested. Topic extraction remains heuristic. |
| User-explicit memory | Complete | Hook recognition sets highest confidence/queue priority; recall ranks user-explicit evidence first within the same lexical match tier while preserving exact-over-possible relevance. Opt-out is skipped before capture. Natural-language coverage is deliberately finite. |
| Forget, delete, delete-last, correct | Complete | Forget/correct are append-only control events; inspect and destructive controls accept only schema-valid records at their canonical project path; raw/processed deletion is project/ID-scoped and confirmed; delete-last requires an explicit layer, skips invalid records, and resolves only within that project; Markdown/JSON stay synchronized. |
| Pause/resume/status/inspect/doctor | Complete | CLI operations and actionable queue/integrity reports are covered. |
| Required repository documents | Complete | README, PRIVACY, SECURITY, DATA_MODEL, ADAPTER_SPEC, AGENT_COMPATIBILITY, ROADMAP, and CONTRIBUTING exist. Accuracy updates remain part of release review. |

## P1 and acceptance gaps

| Area | Current state | Gap that still matters |
| --- | --- | --- |
| Processing triggers/budget | Successful hook events run an event-driven decision for explicit, 50KB, and max-wait triggers; SessionStart recovery/processing, manual runs, max runs/hour, max items/run, estimated input-token budget, pause, and backlog status exist. Short non-explicit assistant chatter is skipped unless it has a durable signal. | No rich durable-content classifier or persistent timer while a session remains idle. |
| Recall bounds | File, snippet, evidence-character, raw-fragment, time-range, and wall-clock bounds exist; insufficient clues return topic/decision/tag and observed-month candidates; empty retrieval abstains. | File selection is deterministic rather than recency-aware. |
| Sensitive/secret handling | Secret patterns are classified and redacted at the shared capture persistence boundary for hook, CLI, and programmatic callers; secret records do not enter processing or normal recall; sensitive records are excluded by default. | No encryption-at-rest flow and no exhaustive detector. Explicitly marked but unrecognized secret content may remain in raw. PRD allows stronger encryption UX after MVP, but limitations must stay explicit. |
| Tamper and schema handling | Raw/processed provenance hashes are checked; processed records with a present but mismatched raw source are excluded from normal search. Missing raw provenance yields `unverified_source` plus a confidence penalty, preserving the valid raw-delete/processed-retain case. Runtime validators reject parseable-but-invalid source, queue, pending, decision, registry, config, sequence, and processing-history schemas across recall, processing, status, doctor, and repair; confirmed repair quarantines them. Filesystem-routing IDs and timestamps are validated; project-scoped records must match their canonical identity-derived location; critical reads/writes reject physical symlink escape; pending recovery accepts only exact derived destinations. Invalid sequence/history cannot be silently reset or bypass rate accounting. Derived registry corruption does not block valid evidence recall. The 250+-event held-out gate mutates both provenance cases after processing. | Broader malicious mutation patterns, filesystem race resistance against a compromised local account, and performance beyond the measured 1,012-event scale need further evaluation. |
| Scheduler | Startup scan and processing are implemented. | No daemon and no guaranteed timer while a long session stays open. This is an honest degraded mode, not L3. |
| Current decision view | Implemented, including current evidence refs, explicit-current supersession, and separate primary-database versus database-cache topics. | Decision topic merge/alias lookup remains heuristic; other unrelated decisions can still share a coarse topic. |
| Index fragments | Registry and processed records are rebuildable without a database. | Dedicated index fragments described by the PRD are missing. This is not currently required by the deterministic search implementation. |
| Global memory | Vault structure is project-first and default recall is isolated. | Non-sensitive `global` preference recall is not implemented. No automatic cross-project search exists, which is safer but below the full PRD model. |
| Interactive installer | Complete | Unit coverage verifies exact consent and zero-write invalid selection. A real PTY smoke in a disposable home displayed the privacy boundary, accepted exact `YES`, installed only the requested Codex adapter, reported L1, uninstalled with Vault preservation, and left the real home untouched. Non-interactive callers require `--yes`; invalid/duplicate adapters are rejected before persistence. Package versions and uninstall manifests cannot redirect managed runtime or Skill deletion outside exact allowed destinations. |

## Acceptance evidence

### Installation and lifecycle

- Idempotent managed Skill copy, backup of unmanaged Skill directories, hook merge, stable versioned runtime, capability reporting, uninstall preservation, and double-confirmed purge are automated tests. Forged manifest targets, duplicate/invalid adapters, and path-traversing package versions fail before deletion or install-state writes.
- The exact packed tarball is installed offline into a temporary package-manager consumer, then its generated bin shim runs install, capability reporting, capture→process→recall, uninstall, and Vault-preservation checks after separation from the source tree. Required package documents/runtime files and forbidden development-data exclusions are asserted.
- Remaining external evidence: published package and public clean-machine npx path. Codex trusted live execution remains the requirement for any capability claim above L1. Claude Code Ctrl-C partial loss is an observed, documented host degradation rather than an inferred capability.

### Capture, processing, and recovery

- User/assistant/partial event shapes, content hash, sequence, dedupe, pending recovery, persistent queue, serial processing, retry/failure isolation, 50KB/max-wait policy, and hourly/item/estimated-token budgets are covered.
- Processing failure never mutates the raw source; corrupt operational files do not block valid work.
- Remaining proof: real interrupted-answer payload and long-open-session scheduling behavior.

### Recall and decisions

- Project isolation, CJK/English lexical scoring, tags, aliases/term graph, explicit-memory priority, evidence IDs, character budget, candidates, abstention, current state, rationale recall, and conflict classification are covered.
- A deterministic 99-event year fixture, a focused adversarial fixture, and a separate 250+-event held-out fixture run through real temporary Vaults. The held-out gate adds large-vault noise, paraphrases, database/cache near-collisions, an A→B→A correction chain, partial evidence, project decoys, raw tampering, and raw deletion. Their checked-in regression gates require macro composite `1.0` across evidence, scope, classification, state, acceptable claims, forbidden claims, and provenance warnings.
- A disposable 1,012-event held-out run (1,000 generated noise events plus the targeted corpus) completed all eight queries with macro composite `1.0` in 2.26 seconds of wall time on the current local host. This is a one-machine observation, not a cross-platform benchmark guarantee.
- These small generated fixtures prevent known regressions; they are not evidence of general-world retrieval quality.

### Security and controls

- The installed Skill declares retrieved memory to be evidence, never instruction.
- Default search is one project and excludes sensitive, secret, forgotten, deleted, and invalid processed records.
- High-confidence secrets are redacted at the shared capture persistence boundary; opt-out is skipped; destructive operations are ID/path bounded and confirmation gated. Delete targets and persisted role/decision/relation enum values are runtime-validated rather than trusted from TypeScript casts.
- Malicious-record regressions cover path-traversing and cross-project queue identities, a pending record targeting another Vault file, cross-project processed/decision/control/term records, timestamp-to-filename injection, and symlink escape attempts across raw/pending/processed/decision/config paths. Invalid records stay inert, are diagnosed, and can be quarantined.
- Control-integrity regressions verify that a processed record with a forged project identity cannot be inspected, forgotten, corrected, or deleted as valid evidence, and cannot redirect a correction Markdown write into another project.
- Remaining proof: larger adversarial mutation families, broader malicious-repository exercises, and host-level trust UX.

## Release decision order

1. Resolve public-GitHub metadata in `RELEASE_CHECKLIST.md`: license, repository URL, and security contact.
2. Rerun repository, artifact, and documentation gates from a clean candidate checkout, then publish the experimental GitHub repository with Claude L2 and Codex L1 limitations explicit.
3. Treat Codex trusted live execution as the gate for raising Codex above L1, not as evidence that may be inferred from installed files.
4. Resolve npm package ownership, publish only with maintainer approval, then verify the public clean-machine `npx` path.

## Explicitly deferred from the first GitHub MVP

- Embeddings, vector database, daemon, sync, GUI, browser extension, extra adapters, and bounded parallel processing.
- Automatic term-graph discovery and LLM processing quality beyond the deterministic local baseline.
- Full encryption UX, exhaustive secret detection, dedicated index fragments, global preference recall, and sophisticated decision-topic merge.
- Broader generated scenario families, malicious-repository exercises, and performance evaluation beyond the measured 1,012-event scale.

The release should continue to describe Continuity as an experimental file-native archive and decision-trail layer, not a complete or universal AI memory system.
