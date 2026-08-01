# Grillme

Grillme is a local-first question-and-answer workspace for turning an underspecified idea into a clear, auditable handoff. It runs a browser UI on the current machine and uses an installed coding-agent provider to inspect the repository and ask one decision question at a time.

```bash
pnpm install
pnpm dev
```

The CLI starts a loopback-only server and opens the Grillme client. Runtime state is kept under the selected Grillme home (`GRILLME_HOME` or the worktree-local `.t3` development home). No cloud account, relay, native client, or remote service is required.

## How a session works

1. Grillme opens a local session for the current directory.
2. You choose an installed provider and model.
3. The agent inspects discoverable repository facts without mutating files.
4. It asks exactly one structured decision question at a time, with its recommendation first.
5. You answer through the UI, including a custom answer when needed.
6. The handoff action writes the prompt and collected Q&A to a timestamped Markdown file in the repository.

Grillme sessions default to plan interaction mode and approval-required runtime mode. The grilling protocol prevents the agent from implementing the requested work during the session.

## Providers

Grillme supports locally installed and authenticated Codex, Claude, Cursor, Grok, and OpenCode providers. Provider CLIs are not bundled with Grillme.

## Development

Focused checks:

```bash
pnpm --filter @grillme/grillme test
pnpm --filter @grillme/grillme typecheck
pnpm --filter @grillme/server build:bundle
pnpm --filter @grillme/grillme build
```

See the [implementation plan](./docs/grillme/implementation-plan.md) and [upstream sync notes](./docs/grillme/upstream-sync.md).

## Attribution

Grillme is forked from [pingdotgg/t3code](https://github.com/pingdotgg/t3code). The original and modified code remain covered by the repository's MIT license and copyright notice.
