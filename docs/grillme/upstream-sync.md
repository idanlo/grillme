# Upstream sync

T3Code remains the upstream source for provider protocol, authentication, orchestration, and security fixes.

Configure the remotes once:

```bash
git remote add upstream https://github.com/pingdotgg/t3code.git
git fetch upstream
```

For each sync, merge the selected upstream commit into a dedicated branch, preserve Grillme's first-turn protocol and local-only CLI boundaries, then run the focused provider, server-startup, web, and package-build checks.

Prefer small conflict resolutions at these boundaries:

- `apps/server/src/bin.ts` and CLI configuration
- `apps/server/src/serverRuntimeStartup.ts`
- `apps/server/scripts/cli.ts`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/grill/`

Avoid renaming internal workspace packages. This keeps upstream provider changes reviewable and prevents churn in Effect service keys.
