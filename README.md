# Grillme

Grillme is a local interview utility for turning an underspecified idea into a clear, auditable handoff. Run it from a repository, choose one of your installed coding-agent providers, and answer one decision question at a time in the browser.

```bash
npx grillme
```

The npm package is not published yet. To run the current source build:

```bash
pnpm install
pnpm dev
```

That starts the server and the dedicated client in `apps/grillme`. The original T3Code web app
remains available as a reference with `pnpm dev:reference`.

## How a grilling session works

1. Grillme opens a local-only web client for the current directory.
2. You enter the subject to explore and choose a provider/model.
3. The agent inspects the repository for facts it can discover without asking you.
4. It asks exactly one structured decision question at a time, with its recommended answer first.
5. You select an option or enter your own answer.
6. The persistent **Handoff** action writes the prompt and Q&A collected so far to a timestamped Markdown file in the repository.

The initial Grillme protocol forbids the agent from implementing the requested work. New sessions default to plan interaction mode and approval-required runtime mode.

## Providers

Grillme retains T3Code's provider engine instead of reimplementing it. It currently supports locally installed and authenticated Codex, Claude, Cursor, Grok, and OpenCode providers.

## Development

This is an early fork. The server workspace intentionally keeps its internal `t3` package name because Effect service keys derive from it; the release flow rewrites the published npm identity to `grillme` and exposes only the `grillme` executable.

Focused checks:

```bash
pnpm --filter @grillme/grillme test
pnpm --filter @grillme/grillme typecheck
pnpm --filter @grillme/web typecheck
pnpm --filter t3 typecheck
pnpm exec vp run --filter t3 build
```

See [the implementation plan](./docs/grillme/implementation-plan.md) and [upstream sync notes](./docs/grillme/upstream-sync.md).

## Attribution

Grillme is forked from [pingdotgg/t3code](https://github.com/pingdotgg/t3code) and retains its provider/runtime architecture. The original and modified code remain covered by the repository's MIT license and copyright notice.
