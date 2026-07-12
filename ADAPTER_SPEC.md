# Adapter specification

An adapter installs the Continuity Skill and optionally lifecycle hooks without changing the vault schema.

## Shared events

The local slice consumes these verified shared hook fields:

- `session_id`
- `turn_id` when available
- `cwd`
- `hook_event_name`
- `prompt` for `UserPromptSubmit`
- `last_assistant_message` for `Stop`
- `model` when available

Both adapters install `SessionStart`, `UserPromptSubmit`, and `Stop`. Claude Code additionally installs its observed `StopFailure` event and records `last_assistant_message` as partial evidence. The current Codex schema does not expose StopFailure, so the Codex adapter does not write that unsupported event. Capture errors must not block the conversation.

## Claude Code

The adapter merges command hooks into `~/.claude/settings.json`. User configuration remains intact.

Claude Code `2.1.207` has been observed executing SessionStart, UserPromptSubmit, Stop, and StopFailure hooks in disposable homes. User-pending and assistant-complete events retained the same real session/turn IDs. StopFailure marks API errors partial, but a Ctrl-C path did not preserve already-streamed assistant text; see `HOST_VALIDATION.md`.

## Codex

The adapter writes and merges `~/.codex/hooks.json`. Codex requires review and trust for non-managed command hooks. The adapter does not also write inline hooks to `config.toml`.

## Capability reporting

Copying a Skill yields at most L1. Verified hook configuration yields L2. L3 and L4 require additional processing and recovery behavior and must not be inferred from installation alone.

## Current limitations

Hook entries include both the POSIX command and a PowerShell `commandWindows` override. Windows execution still needs a real-host smoke test. Real interrupted-answer coverage, host-version probing, trust/review UX, and multi-window conflict testing remain GitHub MVP work.
