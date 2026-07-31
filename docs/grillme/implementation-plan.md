# Grillme implementation plan

Baseline: `pingdotgg/t3code` at `a041981276b4c789fed8132e3b8a320749bf25e8`.

## Product contract

- Start from the current repository with `npx grillme`.
- Investigate discoverable facts with non-mutating tools.
- Ask exactly one decision question at a time through the provider's structured input mechanism.
- Put the recommended answer first and explain each option's impact.
- Never implement the user's request during the grilling session.
- Write a deterministic Markdown handoff from the original prompt and persisted Q&A at any time.

## Implementation phases

- [x] Remove the mobile, desktop, and marketing apps and their dedicated build/release tooling.
- [x] Expose a minimal local `grillme` CLI while retaining the provider engine.
- [x] Isolate runtime state under `~/.grillme` or `GRILLME_HOME`.
- [x] Disable application analytics and default startup to loopback-only access.
- [x] Reuse/create only the current-directory project at startup, then open a fresh browser draft.
- [x] Default new sessions to `plan` plus `approval-required` modes.
- [x] Inject the Grillme protocol only into the first provider turn and hide it from the visible transcript.
- [x] Reuse T3Code's structured question schema and provider response path.
- [x] Project requested/resolved user-input activities into a timestamped Markdown handoff.
- [x] Add initial Grillme branding and package identity.
- [x] Add a dedicated `apps/grillme` client and leave `apps/web` as an upstream reference.
- [x] Replace the generic coding-workspace shell with a focused Grillme session shell.
- [x] Rename the workspace package scope to `@grillme/*`.
- [x] Point local development and the published server bundle at `apps/grillme`.
- [ ] Remove unreachable cloud, relay, source-control, preview, terminal, and updater surfaces after the focused shell no longer imports them.
- [ ] Add handoff preview, user-selected filename, and explicit overwrite handling.
- [ ] Add browser-level coverage for provider selection, one-question rendering, custom answers, and handoff writing.
- [ ] Publish the first npm prerelease and verify `npx grillme` from an empty npm cache.

## Architecture boundaries

Keep the server provider adapters, contracts, client runtime, orchestration/event log, and workspace-confined file RPC. Product code lives in `apps/grillme`; `apps/web` stays intact as a reference for upstream T3Code client behavior and is not a runtime dependency of Grillme.

Workspace packages use the `@grillme/*` scope. The server workspace intentionally keeps its unscoped internal name `t3` because Effect's deterministic service keys derive from it; published npm metadata and the executable use `grillme`.
