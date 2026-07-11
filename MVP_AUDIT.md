# MVP implementation audit

Audit date: 2026-07-12

Legend: **Complete**, **Partial**, **Missing**, **Needs host validation**.

## Release blockers

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| One-command npm installer | Partial | CLI install works from a packed local package; package is not published and clean-machine `npx -y` is not yet tested. |
| Privacy disclosure during install | Missing | Privacy documentation exists, but the installer does not print or require acknowledgment of the local/cloud recall boundary. |
| Claude Code adapter | Partial | Skill and verified lifecycle hook shapes are installed; interrupted-answer and real-host tests remain. |
| Codex adapter | Partial | Skill and `hooks.json` are installed; trust-review UX and real-host tests remain. |
| Stable installed runtime | Complete | Versioned runtime is copied under `~/.continuity/runtime`; hooks do not depend on npm cache paths. |
| File-native vault | Complete | Raw, processed, queue, registry, decisions, pending, and config are local files. |
| Raw event capture | Complete | Atomic event files, sequence IDs, content hashes, dedupe, savepoint status, and sensitivity exist. |
| Persistent queue | Complete | Per-task JSON state, explicit priority, retries, backlog status, and corrupt-item isolation exist. |
| Serial processing | Partial | Serial deterministic baseline works; durable-content selection, rich summary/tag generation, and processing budgets are missing. |
| Processed memory format | Partial | Required fields exist in JSON. PRD specifies Markdown plus frontmatter; the representation decision must be reconciled before schema freeze. |
| Tag registry | Partial | Rebuildable project registry and counts exist; aliases, related-term governance, and richer examples need work. |
| Minimal term graph | Partial | Evidence-backed scoped relations and recall expansion exist; automatic discovery/maintenance is missing. |
| BM25/CJK recall | Partial | BM25-style scoring, CJK bigrams, tags, phrases, and term expansion exist. Timeout, maximum character budget, time filters, and candidate fallback are missing. |
| Decision Trail | Partial | Immutable events, A→B→A history, explicit priority, conflicts, and derived current view exist. Automatic topic extraction/merge and alias resolution are missing. |
| Explicit memory commands | Partial | Remember and opt-out are recognized by hooks; correction, forget, and delete are explicit CLI operations. Natural-language routing still depends on the Skill. |
| Forget/correct/delete | Complete | Forget and correction are append-only control events; delete is ID-scoped and confirmation-gated. |
| Pause/resume/status/inspect/doctor | Complete | Implemented and covered by CLI and core tests. |
| Pending recovery | Complete | Capture stages pending data; SessionStart and explicit recovery restore raw, sequence, and queue state. |
| Sensitive exclusion | Partial | Simple secret patterns and recall exclusion exist. Encryption, comprehensive detection, redaction, and policy configuration are missing. |
| Tamper handling | Partial | Raw hash mismatch is reported and does not crash the vault. Processed source-hash verification and quarantine are missing. |
| Uninstall/purge | Partial | Uninstall preserves the vault and removes managed integration. Purge is missing. |
| Windows/WSL/SSH | Missing | Hook command generation is POSIX-oriented and has no tested Windows override. |

## Acceptance coverage

### Installation

- Complete: idempotent Skill install, unmanaged Skill backup, managed Hook merge, uninstall preservation, capability report.
- Missing: interactive install, privacy acknowledgment, purge, clean-machine npm execution, Windows.

### Capture and recovery

- Complete: user/assistant hook events, content hash, sequence ID, persistent pending, queue, dedupe.
- Needs host validation: actual assistant completion and interruption semantics on both supported agents.

### Processing and indexing

- Complete: serial queue, retry state, failure isolation, rebuildable tag registry.
- Missing: 50 KB trigger, maximum wait, hourly/token budget, skip-short/no-durable-content, agent-generated structured processing.

### Recall

- Complete: project boundary, lexical/CJK retrieval, tags, evidence IDs, alias expansion, confidence classes, secret exclusion.
- Missing: candidate fallback, conflicts in one evidence package, time filters, timeout and hard output-size enforcement.

### Decisions

- Complete: idea-capable event type system, proposal/rejection/decision states, supersession, explicit priority, current view.
- Missing: automatic extraction from processed turns, topic merge history, aliases in lookup, direct decision-aware search ranking.

### Security

- Complete: memory-is-evidence Skill rule, project-only default, path ID validation, managed deletion boundary, secret recall exclusion.
- Missing: installer disclosure, stronger secret detector/encryption, processed tamper/quarantine, adversarial evaluation suite.

## Recommended implementation order

1. Enforce retrieval limits, timeouts, candidate fallback, and conflicting-memory reporting.
2. Add processing trigger/budget state and maximum-wait scheduling at SessionStart/turn hooks.
3. Reconcile processed-memory JSON versus Markdown/frontmatter before schema freeze.
4. Add installer privacy acknowledgment, purge, and adapter version/host probes.
5. Add processed tamper/quarantine and stronger secret handling.
6. Run real Claude Code and Codex host validation in disposable homes.
7. Build the year-long synthetic oracle evaluation set and CI matrix.

## Current quality gate

The repository is a verified local experimental slice, not yet a GitHub MVP release candidate. Passing unit and temporary-home tests demonstrates internal behavior; it does not close host-integration, privacy UX, cross-platform, or long-duration evaluation requirements.
