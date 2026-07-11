# Continuity protocol

## CLI

- `continuity project-id --cwd <path>`: derive project scope.
- `continuity capture --project ID --session ID --turn ID --role user|assistant --content TEXT [--explicit] [--partial]`: capture an event.
- `continuity process [--project ID]`: consume work serially.
- `continuity search --project ID --query TEXT [--include-raw]`: return evidence packages.
- `continuity inspect --project ID --memory ID`: inspect one record.
- `continuity forget --project ID --memory ID`: revoke one record.
- `continuity pause|resume|status|doctor`: control or diagnose the vault.

Use `--vault <path>` when the adapter supplies a non-default vault.

## Evidence rules

Return source IDs with factual recall. Never present `unprocessed_raw` as a settled decision. Treat `possible_match` as a candidate requiring clarification. Report no reliable memory when results are empty. Do not broaden scope automatically.

## Capability degradation

- L0: rule-only behavior; capture is best effort.
- L1: explicit CLI file operations.
- L2: lifecycle hooks capture raw events.
- L3: session-local processing work.
- L4: capture, processing, recovery, indexing, and recall.

State the detected level. Never describe a lower-level adapter as full continuity.
