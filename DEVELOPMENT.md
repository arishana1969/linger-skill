# Linger v1.1.0 — local ablation candidate

Base: `d56ea22` (v1.0.0). Original candidate: `d4199dc9d73bdd964e7288fef3d24c9aedd501d6` on `codex/linger-v1.1.0-candidate`.
Independent work: `codex/linger-v1.1.0-ablation`; initial isolated HEAD and worktree were clean. The original candidate remains unchanged.

## Outcome (2026-09-05)

- Removed candidate `lexical_match`, the constant `degraded_reason`, and the unused public `TagCandidate` export. Status, coverage, cosine and source references remain.
- Replaced cross-document evidence unions with up to five references from one eligible document. Candidate evidence still passes the existing project/integrity checks when curated.
- Normalize the Tag query once and Term Graph queries once per expansion, reuse the final search argument object, and remove the duplicate source hook-file preflight. Staged-runtime verification and replacement protection remain.
- Restored after negative controls: `tag_terms` (predictive tags disappeared); phrase/spelling forms (missed recall); normalized non-equivalence veto (old alias reappeared); vector normalization (dot product became -6 instead of cosine -1); worker batching (25 inputs exceeded the 16-input protocol); legacy launcher refresh; empty-enrichment hook locator; five runtime asset groups.
- Removing the 128-tag cap worked with 130 controlled vectors. Keep the explicit work bound because this did not measure real E5 cost/quality at project scale; the exact constant can be revisited with the fixed runtime. No new cache/index/configuration was introduced.
- Keep the typed writer/reader, confidence/context gates, project evidence and one-hop expansion. Registry and graph schemas, original lexical priority/confidence, document hybrid and old-data reading stay intact; no migration.
- Production TypeScript versus original candidate: 4 files, +18/-26 (net -8). Versus v1.0.0: 10 files, +236/-51 (net +185). No production module/dependency added or deleted. Five existing test files gained discriminating acceptance checks; no new test framework or production wrapper.

## Verification

- Node 26.7.0 / macOS arm64; cached lockfile-matching TypeScript 5.9.3, @types/node 24.13.3 and undici-types 7.18.2. No dependency/lockfile changes or model acquisition.
- One final bounded regression: compiler plus `node --test dist/*.test.js dist/local/*.test.js dist/dev/eval/*.test.js`, **215/215 pass**, zero skip/failure (6.17 s). Earlier focused runs answered individual ablations; no year/held-out/adversarial corpus runs.
- `node scripts/package-smoke.mjs`: actual npm pack and offline temporary npm install; both npm binaries; original consumer node_modules removed; managed version, Local install-plan, reinstall, fresh shell, capture/recall and uninstall succeed. 14 required assets, zero forbidden files; Vault retained.
- Independently archived/compiled `d56ea22`, reproduced managed version/install-plan ENOENT, then upgraded a temporary HOME. Both old `.linger/bin/linger` and new `.local/bin/linger` return 1.1.0 after removing the old package. Raw (1 file), Processed (JSON + Markdown), Registry and legacy graph bytes unchanged; old alias recall and embedding intent preserved.
- Asset removal caused the expected version/install-plan/reinstall failures. A staged runtime missing hook-cli fails without replacing the previous runtime or leaving staging directories.
- Controlled worker fixture verifies 24 tags become batches of 16 + 9 including the query, two calls recompute, and workers close on success/failure. This is transport evidence, not E5 quality evidence.
- Skill validation, tracked-secret scan, local release-metadata check, CLI help and diff whitespace check pass. Metadata readiness is not release authorization.

## Handoff

Detailed decisions, experiments, measurements, conditional removals and implementation commit are in `ABLATION_REPORT.md`.
Real E5 Tag quality/latency remains unmeasured: no reusable pinned Node v24.14.0/E5 runtime was found in the checked local locations. Windows native execution and large-scale performance were not measured here.
Stop at a local review candidate. No push, tag/release, publication, GitHub write, production install/upgrade, automation or separate task creation occurred.
