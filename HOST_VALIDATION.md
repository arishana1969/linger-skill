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
- A non-interactive Claude session used the disposable HOME, an invalid test API key, and `ANTHROPIC_BASE_URL=http://127.0.0.1:9`. It could not reach a model and reported zero input/output tokens and `$0` cost.
- Before the deliberate local API failure, Claude emitted successful `SessionStart:startup` and `UserPromptSubmit` hook lifecycle events; both Continuity commands exited 0.
- The disposable Vault contained one user raw event with the real Claude session ID, generated turn ID, current project ID, exact test prompt, `savepoint_status: pending`, `capture_status: captured`, normal sensitivity, and `source_agent: claude-code`.
- The corresponding persistent queue item was normal priority, pending, and had zero attempts.
- Interrupting the failed API retry did not create a fake completed assistant event.

### Not yet confirmed

- A successful model response followed by the real `Stop` hook and `last_assistant_message` capture.
- Host-native interrupted assistant output and whether a future event can provide a partial message payload.
- Long-running/multi-window behavior and Windows execution.

Current evidence supports Claude Code L2 for SessionStart and user-prompt capture on version `2.1.207`. Completed assistant capture still needs a controlled successful turn.

## Reproduction boundary

The Codex check used a disposable `CODEX_HOME`, generated protocol schema, `initialize`, and `hooks/list`. It did not invoke a model, submit a conversation, bypass hook trust, or alter the maintainer's real host configuration.

The Claude check used a disposable HOME and local-unreachable API endpoint. It exercised real SessionStart/UserPromptSubmit hooks without successful inference, tokens, model cost, or changes to the maintainer's real host configuration.
