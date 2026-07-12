# MVP implementation audit

Audit date: 2026-07-12

Baseline: commit `35ece32` plus the audit-only changes in this file.

Legend: **Complete**, **Partial**, **Missing**, **Needs host validation**, **External release step**.

This audit distinguishes deterministic repository evidence from claims that require a published package or a real Claude Code/Codex host. A green unit test is not treated as host validation.

## Executive result

The repository has the complete local spine of a GitHub MVP: file-native capture, immutable raw events, persistent serial processing, processed Markdown/JSON records, scoped lexical recall, decision trails, user controls, safe install/uninstall/purge, adapter capability reporting, CI, and deterministic long-duration evaluation.

It is not yet a public release candidate. The remaining release blockers are package publication/clean-machine `npx` proof, real-host lifecycle validation, and documentation/schema reconciliation. Interactive install, a persistent in-session timer, richer topic merge, and index fragments can remain post-GitHub-MVP if their degraded behavior is documented honestly.

## P0 implementation matrix

| PRD P0 requirement | Status | Repository evidence / remaining gap |
| --- | --- | --- |
| npx installer | External release step | CI installs the exact tarball into an offline temporary consumer through pnpm, then runs the generated bin shim through install/capabilities/uninstall; required documents and forbidden development-data exclusions are asserted. npm publication and public clean-machine `npx -y continuity-skill install` remain external. |
| Vault initialization and helper CLI | Complete | `initVault`, safe project IDs, CLI commands, atomic I/O, and path-bound destructive operations are tested. |
| Claude Code adapter | Needs host validation | Claude Code `2.1.207` live-smoke confirms successful SessionStart and UserPromptSubmit hooks plus persisted raw/queue payloads in a disposable HOME with zero model tokens/cost. Successful Stop/assistant and partial-answer capture remain unverified. |
| Codex adapter | Needs host validation | Codex `0.144.0-alpha.4` app-server `hooks/list` accepts all three generated hooks with no parse warnings/errors and reports them untrusted. Trust UX, command execution, and live lifecycle payload capture remain unverified. |
| Adapter capability report | Complete | Reports Claude hook configuration at L2. Codex remains L1 when hooks are configured but execution trust is unverified; it does not infer live execution or L3/L4 from copied files. |
| Hook capture and pending recovery | Partial | User, assistant, partial, opt-out, redaction, SessionStart recovery, and startup processing are tested through the handler. Real-host event semantics remain. |
| Raw event, sequence, hash, dedupe | Complete | Atomic independent JSON events, project sequence IDs, SHA-256 content hash, stable IDs, and deduplication are covered. |
| Persistent queue and serial worker | Complete | Per-item state, retries, failure isolation, explicit priority, corruption isolation, and a process lock exist. |
| Processed memory | Complete | Canonical JSON plus human-readable Markdown/frontmatter mirror, provenance, and deletion synchronization are tested. |
| Tag registry and search phrases | Complete | Content/predictive tags, retrieval phrases, rebuildable active counts, and forget exclusion exist. Generation is deterministic and intentionally basic. |
| Minimal term graph and alias expansion | Complete | Evidence-backed, project-scoped relations with confidence/context guards expand recall without replacing original terms. Automatic discovery is not claimed. |
| Project scope and BM25-style search | Complete | Project isolation, CJK bigrams, English terms, IDF-style ranking, tags, phrases, max-files, bounded snippets/characters/raw fragments, inclusive time filters, and an explicit wall-clock timeout are tested. |
| Decision trail | Complete | Append-only events, current view, A→B→A, evidence requirement, explicit priority, automatic visible-decision extraction, supersession, and conflict reporting are tested. Topic extraction remains heuristic. |
| User-explicit memory | Complete | Hook recognition sets highest confidence/priority; opt-out is skipped before capture. Natural-language coverage is deliberately finite. |
| Forget, delete, correct | Complete | Forget/correct are append-only control events; raw/processed deletion is ID-scoped and confirmed; Markdown/JSON stay synchronized. |
| Pause/resume/status/inspect/doctor | Complete | CLI operations and actionable queue/integrity reports are covered. |
| Required repository documents | Complete | README, PRIVACY, SECURITY, DATA_MODEL, ADAPTER_SPEC, AGENT_COMPATIBILITY, ROADMAP, and CONTRIBUTING exist. Accuracy updates remain part of release review. |

## P1 and acceptance gaps

| Area | Current state | Gap that still matters |
| --- | --- | --- |
| Processing triggers/budget | Successful hook events run an event-driven decision for explicit, 50KB, and max-wait triggers; SessionStart recovery/processing, manual runs, max runs/hour, max items/run, pause, and backlog status exist. Short non-explicit assistant chatter is skipped unless it has a durable signal. | No token budget, rich durable-content classifier, or persistent timer while a session remains idle. |
| Recall bounds | File, snippet, evidence-character, raw-fragment, time-range, and wall-clock bounds exist; insufficient clues return topic/decision/tag candidates; empty retrieval abstains. | Candidate fallback does not yet suggest likely time ranges. File selection is deterministic rather than recency-aware. |
| Sensitive/secret handling | Secret patterns are classified and redacted before hook persistence; secret records do not enter processing or normal recall; sensitive records are excluded by default. | No encryption-at-rest flow and no exhaustive detector. PRD allows stronger encryption UX after MVP, but limitations must stay explicit. |
| Tamper handling | Raw/processed provenance hashes are checked; processed records with a present but mismatched raw source are excluded from normal search. Missing raw provenance yields `unverified_source` plus a confidence penalty, preserving the valid raw-delete/processed-retain case. Invalid files can be explicitly quarantined and doctor remains usable. | Larger-vault performance and malicious mutation patterns need further evaluation. |
| Scheduler | Startup scan and processing are implemented. | No daemon and no guaranteed timer while a long session stays open. This is an honest degraded mode, not L3. |
| Current decision view | Implemented, including current evidence refs, explicit-current supersession, and separate primary-database versus database-cache topics. | Decision topic merge/alias lookup remains heuristic; other unrelated decisions can still share a coarse topic. |
| Index fragments | Registry and processed records are rebuildable without a database. | Dedicated index fragments described by the PRD are missing. This is not currently required by the deterministic search implementation. |
| Global memory | Vault structure is project-first and default recall is isolated. | Non-sensitive `global` preference recall is not implemented. No automatic cross-project search exists, which is safer but below the full PRD model. |
| Interactive installer | `--yes` install path and explicit privacy notice work. The non-interactive MVP rejects missing `--yes` before writing files and includes the privacy boundary in the error. | Interactive adapter selection/acknowledgment is missing. |

## Acceptance evidence

### Installation and lifecycle

- Idempotent managed Skill copy, backup of unmanaged Skill directories, hook merge, stable versioned runtime, capability reporting, uninstall preservation, and double-confirmed purge are automated tests.
- The exact packed tarball is installed offline into a temporary package-manager consumer, then its generated bin shim runs install, capability reporting, and uninstall after separation from the source tree. Required package documents/runtime files and forbidden development-data exclusions are asserted.
- Remaining proof: published package, public clean-machine npx path, Claude completed-assistant capture, and Codex trusted live execution.

### Capture, processing, and recovery

- User/assistant/partial event shapes, content hash, sequence, dedupe, pending recovery, persistent queue, serial processing, retry/failure isolation, 50KB/max-wait policy, and hourly/item budgets are covered.
- Processing failure never mutates the raw source; corrupt operational files do not block valid work.
- Remaining proof: real interrupted-answer payload and long-open-session scheduling behavior.

### Recall and decisions

- Project isolation, CJK/English lexical scoring, tags, aliases/term graph, explicit-memory priority, evidence IDs, character budget, candidates, abstention, current state, rationale recall, and conflict classification are covered.
- A deterministic 99-event year fixture and a separate adversarial fixture run through a real temporary Vault. Their checked-in regression gates require macro composite `1.0` across evidence, scope, classification, state, acceptable claims, and forbidden claims.
- These small generated fixtures prevent known regressions; they are not evidence of general-world retrieval quality.

### Security and controls

- The installed Skill declares retrieved memory to be evidence, never instruction.
- Default search is one project and excludes sensitive, secret, forgotten, deleted, and invalid processed records.
- High-confidence secrets are redacted before hook persistence; opt-out is skipped; destructive operations are ID/path bounded and confirmation gated.
- Remaining proof: larger adversarial corpus, malicious-repo exercises, and host-level trust UX.

## GitHub MVP blocker order

1. Reconcile README, DATA_MODEL, TECHNICAL_DESIGN, ROADMAP, and adapter docs against current behavior.
2. Complete host smoke gaps: Claude successful Stop/assistant capture and Codex trusted live execution; record exact versions, payloads, and degraded paths.
3. Resolve maintainer release metadata in `RELEASE_CHECKLIST.md`, including license, repository URL, package ownership, and security contact. Keep npm publication as an explicit user-owned release action.
4. Expand generated evaluation with held-out paraphrases, noisy near-collisions, corrections, partial answers, tampering, and larger vault sizes.

## Explicitly deferred from the first GitHub MVP

- Embeddings, vector database, daemon, sync, GUI, browser extension, extra adapters, and bounded parallel processing.
- Automatic term-graph discovery and LLM processing quality beyond the deterministic local baseline.
- Full encryption UX, exhaustive secret detection, dedicated index fragments, global preference recall, and sophisticated decision-topic merge.

The release should continue to describe Continuity as an experimental file-native archive and decision-trail layer, not a complete or universal AI memory system.
