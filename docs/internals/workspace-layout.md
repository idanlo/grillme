# Workspace layout

The repository is a small pnpm workspace driven by [Vite+](https://vite.plus) (`vp`).

## Applications

- `apps/grillme`: the local React/Vite question-and-answer client.
- `apps/server`: the local HTTP/WebSocket server and published `grillme` CLI.

## Packages

- `packages/contracts`: shared Effect schemas, RPC definitions, orchestration events, and settings.
- `packages/shared`: framework-agnostic utilities used by the server and client.
- `packages/client-runtime`: shared RPC and client state helpers.
- `packages/effect-acp`: Agent Client Protocol support for ACP providers.
- `packages/effect-codex-app-server`: the Codex app-server JSON-RPC client.

## Tooling

- `scripts/`: the local dev runner and small workspace utilities.
- `patches/`: pnpm patches for pinned upstream dependencies.
- `docs/`: user and maintainer documentation.

There are no mobile, desktop, marketing, native, relay, or cloud workspaces.

## Import conventions

`@grillme/shared` and `@grillme/client-runtime` use explicit subpath exports and intentionally have no root barrel. Import the narrow path you need. `@grillme/contracts` exposes its root and focused subpaths.
