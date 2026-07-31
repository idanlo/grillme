# Upstream sync

T3Code remains the upstream source for provider protocol, authentication, orchestration, and security fixes.

Configure the remotes once:

```bash
git remote add upstream https://github.com/pingdotgg/t3code.git
git fetch upstream
```

For each sync, merge the selected upstream commit into a dedicated branch, resolve upstream web changes inside the reference app, then port only relevant provider/runtime behavior into Grillme's dedicated client.

Prefer small conflict resolutions at these boundaries:

- `apps/server/src/bin.ts` and CLI configuration
- `apps/server/src/serverRuntimeStartup.ts`
- `apps/server/scripts/cli.ts`
- `apps/grillme/src/rpc.ts`
- `apps/grillme/src/App.tsx`
- `apps/grillme/src/protocol.ts`

Keep mechanical package-scope migration to `@grillme/*` separate from behavioral conflict resolution. Do not rename the unscoped server workspace package unless the deterministic Effect service keys are migrated in the same change.
