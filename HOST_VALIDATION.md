# Host validation evidence

Validation date: 2026-07-12

This file records observed host behavior separately from repository-level handler tests. It does not treat copied files or inferred schemas as end-to-end capture proof.

## Codex

Host inspected: `codex-cli 0.144.0-alpha.4`, bundled with ChatGPT.app on macOS arm64.

### Confirmed

- `codex features list` reports `hooks` as stable.
- The locally generated app-server schema exposes `hooks/list` and the events `sessionStart`, `userPromptSubmit`, and `stop`.
- Continuity was installed into a disposable `/tmp` home. No real `~/.codex` files were changed.
- A local Codex app-server was initialized without starting a model turn, then `hooks/list` parsed the generated `hooks.json` for this repository.
- The response contained exactly three enabled command hooks: `sessionStart`, `userPromptSubmit`, and `stop`.
- `sessionStart` preserved matcher `startup|resume|compact`; all hooks parsed `timeoutSec: 10` and the expected status message.
- The response contained no hook warnings or errors.
- All three hooks reported `trustStatus: untrusted`. Installation alone therefore does not authorize execution.

### Not yet confirmed

- User trust/review interaction in the Codex UI.
- Execution of the command hook during a real prompt and completed answer.
- Exact live payload values for `prompt`, `last_assistant_message`, session/turn IDs, and cwd.
- Interrupted-answer behavior. The current Codex event schema does not expose `StopFailure`; Continuity only handles it when a host supplies it.
- Windows execution of `commandWindows`.

Current evidence supports: the generated Codex configuration is accepted by this host version and is surfaced for trust review. It does not yet support claiming automatic end-to-end capture.

As a result, `continuity capabilities` reports this static Codex installation as L1 even when `hooks.json` is present. A future host probe may raise it only after trust and live execution are demonstrated.

## Claude Code

Host inspected: Claude Code `2.1.207` native build (`bc512d563325`) on macOS arm64. The executable is `/Users/arishana/.local/bin/claude`; `~/.local/bin` was not in the Codex shell PATH, which caused the earlier discovery miss.

### Confirmed

- Continuity was installed into a disposable `/tmp` home. No real `~/.claude` files were changed.
- `claude doctor` parsed the disposable installation without reporting invalid settings or hooks.
- One non-interactive failure-path session used an invalid test key and local-unreachable API endpoint. SessionStart and UserPromptSubmit hooks exited 0, the user event/queue item persisted, and interrupting retry did not create a fake completed assistant event. Claude reported zero tokens and `$0` cost.
- A second non-interactive session used a temporary Anthropic-compatible HTTP stub bound only to `127.0.0.1`. No external model/provider was called. The stub returned fixed assistant text and synthetic one-token usage; Claude's displayed `$0.00003` was local usage accounting, not an external charge.
- Claude emitted successful `SessionStart:startup`, `UserPromptSubmit`, and `Stop` lifecycle events; all three Continuity commands exited 0.
- The disposable Vault contained a user raw event (`pending`) and assistant raw event (`complete`) with the exact fixed texts, the same real Claude session ID and turn ID, current project ID, normal sensitivity, and `source_agent: claude-code`.
- Both events had persistent normal-priority queue items with zero attempts.

### Not yet confirmed

- Host-native interrupted assistant output and whether a future event can provide a partial message payload.
- Long-running/multi-window behavior and Windows execution.

Current evidence supports Claude Code L2 for SessionStart, user-prompt, and completed assistant capture on version `2.1.207`. Partial/interrupted host semantics remain unverified.

## Reproduction boundary

The Codex check used a disposable `CODEX_HOME`, generated protocol schema, `initialize`, and `hooks/list`. It did not invoke a model, submit a conversation, bypass hook trust, or alter the maintainer's real host configuration.

The Claude checks used disposable homes. One exercised the failure path through a local-unreachable endpoint; the other used a loopback-only fixed-response stub to complete Stop without an external model. Neither changed the maintainer's real host configuration or contacted an external inference provider.
