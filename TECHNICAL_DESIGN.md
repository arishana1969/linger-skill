# Local slice technical design

## Boundary

The local `0.0.x` slice implements a file-native capture-to-recall loop, destructive controls, a minimal evidence-backed term graph, bounded search, and deterministic evaluation. It does not claim complete adapter automation, encryption, sophisticated semantic processing, or production-grade multi-window coordination.

## Source of truth

Raw events, processed memories, and decision events are source records. Queue, derived decision views, registries, and processing-run histories are operational or rebuildable state. Mutations use a temporary sibling file followed by atomic rename.

## Processing boundary

The deterministic worker provides a local baseline for summaries, content/predictive tags, retrieval phrases, decision extraction, correction linking, and registry updates. These outputs are deliberately lexical and heuristic. Richer host-agent processing and decision-topic merging are future improvements and must preserve the same evidence and validation boundaries.

Search ordering is deterministic: lexical match tier first, then `user_explicit` priority within that tier, then lexical score and confidence. Unprocessed raw evidence remains below processed possible matches and carries its warning/partial penalties.

Successful hook captures run an event-driven scheduling decision. Explicit work, a 50KB pending threshold, or an exceeded maximum wait can trigger bounded serial processing; below-threshold captures return without consuming the queue. SessionStart also recovers pending writes and evaluates the queue. This is not a daemon or a guaranteed timer during an idle long-running session.

Automatic runs bound both item count and estimated input tokens (characters divided by four, default 16K). Once at least one item is consumed, an item that would exceed the remaining budget stays pending for the next run. A single oversized first item is allowed to prevent permanent starvation. This deterministic worker does not claim provider-billed token accuracy.

The deterministic worker skips non-explicit assistant chatter shorter than the configured 20-character baseline unless it contains a durable decision/preference/constraint signal. The raw event remains intact and may still be inspected explicitly.

## Adapter strategy

Adapters report capabilities rather than assuming lifecycle parity. Claude Code and Codex are implemented separately. Rule-only and explicit CLI modes remain valid degraded modes.

## Local acceptance loop

1. Initialize a temporary vault.
2. Capture a user decision and assistant completion.
3. Persist and consume queue items.
4. Recall from a new process using an indirect query.
5. Verify sources, project isolation, secret exclusion, forget, pause, and tamper reporting.
6. Run the separated year fixture/oracle, adversarial, and 250+-event held-out regression gates through real temporary Vaults; apply declared raw mutations only after processing and score provenance warnings.
