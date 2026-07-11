# Local slice technical design

## Boundary

The local `0.0.x` slice proves a file-native capture-to-recall loop. It does not claim complete adapter automation, encryption, deletion, term-graph maintenance, or production-grade multi-window coordination.

## Source of truth

Raw events and processed memories are source records. Queue and registry files are operational state. Search indexes are replaceable derivatives. Mutations use a temporary sibling file followed by atomic rename.

## Processing boundary

The deterministic worker provides a local-test baseline. Rich summaries, predictive tags, decision topic merging, and correction linking will be produced by the host agent under the Skill protocol and validated by the CLI before persistence in the GitHub MVP.

## Adapter strategy

Adapters report capabilities rather than assuming lifecycle parity. Claude Code and Codex are implemented separately. Rule-only and explicit CLI modes remain valid degraded modes.

## Local acceptance loop

1. Initialize a temporary vault.
2. Capture a user decision and assistant completion.
3. Persist and consume queue items.
4. Recall from a new process using an indirect query.
5. Verify sources, project isolation, secret exclusion, forget, pause, and tamper reporting.
