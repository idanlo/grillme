# Client Runtime

Shared client behavior for the local Grillme browser client. Public APIs are
organized by package subpath. The package intentionally has no root export.

## Public subpaths

| Subpath               | Responsibility                               |
| --------------------- | -------------------------------------------- |
| `rpc`                 | Local WebSocket RPC client and subscriptions |
| `state/threadReducer` | Thread activity reduction for the Grillme UI |

## Dependency direction

The Grillme application provides the browser boundary and uses `rpc` to connect
to its loopback server. The reducer is kept independent so the UI can consume
thread snapshots and events without importing server implementation details.

Applications should import the narrowest relevant subpath. The package exposes
only the two subpaths listed above; all other files remain implementation
details.
