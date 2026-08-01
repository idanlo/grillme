# Architecture

Grillme is a local web client backed by one local server process. The server is the execution boundary: provider processes, repository inspection, Git operations, and handoff writes happen on the host machine.

```text
apps/grillme  -- same-origin HTTP/WebSocket -->  apps/server
                                                     |
                                                     +-- provider adapters
                                                     |   Codex, Claude, Cursor,
                                                     |   Grok, OpenCode
                                                     +-- local SQLite state
                                                     +-- workspace and Git access
```

## RPC boundary

`packages/contracts/src/rpc.ts` defines the typed WebSocket methods. `apps/server/src/ws.ts` authenticates a loopback browser session and serves the RPC group. `apps/grillme/src/rpc.ts` connects to the same origin, so development and production do not need a configured remote origin.

The client uses the narrow shared exports in `packages/client-runtime` for RPC state and thread reduction. It does not know how provider processes are started or how state is persisted.

## Event-sourced orchestration

Clients dispatch typed commands. The orchestration engine decides and persists events, then projections derive the read model rendered by the UI. Provider runtime events are normalized into orchestration commands by `ProviderRuntimeIngestion`; `ProviderCommandReactor` performs provider side effects; `CheckpointReactor` manages local Git checkpoints.

Queue-backed workers expose drain operations so tests can wait for durable work to finish without sleeps.

## Startup

`serverRuntimeStartup.ts` initializes local settings, persistence, providers, and reactors, starts the HTTP listener, creates a local pairing token when needed, and prints the browser URL. The dev runner keeps all state in an explicit isolated home or the worktree-local development home.

## Boundaries

The product surface is intentionally one local browser client. There are no native apps, hosted UI, remote connection modes, cloud authentication, relay/tunnel services, or cloud telemetry.

Related: [workspace layout](./workspace-layout.md), [providers](./providers.md), [glossary](./glossary.md), [scripts](./scripts.md), and [CI gates](./ci.md).
