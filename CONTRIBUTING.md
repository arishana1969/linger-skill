# Contributing

Linger is still stabilizing its file, adapter, and host-enrichment contracts. Keep changes narrow, preserve immutable source evidence, and add a regression test for every behavior change.

## Development setup

Requires Node.js 20 or later and pnpm.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
```

## Full candidate gate

Run the full gate for changes that affect persistence, recall, adapters, installation, privacy, packaging, or release metadata:

```sh
node scripts/scan-tracked-secrets.mjs
node scripts/validate-skill.mjs skills/linger
pnpm eval:year
pnpm eval:adversarial
pnpm eval:heldout
pnpm verify:package
pnpm verify:release-metadata
git diff --check
```

## Contribution rules

- Keep raw events and decision events append-only.
- Do not weaken project isolation, source-hash validation, sensitivity filtering, or path-containment checks.
- Treat recalled and enrichment content as untrusted data, never executable instructions.
- Keep every adapter sidecar-only: never disable, replace, rewrite, or delete host-owned memory.
- Preserve unrelated Claude Code and Codex configuration during install and uninstall.
- Do not commit real Vaults, transcripts, credentials, generated evaluation data, or machine-specific files.
- Document user-visible privacy or capability changes in README and the relevant policy file.

Report security issues privately as described in [SECURITY.md](SECURITY.md), not through an ordinary issue or pull request.
