# Agent compatibility

Continuity uses one vault format across adapters, but automation levels differ by host and installed version.

| Adapter | Local slice | Target MVP | Notes |
| --- | ---: | ---: | --- |
| Claude Code | L0-L2 | L2-L4 | Claude Code `2.1.207` live-smoke confirms SessionStart, user-prompt, and completed assistant/Stop capture in disposable homes without an external model. Partial interruption remains. |
| Codex | L0-L1 | L1-L3 | Current Codex `0.144.0-alpha.4` accepts the generated three-hook configuration in `hooks/list`, but reports it untrusted. Static capability reporting therefore remains L1 until trust and live execution are verified. |

Levels are reported from detected artifacts, not marketing claims:

- L0: rule-only or not installed.
- L1: Skill plus explicit file/CLI operations.
- L2: lifecycle hook capture.
- L3: session-local asynchronous processing.
- L4: capture, processing, recovery, indexing, and recall.

The installer must never report L4 merely because files were copied successfully.

See [HOST_VALIDATION.md](HOST_VALIDATION.md) for versioned host evidence and the distinction between configuration parsing and live capture.
