# Changelog

Notable user-visible changes to Linger are recorded here.

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
