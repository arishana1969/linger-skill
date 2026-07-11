# Agent compatibility

Continuity uses one vault format across adapters, but automation levels differ by host and installed version.

| Adapter | Local slice | Target MVP | Notes |
| --- | ---: | ---: | --- |
| Claude Code | L0-L2 | L2-L4 | Hook coverage must be probed on the installed version. |
| Codex | L0-L2 | L1-L3 | Skill and file mode are baseline; final-answer capture is capability-dependent. |

Levels are reported from detected artifacts, not marketing claims:

- L0: rule-only or not installed.
- L1: Skill plus explicit file/CLI operations.
- L2: lifecycle hook capture.
- L3: session-local asynchronous processing.
- L4: capture, processing, recovery, indexing, and recall.

The installer must never report L4 merely because files were copied successfully.
