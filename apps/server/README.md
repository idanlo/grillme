# Grillme

Grillme turns an underspecified coding idea into an implementation-ready Markdown handoff.
It opens a local web interface, lets an installed coding agent inspect the current repository,
and asks one decision question at a time. Grillme does not implement the plan during the
interview.

## Run

```bash
npx grillme
```

Run the command from the repository you want to discuss. Grillme starts a loopback-only server,
opens the paired browser URL, and stores its runtime data locally.

Requirements:

- Node.js 22.16 or newer
- At least one installed and authenticated provider CLI

Supported providers include Codex, Claude, Cursor, Grok, and OpenCode. Provider CLIs and their
accounts are not bundled with Grillme.

Useful flags:

```text
--port <number>     Choose the local server port
--base-dir <path>   Choose the Grillme data directory
--no-browser        Do not open the browser automatically
```

The handoff action writes the prompt and collected questions and answers to a timestamped Markdown
file in the repository.

Source: <https://github.com/idanlo/grillme>

Grillme is a fork of [T3 Code](https://github.com/pingdotgg/t3code) and is distributed under the
MIT License.
