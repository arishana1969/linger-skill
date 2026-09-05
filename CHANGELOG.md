# Changelog

Notable user-visible changes to Linger are recorded here.

## 1.1.0 — 2026-09-05

Compared with v1.0.0; includes the CLI reliability fixes previously considered for v1.0.1. Independent ablation is complete;
the final review includes a real v0.2.2 upgrade and a bounded real-E5 Tag measurement.

### Fixed

- POSIX installs expose `~/.local/bin/linger` consistently instead of choosing a different directory from the install-time
  PATH. Upgrade refreshes previously managed absolute launcher paths; old installs without launchers gain the entry.
- Fresh Local Embedding acquisition budgets all 55 artifact requests plus the redirects permitted for the five fixed model
  files. The previous file-count-only budget could stop a valid first install before the model download completed.
- Managed runtimes include package metadata, Skill assets, and Local acquisition manifests as well as compiled code.
  `--version`, `embedding-install-plan`, and managed reinstall survive removal of the original package or npx cache.
- Hooks provide a trusted Node/CLI/Vault locator even without pending enrichment. Subcommand `--help` shows the overview;
  bare search text no longer absorbs trailing options into the query.

### Added and constrained

- `tags list|rebuild|suggest|relate|relations` operates on the existing Tag Registry and Term Graph. Tag discovery reuses the
  optional Local E5 runtime, embeds up to 128 eligible tags per request, and discards vectors after ranking candidates.
- Candidate output keeps tag names, optional cosine values and a bounded evidence sample from one eligible document;
  response status and coverage describe the discovery result. No redundant per-candidate exact-match flag or fixed error
  alias is exposed. Independent ablation also removes duplicate evidence aggregation, query normalization and source preflight work.
- Explicit relation curation records type, confidence, context, timestamps, and verified project evidence. No similarity
  score automatically creates a synonym. `search` and `recall` accept explicit `--context` tags.
- Confident equivalences expand one hop with reduced lexical weight. `related` and `ambiguous` never expand, and veto a
  competing equivalence for the same pair in the applicable context. Contextual equivalence requires matching context.
  Semantic-only document hits retain their existing possible-match behavior; they are not filtered by the term graph.

### Compatibility and boundaries

- No dependencies, cloud API, model, service, vector database, parallel index, settings, or migrations added. Local profile,
  document embedding indexes, lexical ranking/confidence, and existing Vault/config/record formats remain compatible.
- Tag Registry and Term Graph remain schema-v1. Existing relation IDs and evidence remain readable. Legacy
  `location_mapping`/`product_name` mappings retain their behavior; `related` expansion and context-free contextual
  equivalence are deliberately narrowed without rewriting those records.
- Embedding remains default-off; upgrades preserve existing settings. Disabled/unavailable Tag discovery returns normalized
  exact names and a status; curated relations continue to work in lexical retrieval. Candidate cosine values are not
  calibrated Tag confidence. The fixed acceptance set verifies the contract with controlled vectors, not real E5 quality.

### Verification

- Bounded unit/integration, removal experiments and temporary npm-package/upgrade checks are recorded in `ABLATION_REPORT.md`,
  with a compact summary in `DEVELOPMENT.md`. Production HOME/Vault and GitHub remain unchanged.

## 1.0.0 — 2026-08-12

This is the complete user-visible delta from the last public release, v0.2.2. The v0.3.0 section below records the internal
MVP milestone that was incorporated into v1.0.0 but never published separately.

### Added

- Added truthful current-project Capture Health with lifecycle evidence, stable reason codes, queue/pipeline diagnostics, and
  a unified `linger status` view.
- Added host-native Linger status entry and current-conversation on/off control without changing other sessions, existing
  evidence, global pause, or host-owned memory.
- Added `linger why` with decision timeline, current state, rationale, conflicts, integrity warnings, source references, and
  staleness.
- Added stable Git common-dir project identity, linked-worktree sharing, clone isolation, remote-change diagnosis, and
  explicit fail-closed attachment for moved empty locators.
- Added scoped settings with bounded precedence, revision/CAS, locks, and atomic writes.
- Added one optional, default-off Local-only semantic profile for Darwin/arm64 with lexical-first hybrid ranking and
  deterministic fallback. The npm package contains frozen manifests, not the model/runtime artifacts.
- Added in-place compatibility for legacy schema-v1 content, same-root project IDs, v0.2.x manifests, ownership markers,
  adapter evidence, and legacy Skill paths.
- Added `UPGRADING.md` with the v0.2.2 compatibility, verification, removed-surface, and rollback contract.

### Changed

- Reframed Linger as a focused formal product: one managed installed identity, one stable CLI launcher, and host-native Skill
  entry. Installation reports the exact launcher and current PATH reachability without editing shell profiles.
- Search, Why, Doctor, and Local indexing now share one effective-document integrity model for source path/hash/project,
  correction/revocation, sensitivity, and provenance.
- Doctor and Repair share record inspection while retaining separate report and confirmed-mutation behavior.
- Lifecycle evidence is the current health truth; legacy adapter evidence remains a read-only compatibility input.
- Processed JSON remains the structural truth and Markdown remains a checked human-readable view.
- Fixed Local artifacts use frozen size/hash data instead of a metadata-only network lookup.
- Base CLI support is now Node.js 22, 24, and 26. The Local companion remains bound to its accepted Node 24 artifact identity.
- Refactored critical guards for human auditability and reduced npm runtime contents; no user Vault migration or bulk history
  rewrite occurs.

### Removed or narrowed

- Node 20 is no longer supported.
- Removed duplicate `active.json` installation state and settings without real runtime consumers.
- Removed `linger-eval` as a public binary, recall-sampling write commands, and undocumented `term-add` / `tags-rebuild`
  maintenance commands from the product CLI. Evaluation remains repository-only.
- Excluded tests, development eval, source maps, declarations, release tooling, process evidence, and model/runtime artifacts
  from the npm runtime package.
- API/Remote Embedding remains absent; Linger does not request or read an embedding API key.

### Security and privacy

- Local artifact acquisition uses fixed HTTPS sources, integrity/size/request/time/disk limits, a safe extractor, a fixed
  dependency graph, no package manager/lifecycle execution, private permissions, and installed-tree rehashing.
- Local inference is short-lived and local-files-only; remote loading, cache writes, and worker `fetch` fail closed. Sensitive
  records and queries do not enter the worker.
- Recalled content remains untrusted historical evidence, never executable instruction. Host-owned memory remains outside
  Linger ownership.
- Uninstall preserves the Vault. `purge` remains a separate double-confirmed destructive operation.

### Verification

- 207/207 tests passed; adversarial recall macro composite is 1.0.
- Skill validation, secret scan, package-consumer install/capture/recall/uninstall, Vault preservation, package-content, and
  release-metadata gates passed.
- Final bounded audit: P0=0, P1=0, new P2=0. Previously accepted non-blocking Local acquisition residual risks remain
  documented and are not claimed as closed.

## 0.3.0 — Internal MVP baseline

### Added

- Added truthful current-project Capture Health with lifecycle evidence, stable reason codes, bounded diagnostics, and
  non-blocking failure behavior.
- Added scoped settings with builtin/global/project/temporary precedence, immutable safety policy, CAS, and atomic writes.
- Added `linger why`, provenance resolution, decision evolution, staleness, and explicit recall-quality sampling/feedback.
- Added a shared effective-search-document resolver so lexical recall, Why, Doctor, and derived indexes enforce the same
  source integrity, correction, revocation, sensitivity, and project boundaries.
- Added optional Local-only semantic recall for one validated Darwin/arm64 profile using multilingual-e5-base q8, immutable
  flat-f32 generations, lexical-first hybrid ranking, and deterministic fallback.
- Added explicit Local lifecycle commands for install plan, install, enable, rebuild, status, disable, index deletion, and
  runtime removal.
- Added stable local project identity for Git worktrees, clone isolation, remote-change diagnostics, pure `project-id`, and
  explicit fail-closed attachment for moved empty locators.

### Changed

- Linger now supports Node.js 22 and 24 only; unsupported majors fail before state mutation.
- Installer, hooks, launchers, health, uninstall, and project identity handling were tightened for v0.2.2 upgrades and
  user-owned host configuration. Managed Skill/runtime replacement now stages and validates before atomic target swap.
- Search and recall now use bounded effective settings and report hybrid/degraded retrieval mode without upgrading
  semantic-only candidates into exact evidence.
- Public privacy and security documentation now separates host-model enrichment from on-device Local Embedding.

### Security

- The Local artifact path uses fixed HTTPS sources and integrity/size/request limits, a safe tar extractor, fixed dependency
  graph, zero package-manager/lifecycle execution, private permissions, and a complete installed-content hash manifest.
- Local workers verify the installed tree before launch, disable remote model loading/cache writes/network fetch, and reject
  sensitive inputs.
- API/Remote Embedding code, configuration, credential, and documentation surfaces are absent from v0.3.0.

### Migration

- Existing Raw, Processed, Decision, and enrichment evidence remains in place; new settings default safely and Local
  Embedding remains off until explicitly installed and enabled.
- Exact v0.2.2 project registrations are reused. Repository/directory moves require an explicit empty-locator attachment;
  Linger refuses automatic data-scope merging.
- Uninstall continues to preserve the Vault and host-owned memory. Full purge remains a separate double-confirmed action.

## 0.2.2 — 2026-07-14

### Added

- Added a Simplified Chinese README with bidirectional language navigation.

### Changed

- Reframed Linger as a sidecar continuity layer for Claude Code, Codex, and future adapters.
- Preserved host-owned memory settings and files instead of replacing the host's persistence path.
- Clarified that duplicated host and Linger context represents one underlying event, not independent corroboration.
- Added an npm-compatible `linger-skill` executable so the documented `npx linger-skill install` command resolves directly.
- Published the first npm-distributed MVP with `npx linger-skill install` as the recommended installation path.
- Included the changelog, privacy policy, and security policy in the npm artifact.
- Identified Ari Shana as the MIT copyright holder.

### Fixed

- Upgrades now restore the Claude Code auto-memory setting left by the earlier replacement-style installer before adopting the sidecar contract.
- Hook context now prevents duplicate Linger writes without suppressing host-owned memory behavior.

## 0.2.1 — 2026-07-13

### Added

- Optional host-model enrichment using the model already active in Claude Code or Codex.
- Verified lifecycle capture, deterministic processing, bounded enrichment overlays, and sourced recall for both MVP adapters.
