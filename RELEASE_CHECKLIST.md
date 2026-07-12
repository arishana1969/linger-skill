# Release checklist

Use this checklist for the first GitHub MVP and any npm prerelease. Repository checks are automated where possible; identity, licensing, remote hosting, and publication remain explicit maintainer decisions.

## Maintainer decisions

- [ ] Choose and add an open-source `LICENSE`; set the matching SPDX value in `package.json`.
- [ ] Confirm the public GitHub repository name and URL; add `repository`, `homepage`, and `bugs` metadata.
- [ ] Confirm ownership and availability of the npm package name `continuity-skill`, or choose a scoped name.
- [ ] Define a private vulnerability-reporting contact in `SECURITY.md` before accepting public security reports.
- [ ] Review the install-time privacy notice and the limitations in `PRIVACY.md` and `AGENT_COMPATIBILITY.md`.

## Repository gate

Run from a clean checkout with Node 20 or later and pnpm:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
python scripts/validate-skill.py skills/continuity
pnpm eval:year
pnpm eval:adversarial
pnpm verify:package
git diff --check
git status --short
```

Expected result: all tests and validators pass, both deterministic evaluation gates report macro composite `1.0`, the packed-package smoke test succeeds, and the worktree is clean. The generated scores are regression baselines, not general-quality claims.

## Host smoke gate

For each supported host/version, use a disposable home or profile and record exact version and observed event payloads:

- [ ] Claude Code: install twice; verify user config preservation and no unmanaged backup loss.
- [ ] Claude Code: capture `SessionStart`, user prompt, completed answer, and interruption if the host exposes it.
- [ ] Codex: install twice; verify hook trust/review behavior and user config preservation.
- [ ] Codex: capture the lifecycle events actually exposed by the installed surface; document any degraded rule/file mode.
- [ ] Both: restart after pending capture; verify recovery and queue processing.
- [ ] Both: uninstall and verify the Vault remains; run purge only in the disposable home.
- [ ] Windows: execute the PowerShell hook command on a real host before advertising Windows support beyond generated configuration.

Do not report L3/L4 from installed files alone. Save capability output and host evidence with the release notes.

## Artifact gate

- [ ] Inspect `pnpm pack --json --dry-run`; `pnpm verify:package` must report zero forbidden files and exclude tests, fixtures/oracles, source transcripts, Vault data, and credentials.
- [ ] Confirm README, privacy/security documents, data model, adapter/compatibility documents, runtime files, and Skill metadata are in the tarball.
- [ ] Install from the exact `.tgz` intended for publication in a clean environment with network disabled after artifact creation. `pnpm verify:package` must report `package_manager_install: true`.
- [ ] Verify `continuity install`, `capabilities`, capture/recall, `uninstall`, and Vault preservation from that artifact.
- [ ] Check the package version and Git tag agree.

## Publication gate

- [ ] Push the reviewed commit and tag to the confirmed GitHub repository.
- [ ] Wait for GitHub CI to pass on the tag.
- [ ] Publish a prerelease first if host validation is incomplete; keep experimental status prominent.
- [ ] Run `npm publish` only from the verified artifact/commit and only after maintainer approval.
- [ ] Test the public `npx -y <package> install --yes` path on a clean machine.
- [ ] Record known limitations and rollback/uninstall instructions in the release notes.
