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

Supported lifecycle events are `SessionStart`, `UserPromptSubmit`, and `Stop`. Capture errors must not block the conversation.

## Claude Code

The adapter merges command hooks into `~/.claude/settings.json`. User configuration remains intact.

## Codex

The adapter writes and merges `~/.codex/hooks.json`. Codex requires review and trust for non-managed command hooks. The adapter does not also write inline hooks to `config.toml`.

## Capability reporting

Copying a Skill yields at most L1. Verified hook configuration yields L2. L3 and L4 require additional processing and recovery behavior and must not be inferred from installation alone.

## Current limitations

The generated hook command is POSIX-oriented. Windows command overrides, real interrupted-answer coverage, host-version probing, and multi-window conflict testing remain GitHub MVP work.
