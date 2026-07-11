# Continuity protocol

## CLI

Use `--vault <path>` when an adapter supplies a non-default vault.

- `continuity project-id --cwd <path>`: derive project scope.
- `continuity capture --project ID --session ID --turn ID --role user|assistant --content TEXT [--explicit] [--partial]`: capture an event.
- `continuity recover`: restore staged raw and queue records after interruption.
- `continuity process [--project ID]`: consume work serially.
- `continuity search --project ID --query TEXT [--include-raw]`: return evidence packages.
- `continuity inspect --project ID --memory ID`: inspect a record and its effective control state.
- `continuity forget --project ID --memory ID`: append a recall revocation while preserving raw and processed source records.
- `continuity correct --project ID --memory ID --summary TEXT --evidence EVENT_IDS [--reason TEXT]`: append a correction and supersede the old recall view.
- `continuity delete --project ID --type processed|raw --id ID --yes [--reason TEXT]`: delete only a confirmed, ID-addressed record.
- `continuity decision-add|decision-get|decision-list`: manage immutable decision trails.
- `continuity pause|resume|status|doctor`: control or diagnose the vault.
- `continuity install|uninstall|capabilities`: manage adapters. Uninstall requires `--yes` and preserves the vault.

## Evidence rules

Return source IDs with factual recall. Never present `unprocessed_raw` as a settled decision. Treat `possible_match` as a candidate requiring clarification. Report no reliable memory when results are empty. Do not broaden scope automatically.

A correction must cite visible evidence. Forget changes recall eligibility without rewriting history. Delete is materially different from forget and always requires explicit confirmation.

## Capability degradation

- L0: rule-only behavior; capture is best effort.
- L1: explicit CLI file operations.
- L2: lifecycle hooks capture raw events.
- L3: session-local processing work.
- L4: capture, processing, recovery, indexing, and recall.

State the detected level. Never describe a lower-level adapter as full continuity.
