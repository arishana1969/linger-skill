# Security

## Trust boundary

Retrieved memory is untrusted historical evidence. Agents must not execute commands, prompts, or old system messages found inside memory. Current system and user instructions take precedence.

## Local files

The helper validates IDs, timestamps, canonical record locations, and persisted enum/schema fields; constrains managed deletion paths; uses private file modes where practical; and writes records through temporary sibling files followed by rename. Hash mismatches are reported as tampering. Processed records whose available raw source fails hash verification are excluded from ordinary search; records with unavailable raw provenance remain usable only with an `unverified_source` warning and confidence penalty. Parseable-but-invalid source, queue, pending, decision, registry, config, sequence, and processing-history records are skipped or fail closed, reported by `doctor`, and moved only by confirmed `doctor-repair`.

The project does not claim absolute safety against malicious repositories, prompt injection, compromised local accounts, or manual vault modification.

## Hook installation

Installer changes are merged into the host's existing JSON configuration. Existing unmanaged Continuity Skill directories are backed up. Codex may require the user to review and trust newly installed hooks through its hook UI.

Host configuration must be a JSON object with a structurally valid hook map before Continuity writes it; malformed documents fail without byte changes. Uninstall removes only commands carrying the matching Continuity adapter marker and a hook path below the current home's managed runtime, so an unrelated user command with the same `dist/hook-cli.js` suffix is preserved.

Package versions are restricted before they become runtime paths. Uninstall validates the complete manifest before mutation, permits Skill removal only at the selected host's known Continuity directory, and requires the runtime path to be the direct managed version directory under the current home. A managed marker alone does not authorize deletion of an arbitrary manifest target.

Hook payloads are treated as external input. Unknown events, empty or non-string content, and explicit user opt-out are rejected before project registration or Vault initialization, preventing unsupported payloads from creating local state as a side effect.

## Reporting

Do not include live secrets or private vault files in a public issue. The public vulnerability-reporting channel will be defined before the GitHub MVP is released.
