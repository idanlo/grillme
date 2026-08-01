# Install Grillme

Grillme runs on the machine where the repository and provider CLI are available. It opens a local browser client and does not require a cloud account or a separate app.

## Requirements

- Node.js `^22.16 || ^23.11 || >=24.10`.
- At least one locally installed and authenticated provider CLI.

## Run from the repository

```bash
pnpm install
pnpm dev
```

For a packaged CLI, use `npx grillme` once the package is published. `grillme --help` shows the available local options.

## Providers

Grillme drives provider CLIs; it does not ship them. Install and authenticate the provider you want to use on the same machine:

| Provider   | CLI                                                   | Default binary | Login                 |
| ---------- | ----------------------------------------------------- | -------------- | --------------------- |
| Codex      | [Codex CLI](https://developers.openai.com/codex/cli)  | `codex`        | `codex login`         |
| Claude     | [Claude Code](https://claude.com/product/claude-code) | `claude`       | `claude auth login`   |
| Cursor     | [Cursor CLI](https://cursor.com/cli)                  | `cursor-agent` | `agent login`         |
| Grok Build | [Grok Build CLI](https://x.ai/cli)                    | `grok`         | `grok login`          |
| OpenCode   | [OpenCode](https://opencode.ai)                       | `opencode`     | `opencode auth login` |

Provider binaries must be on the server process's `PATH`, or configured with an explicit binary path in Grillme settings. Authentication happens locally; the browser is only the UI.

For multiple provider profiles, see [Codex](./providers-codex.md) and [Claude](./providers-claude.md).

## Next steps

- [Permission modes](./permission-modes.md)
- [Keyboard shortcuts](./keybindings.md)
