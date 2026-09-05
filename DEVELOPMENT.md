# v1.1.0 development candidate

Base: `d56ea22` (local main/origin/main, post-v1.0.0). Candidate branch: `codex/linger-v1.1.0-candidate`. This is a local handoff for the separate ablation task; no push, publication, release/tag creation, or production installation is authorized here.

## Decisions

- CLI: the observed machine still has a v0.2.2 manifest without `cli_launchers`. v1.0.0 also chooses launcher location from the install process PATH, drops the previous path on relocation, and copies only `dist` into its managed runtime. Fix the package closure and use one deterministic POSIX entry (`~/.local/bin/linger`; Windows retains `~/.linger/bin/linger.cmd`). Refresh existing managed legacy entry paths for compatibility. Report PATH setup without editing shell profiles. Always supply the trusted hook CLI locator, including when enrichment is empty.
- Tags: keep schema-v1 Tag Registry and Term Graph. Discover candidates on demand with the existing Local E5 worker and ephemeral tag vectors; no tag index, new model, service, database, or vector-bearing registry. Bound each request to a small subset and report coverage.
- Relations: explicit typed, evidence-backed writes into the existing Term Graph; cosine similarity never assigns a relation. Only confident equivalence types expand one hop. Contextual equivalence needs matching context; related/ambiguous do not expand. Preserve exact lexical rank and confidence boundaries.
- Compatibility: use existing effective search documents for eligibility and evidence. No Vault/content/config migration; old registries and relations remain readable. Local candidate discovery is optional, and lexical search does not depend on it.
- Tag spelling: `tag_terms` adds an in-memory projection of effective ordinary/predictive tags without changing canonical text, index identities, or lexical tag boosts. Graph pair matching and vetoes share a space/hyphen key; expansion retains literal and normalized token forms so a Registry key can find its original tag text. Legacy `location_mapping`/`product_name` are preserved as curated mappings.

## Verification and handoff

- Environment: macOS/arm64, Node 26.7.0. The available pnpm 11 wrapper attempted registry policy checks even in offline mode; build used the already cached lockfile-matching TypeScript 5.9.3 / @types/node 24.13.3 / undici-types 7.18.2. No dependency or lockfile changes.
- Root-cause reproduction on unmodified `d56ea22`: temporary-HOME install with no user bin on PATH chose `.linger/bin/linger`; managed `version` failed with ENOENT for `runtime/1.0.0/package.json`, and `embedding-install-plan` failed with ENOENT for `local-runtime-manifests/...json`. The observed production v0.2.2 manifest had no launcher field; it was read only.
- `pnpm test`: 212/212 pass, including the fixed semantic cases below and existing compatibility/hybrid tests. The final spelling change also passed its focused 14-test regression before the final full run.
- `node scripts/package-smoke.mjs`: actual npm pack + offline temporary npm install; both npm aliases; delete original package; managed version/install-plan/reinstall; fresh-shell PATH invocation; capture → recall → uninstall; Vault retained; 14 required package files and zero forbidden files. Cache and HOME are temporary.
- Real upgrade check: archive `d56ea22`, compile with the same TypeScript dependencies, install into a temporary HOME with `/usr/bin:/bin` PATH, capture/process a known record, then install this candidate. Both new `.local/bin/linger` and old `.linger/bin/linger` returned 1.1.0; a fresh shell resolved bare `linger`; old-record search succeeded; raw/processed bytes and embedding intent were unchanged. v0.2.x install-marker/manifest compatibility is covered by the existing legacy fixtures (no local v0.2.2 tag is available).
- Skill validation, tracked-secret scan, local release-metadata check, and `git diff --check` pass. Metadata validation is not release authorization. Large year/adversarial/held-out eval runs were intentionally outside this bounded development task; their unit tests are included in `pnpm test`.

| Fixed acceptance case | Result |
| --- | --- |
| automobile ↔ car / db ↔ database | Explicit synonym/abbreviation expands; original lexical exact hit ranks first; expansion-only confidence stays reduced |
| storage ↔ postgresql | Related / narrower concept; no expansion despite high candidate similarity |
| enable ↔ disable | Opposites recorded as non-equivalent `related`; no expansion |
| cc ↔ compiler | Ambiguous; no expansion |
| GC ↔ garbage collector | Explicit context required; case/space/hyphen variants share curation and ambiguity veto |
| Old records / stale tags / missing runtime | Existing lexical recall preserved; forgotten tags excluded; unavailable suggestions return normalized exact names |

## Change size and next-task questions

| Changed files | Purpose |
| --- | --- |
| `src/runtime-installer.ts`, `src/hook-handler.ts`, `src/cli.ts` | Stable package closure/launchers, trusted hook locator, CLI surface/help |
| `src/tag-registry.ts`, `src/term-graph.ts`, `src/effective-search-document.ts`, `src/search.ts`, `src/schema-validation.ts` | Eligible Tag discovery, explicit relation curation, normalized one-hop expansion |
| `src/local/embedding-index.ts`, `src/local/local-embedding-runtime.ts` | Reuse vector math and existing Local worker; no index format change |
| `src/cli.test.ts`, `src/enrichment.test.ts`, `src/hook-handler.test.ts`, `src/install-cli.test.ts`, `src/installer.test.ts`, `src/tag-registry.test.ts`, `src/term-graph.test.ts` | Focused acceptance and regression cases |
| `scripts/package-smoke.mjs`, `package.json` | Real temporary npm lifecycle checks; candidate version |
| `README.md`, `README.zh-CN.md`, `UPGRADING.md`, `CHANGELOG.md`, `skills/linger/SKILL.md`, `skills/linger/references/protocol.md`, `DEVELOPMENT.md` | Synchronized product boundaries and this one development/handoff log |

- 10 existing production TypeScript files: +244 / -51 lines (net +193). Seven existing test files: +153 / -7 (net +146). Package smoke: +21 / -11. No production files/modules or dependencies added/deleted. The only new tracked file is this compact log; package version, both READMEs, upgrade notes, Changelog, CLI help, and installed Skill/protocol are synchronized.
- No source/content/config/index migration. Existing Tag Registry/Term Graph shapes and IDs are readable. New pairs are explicitly upserted by normalized pair/context; no vectors or similarity-derived confidence are persisted. The deliberately narrower related/contextual expansion behavior is documented for rollback.
- **Real E5 Tag quality remains unmeasured here.** This machine has no usable pinned v24.14.0/E5 runtime. Controlled vectors validate orchestration and safety semantics; they are not model-quality evidence. No model was downloaded or formally installed for this task.
- Ablation should check whether the 128-tag usage cap and in-memory recomputation are adequate for the intended small project scope; low-frequency tags beyond the cap are not considered. There is no calibrated Tag similarity threshold or quality claim.
- Inspect whether `tag_terms`, the two reused vector helper exports, phrase/token normalization, and returned candidate fields can be reduced while retaining old data, multiword Tag closure, exact priority, and ambiguity vetoes. Do not add a separate cache/index merely to remove recomputation.
- Curation checks referenced source integrity at write time; semantic correctness remains the curator's responsibility. Legacy graph evidence is read under the existing compatibility contract, without a new automatic relabeling or evidence migration. Document-level semantic candidates are still independent of term-graph non-equivalence.
- Stop at this branch. Independent ablation, final review, release material approval, GitHub/npm publication, and the final production-computer upgrade remain for the parent workflow. No other tasks were created or contacted, and no production installation was changed.
