# js

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.2.12. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.

## Container configuration

This customized build loads exactly one required OpenCode configuration file.
The default is `/etc/opencode/opencode.jsonc`. To select another file, set:

```bash
OPENCODE_CONFIG_ONLY=/path/to/opencode.jsonc opencode serve
```

The selected file must exist, be readable, and contain valid, nonempty JSON or
JSONC that satisfies the OpenCode configuration schema. Loading fails with the
file path and cause if these requirements are not met. No other configuration
source is used as a fallback.

Project, ancestor, home, global, and remote OpenCode configuration sources are
ignored, as are `OPENCODE_CONFIG`, `OPENCODE_CONFIG_DIR`,
`OPENCODE_CONFIG_CONTENT`, `OPENCODE_PERMISSION`, and the configuration overrides
`OPENCODE_DISABLE_AUTOCOMPACT` and `OPENCODE_DISABLE_PRUNE`. Configuration
folders are not scanned for agents, commands, plugins, or custom tools. Declare
required extensions in the selected file. Explicit `{env:...}` and `{file:...}`
substitutions remain supported.

Loading never rewrites the selected file, so it can be mounted read-only.
Unspecified settings retain their built-in defaults. Configuration update APIs
are unchanged; files they write elsewhere do not become configuration sources.
Separate `tui.json` preferences and project instructions (`AGENTS.md`) retain
their existing behavior. Skills from external directories or explicitly
configured paths remain available; implicit configuration folders are not
scanned. Automatic migration from `opencode.json` or `opencode.jsonc` into TUI
preferences is disabled.
