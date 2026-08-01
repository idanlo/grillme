# Keybindings

Keybindings are stored locally under the selected Grillme home. The exact commands shown by the running client are authoritative; this page only documents the file shape.

```json
[
  { "key": "mod+enter", "command": "chat.send" },
  { "key": "mod+shift+h", "command": "handoff.write" }
]
```

Each rule has a required `key` and `command`, plus an optional `when` expression. Invalid rules are ignored and reported in the local server log. No keybinding requires a remote service.
