# Observability

Grillme keeps observability local. Human-readable logs go to stdout, completed spans are written to the configured local NDJSON trace file, and provider event logs remain local artifacts. No telemetry is sent to a hosted service.

For an explicit home, the trace file is normally:

```text
<home>/userdata/logs/server.trace.ndjson
```

For a worktree-local dev run it is:

```text
<worktree>/.t3/userdata/logs/server.trace.ndjson
```

Inspect it with standard local tools:

```bash
tail -f <home>/userdata/logs/server.trace.ndjson
jq -c 'select(.exit._tag != "Success")' <home>/userdata/logs/server.trace.ndjson
```

The local trace file is diagnostic output only. Grillme has no relay, OTLP export, native resource monitor, or cloud analytics path.
