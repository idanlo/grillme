# Grillme implementation plan

## Product contract

- Start from the current repository with `npx grillme`.
- Investigate discoverable facts with non-mutating tools.
- Ask exactly one decision question at a time through the provider's structured input mechanism.
- Put the recommended answer first and explain each option's impact.
- Never implement the user's request during the grilling session.
- Write a deterministic Markdown handoff from the original prompt and persisted Q&A at any time.

## Completed phases

- [x] Remove the mobile, desktop, marketing, cloud, relay, and native surfaces.
- [x] Expose a minimal local `grillme` CLI and client.
- [x] Isolate runtime state under the Grillme home and loopback-only access.
- [x] Disable analytics, remote authentication, self-update, and native power-policy behavior.
- [x] Reuse or create only the current-directory project at startup.
- [x] Default new sessions to `plan` plus `approval-required` modes.
- [x] Inject the Grillme protocol only into the first provider turn and hide it from the visible transcript.
- [x] Reuse the provider engine's structured question and response path.
- [x] Project requested/resolved user-input activities into a timestamped Markdown handoff.
- [x] Add Grillme branding and package identity.
- [x] Replace the generic coding-workspace shell with a focused Grillme session shell.
- [x] Remove unreachable T3-only preview, terminal, updater, telemetry, and project-file surfaces.

## Follow-up work

- [ ] Add handoff preview, user-selected filename, and explicit overwrite handling.
- [ ] Add browser-level coverage for provider selection, one-question rendering, custom answers, and handoff writing.
- [ ] Publish the first npm prerelease and verify `npx grillme` from an empty npm cache.

## Architecture boundaries

The server owns local provider adapters, contracts, client runtime, orchestration/event persistence, workspace inspection, and the file RPC needed to write handoffs. Product code lives in `apps/grillme`; the server bundle is built from `apps/server`.

Grillme deliberately has one surface: a loopback web client. It does not contain native apps, a hosted client, remote connection modes, cloud authentication, relay/tunnel services, or cloud telemetry.
