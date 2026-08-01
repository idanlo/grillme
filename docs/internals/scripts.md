# Scripts

Grillme uses [Vite+](https://viteplus.dev/guide/). Install dependencies and start the local stack with:

```bash
vp i
vp run dev
```

`vp run dev` starts the server and `apps/grillme` client in watch mode. The runner prints the selected ports, isolated base directory, and one-time pairing URL. Do not set `VITE_HTTP_URL` or `VITE_WS_URL`; the client is same-origin and the dev server proxies backend paths.

## Commands

- `vp run dev`: server plus client.
- `vp run dev:server`: server only.
- `vp run dev:web`: client only.
- `vp run build`: workspace build tasks.
- `vp run start`: production server from `apps/server/dist`.
- `vp run test`: workspace tests.
- `vp run typecheck`: workspace TypeScript checks.
- `node apps/server/scripts/t3-sqlite-state.ts <query|exec> --base-dir <path>`: inspect or seed an isolated SQLite database.

## Development state

Use `--home-dir <path>` when testing with a disposable state directory. A worktree-local dev run defaults to `<worktree>/.t3`; never point a test server at a shared live home. Runtime state is stored under `<base-dir>/userdata` for an explicit home.

The preferred and actual ports are printed in the `[dev-runner]` log line. Occupied ports may cause the runner to select an offset.
