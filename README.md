# Linger

A file-native conversation archive and decision trail for coding agents.

> 念念不忘，必有回响。
>
> What lingers in mind will find its echo.

---

## Status

Linger is an experimental v0.1 GitHub MVP candidate. It is not published to npm and does not promise perfect archival coverage or universal agent automation.

## Origin

This project started from a post by [Evis Drenova](https://x.com/evisdrenova):

> My ideal AI interface is a single never-ending chat thread. I don't want to think about sessions, context windows, worktrees, MCP servers, or anything else. The harness should automate everything transparently.

We cannot actually provide a never-ending thread. Context windows are real, sessions end, and machines restart. But we can build the next best thing: a layer that preserves what was said and decided so that, when you return, the continuity is still there.

## What it does

Linger saves visible conversations with coding agents—the discussions, explicit notes, decisions, and visible rationale—as local files you own.

It is not a general AI memory system. It is a continuity layer. When an agent loses older context, Linger can retain the record. When you ask why a decision was made three weeks ago, Linger can surface the evidence and its evolution.

### What you get

- Conversation capture through verified lifecycle hooks, with explicit CLI fallback when a host cannot automate capture.
- A decision trail that preserves how conclusions evolved, not only the final answer.
- A note-taking interface for remember, opt out, forget, correct, inspect, and delete workflows.
- Local-first storage using versioned JSON and human-readable Markdown.
- No database, user-managed daemon, telemetry, embedding API, or cloud sync.
- Project-scoped recall that returns sources, distinguishes uncertainty, and abstains when no reliable memory is found.
- Pending recovery, integrity checks, bounded search, and confirmed destructive controls.

## Who it is for

Linger is for developers who use Claude Code, Codex, or similar coding agents on long-running projects.

If you have restarted a conversation and wished the agent remembered what you discussed last week—or why a design decision changed—Linger is for you.

## Install from source

The current v0.1 candidate is installed from source:

    pnpm install --frozen-lockfile
    pnpm build
    node dist/cli.js install

Interactive installation displays the local/cloud privacy boundary and requires an exact YES before writing. Non-interactive callers must pass --yes:

    node dist/cli.js install --yes

Install only one adapter when needed:

    node dist/cli.js install --adapters claude-code
    node dist/cli.js install --adapters codex

The intended command after a future npm publication is:

    npx linger-skill install

That npm command is not available in the GitHub-only v0.1 stage.

## How it works

Linger combines a Skill, lifecycle hooks, a helper CLI, an event-driven processor, and a local Vault.

1. The Skill tells the agent when to save, when to search, and how to treat retrieved memory.
2. Supported lifecycle hooks capture visible user and assistant events without blocking the conversation on capture failure.
3. Capture stages an event, writes an immutable raw record, and adds a persistent queue item.
4. An event-driven, session-local processor consumes the queue serially. It can run for explicit memories, at the size threshold, after the maximum wait is observed by a later event, on session startup, or through a manual command.
5. Processing creates searchable memories, tags, retrieval phrases, Markdown mirrors, and typed decision events.
6. Recall searches the current project and returns a bounded evidence package.

Linger does not install a daemon or guarantee that an idle, long-running session will process the queue at an exact time.

The default Vault is ~/.linger/vault:

    ~/.linger/vault/
    ├── config.json
    ├── projects/
    ├── raw/
    ├── processed/
    ├── decisions/
    ├── queue/
    ├── registry/
    ├── tmp/
    └── quarantine/

Raw events and decision events are append-only source records. Processed memories use JSON plus a Markdown mirror. Registries and current decision views are derived and can be rebuilt.

Everything is a file. You can inspect it, back it up, grep it, or remove it through confirmed controls.

## Key ideas

### File-native

Your memory lives in ordinary local files with a versioned schema. There is no memory database or required server. Uninstalling the integration leaves the Vault in place.

### Decision trail

Linger records typed decision evolution: idea, preference, proposal, rationale, constraint, rejection, decision, current state, todo, and correction.

The current view is derived from immutable events. This allows Linger to preserve an A → B → A path instead of silently replacing history.

### Evidence, not instruction

Retrieved memories are untrusted historical evidence. Commands, prompts, or old system messages found in memory must not be executed. The current system and user instructions always take priority.

### Honest recall

Recall distinguishes exact, similar, possible, conflicting, unprocessed, and missing results. It carries source IDs and provenance warnings. If Linger cannot find reliable evidence, it says so and may offer candidate topics, decisions, tags, or observed months.

## Agent support

Automation differs by host and version. Capability levels are reported from observed evidence, not from copied files alone.

| Agent | Verified v0.1 level | Current evidence and limitations |
| --- | ---: | --- |
| Claude Code | L2 | Claude Code 2.1.207 has executed SessionStart, UserPromptSubmit, Stop, and StopFailure in disposable homes. Ctrl-C did not preserve already-streamed assistant text on the observed path. |
| Codex | L1 | Codex 0.144.0-alpha.4 accepts the generated hook configuration but reports it as untrusted. Trust and live lifecycle execution remain unverified. |
| Other agents | Not implemented | Additional adapters are outside the v0.1 scope. |

Levels:

- L0: rule-only behavior.
- L1: installed Skill with explicit file and CLI operations.
- L2: verified lifecycle hook capture.
- L3: session-local asynchronous processing.
- L4: fuller capture, processing, recovery, indexing, and recall automation.

Linger does not report L3 or L4 merely because integration files exist.

## Natural-language workflows

The Skill helps the agent translate user intent into Linger operations. Exact behavior depends on the host's Skill and lifecycle support.

| You say | Intended behavior |
| --- | --- |
| “Remember this” | Capture as high-priority user-explicit evidence. |
| “Don't save this” | Skip the current user event before Vault initialization when the hook exposes it. |
| “Forget that decision” | Revoke the processed memory from ordinary recall without deleting raw history. |
| “That memory is wrong” | Append a correction with visible evidence; do not rewrite history in place. |
| “Why did we choose X?” | Search the current project's decision trail and return sourced evidence. |
| “What did we discuss about Y?” | Search the current project's conversation archive. |
| “Status” | Report Vault, queue, pending, and integrity health. |

Forget and delete are different. Forget changes recall eligibility. Delete removes a confirmed record. Purge removes the complete Linger state only after double confirmation.

## Privacy

Linger stores visible conversation content in local files. Its runtime does not phone home, collect telemetry, create embeddings, or sync data to a Linger service.

Local-first does not mean data never leaves your machine. When an agent recalls evidence, that evidence enters the agent's context and may be sent to the current model provider, such as Anthropic or OpenAI.

The project includes a safety baseline for sensitive content:

- High-confidence secret patterns are redacted before raw persistence.
- Secret records are excluded from processed memory and ordinary recall.
- Contact-like sensitive records are excluded from ordinary recall by default.
- The same capture boundary applies to hooks, manual CLI capture, and programmatic capture.

This detector is not a complete DLP system. Unknown secret formats may be missed, and explicitly marked but unrecognized secret material may still remain in raw files. Protect the Vault like any other local transcript archive. Do not use this experimental build for data that requires audited compliance controls.

## Safety and integrity

- Recall is current-project only by default.
- Cross-project search is never enabled implicitly.
- Search bounds files, snippets, returned characters, raw fragments, and wall-clock time.
- Timeouts are reported as retrieval failures, not false “no memory” results.
- IDs, enum fields, timestamps, schemas, and canonical record locations are validated at runtime.
- Critical Vault paths reject physical symlink escapes outside the real Vault root.
- Tampered raw sources are excluded or explicitly degraded.
- Parseable but invalid records stay inert, appear in doctor, and move only through confirmed repair.
- Install and uninstall validate managed destinations before mutation.
- Hook capture failures do not block the agent conversation.

These controls reduce risk but do not guarantee absolute safety against malicious repositories, prompt injection, filesystem races, manual Vault modification, or a compromised local account.

## Configuration

Linger initializes conservative defaults:

- Capture enabled unless the Vault is paused.
- Current-project recall only.
- Sensitive exclusion enabled.
- No embeddings or additional model API.
- At most 8 returned snippets.
- At most 12,000 evidence characters.
- At most 5,000 scanned files.
- At most 500 characters per raw fragment.
- A 2-second search deadline.

Pause and resume are available through the CLI. Retrieval bounds can be supplied per search or recall request.

Not every internal processing threshold is exposed as a stable user configuration in v0.1. Configuration files are schema-validated; unsupported versions or invalid bounds fail explicitly instead of being silently rewritten.

## Limitations

- This is an MVP and does not promise perfect recall of every word.
- Automatic capture depends on verified host lifecycle support.
- Codex hook trust and live execution remain unverified.
- Claude Code may lose already-streamed assistant text on Ctrl-C interruption.
- Processing is event-driven and session-local; there is no persistent idle timer or daemon.
- Summary, tag, retrieval-phrase, and decision-topic generation use deterministic heuristics and may miss complex semantics.
- The secret detector is intentionally limited and is not encryption.
- Multi-window use is not a strongly consistent transaction system.
- Linger reduces prompt-injection and malicious-repository risk but does not eliminate it.
- The deterministic evaluation suites are regression baselines, not evidence of universal real-world quality.

## Development and verification

Requires Node.js 20 or later and pnpm.

    pnpm install --frozen-lockfile
    pnpm test
    node scripts/validate-skill.mjs skills/linger
    pnpm eval:year
    pnpm eval:adversarial
    pnpm eval:heldout
    pnpm verify:package

The current clean candidate passes:

- 157 automated tests.
- Year, adversarial, and 250+ event held-out evaluation gates at macro composite 1.0.
- Skill validation.
- Exact tarball package-manager installation.
- Capture-to-recall smoke.
- Uninstall with Vault preservation.
- Tracked-file credential scanning.

These generated suites protect known behavior. They do not prove general memory quality across arbitrary conversations.

## Uninstall and purge

For the current source-installed candidate:

    node dist/cli.js uninstall --yes

Uninstall removes managed Skill and hook integration but preserves the Vault.

To remove the entire state, including the Vault:

    node dist/cli.js purge --yes --confirm PURGE

Purge is intentionally separate and requires both confirmation mechanisms.

## License

Linger is licensed under the MIT License. See LICENSE.
