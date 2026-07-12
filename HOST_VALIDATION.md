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

No `claude` executable was present on the validation machine. Repository tests cover configuration merge and handler payloads, but no real Claude Code host evidence has been collected.

## Reproduction boundary

The Codex check used a disposable `CODEX_HOME`, generated protocol schema, `initialize`, and `hooks/list`. It did not invoke a model, submit a conversation, bypass hook trust, or alter the maintainer's real host configuration.
