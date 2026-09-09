# pi-acp

ACP ([Agent Client Protocol](https://agentclientprotocol.com/overview/introduction)) adapter for [`pi`](https://github.com/earendil-works/pi) coding agent (fka shitty coding agent).

`pi-acp` communicates **ACP JSON-RPC 2.0 over stdio** to an ACP client (e.g. Zed editor) and spawns `pi --mode rpc`, bridging requests/events between the two.

## Status

This is an MVP-style adapter intended to be useful today and easy to iterate on. Some ACP features may be not implemented or are not supported (see [Limitations](#limitations)). Development is centered around [Zed](https://zed.dev) editor support, other clients may have varying levels of compatibility.

Expect some minor breaking changes.

## Features

- Streams assistant output as ACP `agent_message_chunk`
- Maps pi tool execution to ACP `tool_call` / `tool_call_update`
  - Tool call locations are surfaced when available for ACP clients that support opening the referenced file/context
  - Relative file paths from pi are resolved against the session cwd before being emitted as ACP tool locations, which enables follow-along features in clients like Zed
  - For `edit`, `pi-acp` attempts to infer a 1-based line number from a unique `oldText` match in the pre-edit file snapshot and includes it in the emitted tool location when possible
  - For `edit`, `pi-acp` snapshots the file before the tool runs and emits an ACP **structured diff** (`oldText`/`newText`) on completion when possible
- Session persistence
  - pi stores its own sessions in `~/.pi/agent/sessions/...`
  - `pi-acp` stores a small mapping file at `~/.pi/pi-acp/session-map.json` so `session/load` can reattach to a previous pi session file
- Slash commands
  - Loads file-based slash commands compatible with pi’s conventions
  - Adds a small set of built-in commands for headless/editor usage
  - Supports skill commands (if enabled in pi settings, they appear as `/skill:skill-name` in the ACP client)
- Skills are loaded by pi directly and are available in ACP sessions
- (Zed) `pi-acp` emits “startup info” block into the session (pi version, context, skills, prompts, extensions - similar to `pi` in the terminal). You can disable it by setting `quietStartup: true` in pi settings (`~/.pi/agent/settings.json` or `<project>/.pi/settings.json`). When `quietStartup` is enabled, `pi-acp` will still emit a 'New version available' message if the installed pi version is outdated.
- (Zed) Session history is supported in Zed starting with [`v0.225.0`](https://zed.dev/releases/preview/0.225.0). Session loading / history maps to pi's session files. Sessions can be resumed both in `pi` and in the ACP client.

## Prerequisites

Make sure pi is installed

```bash
npm install -g @earendil-works/pi-coding-agent
```

- Node.js 22+
- `pi` v0.80.4+ installed and available on your `PATH` (the adapter runs the `pi` executable)
- Configure `pi` separately for your model providers/API keys

## Install

### Add pi-acp to your ACP client, e.g. [Zed](https://zed.dev/docs/agents/external-agents/)

#### Using ACP Registry in Zed or other clients that support it:

In Zed launch the registry with `zed: acp registry` command and select `pi ACP` adapter from the list. This will automatically add the agent server configuration to your `settings.json` and keep it up to date:

```json
  "agent_servers": {
    "pi-acp": {
      "type": "registry",
    },
  }
```

#### Using with `npx` (no global install needed, always loads the latest version):

Add the following to your Zed `settings.json`:

```json
  "agent_servers": {
    "pi": {
      "type": "custom",
      "command": "npx",
      "args": ["-y", "pi-acp"],
      "env": {}
    }
  }
```

#### Global install

```bash
npm install -g pi-acp
```

```json
  "agent_servers": {
    "pi": {
      "type": "custom",
      "command": "pi-acp",
      "args": [],
      "env": {}
    }
  }
```

#### From source

```bash
npm install
npm run build
```

Point your ACP client to the built `dist/index.js`:

```json
  "agent_servers": {
    "pi": {
      "type": "custom",
      "command": "node",
      "args": ["/path/to/pi-acp/dist/index.js"],
      "env": {}
    }
  }
```

### Environment variables

- `PI_ACP_ENABLE_EMBEDDED_CONTEXT=true` advertises ACP `promptCapabilities.embeddedContext` support to the client.
- Default: unset/any other value means `false`.
- When disabled, compliant ACP clients should avoid sending embedded `resource` blocks. If they send them anyway, `pi-acp` still degrades gracefully by converting them into plain-text prompt context.

You can add the environment variable in the Zed settings with:

```json
  "agent_servers": {
    "pi": {
      "type": "custom",
      "command": "node",
      "args": ["/path/to/pi-acp/dist/index.js"],
      "env": {
          "PI_ACP_ENABLE_EMBEDDED_CONTEXT": "true",
      }
    }
  }
```

### Forwarding Pi launch options

Put Pi options after `--` in the adapter's launch arguments. For example, a client
can load an additional skill directory with:

```json
{
  "command": "pi-acp",
  "args": ["--", "--skill", "/absolute/workspace/.agents/skills"]
}
```

Use an absolute path so discovery does not depend on the session's working
directory. Paths with spaces remain a single JSON argument. Repeat `--skill` to
load multiple directories. Pi keeps its normal skill discovery enabled unless
you explicitly change it through Pi's options.

These options belong to the adapter process and are applied whenever it starts
Pi, including automatic restoration and `session/load`. They are not saved in
session records; restarting the adapter uses the current launch configuration.
Session-specific system prompts continue to use `_meta.systemPrompt`.

Adapter options go before the separator. For example,
`pi-acp --terminal-login -- --skill /absolute/skills` opens interactive Pi with
the same skill path. Unknown adapter options are rejected. Options that select
Pi's mode, session, prompt, or one-shot output are reserved and rejected even
after `--` (including `--mode`, `--session`, `--session-dir`, `--no-session`,
`--resume`, `--continue`, `--system-prompt`, and `--append-system-prompt`).

### Client system prompts

Clients can configure a session's system prompt through the ACP extension
`session/new.params._meta.systemPrompt`. A nonempty string replaces Pi's base
prompt; an object containing only `append` appends to it:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "session/new",
  "params": {
    "cwd": "/absolute/workspace",
    "mcpServers": [],
    "_meta": {
      "systemPrompt": "You are an assistant working inside this application."
    }
  }
}
```

To append instead, use:

```json
{ "systemPrompt": { "append": "Always explain changes concisely." } }
```

This second object is the `_meta` value. Other metadata can coexist with
`systemPrompt`. Omitting it preserves the existing behavior. Null, blank
replacement strings, and malformed objects return ACP `Invalid params` before
starting Pi. An empty append string is allowed and follows Pi's explicit append
behavior.

Support is advertised in the `initialize` response at
`agentCapabilities._meta.piAcp.systemPrompt`:

```json
{ "replace": true, "append": true, "persisted": true }
```

Prompt text is literal (never a client-supplied filename). The adapter supplies
private files to Pi's `--system-prompt` / `--append-system-prompt` flags and stores
the mode and original text in `~/.pi/pi-acp/session-map.json`. It reapplies them
on `session/load`, automatic subprocess restoration, and adapter restart. Prompts
are fixed for the session's lifetime; create a new session to change them.
Deleting a session removes its saved prompt. Older sessions without a saved
prompt keep their existing behavior. Opening the transcript directly in Pi does
not apply this adapter-owned configuration.

Pi still adds its normal project context, skills, and working directory, and
extensions may modify the resulting prompt. Replacement overrides Pi's default
base or discovered `SYSTEM.md`; explicit append follows Pi's CLI precedence and
supersedes automatic `APPEND_SYSTEM.md` discovery. It does not replace the base.

### Client session titles

Clients can name a new session with `session/new.params._meta.sessionTitle`:

```json
{
  "cwd": "/absolute/workspace",
  "mcpServers": [],
  "_meta": {
    "sessionTitle": "Fix the login bug",
    "systemPrompt": { "append": "Explain your changes concisely." }
  }
}
```

The adapter collapses whitespace and trims the title. Titles longer than 256
characters are shortened to 255 characters plus `…`. Missing, non-string, and
blank values are ignored. Support is advertised through
`agentCapabilities._meta.piAcp.sessionTitle: true`.

The title is applied through Pi's `set_session_name` RPC before `session/new`
returns, then announced through `session_info_update`. If naming fails, session
creation fails and the new session is cleaned up. Pi saves titles in its
transcript. Because Pi defers creating that file until a response is saved, the
adapter also keeps the initial title in its session map and reapplies it when
restoring a session whose transcript does not yet exist. Existing transcripts
retain their current name, including later renames. `session/load` does
not apply `_meta.sessionTitle`; use `/name` to rename an existing session.

### Slash commands

`pi-acp` supports slash commands:

#### 1) File-based commands (aka prompts)

Loaded from:

- User commands: `~/.pi/agent/prompts/**/*.md`
- Project commands: `<cwd>/.pi/prompts/**/*.md`

#### 2) Built-in commands

- `/compact [instructions...]` – run pi compaction (optionally with custom instructions)
- `/autocompact on|off|toggle` – toggle automatic compaction
- `/export` – export the current session to HTML in the session `cwd`
- `/session` – show session stats (tokens/messages/cost/session file)
- `/name <name>` – set session display name
- `/queue all|one-at-a-time` – set pi queue mode (unstable feature)
- `/changelog` – print the installed pi changelog (best-effort)
- `/steering` - maps to `pi` Steering Mode, get/set
- `/follow-up` - pats to `pi` Follow-up Mode, get/set

Other built-in commands:

- `/model` - not implemented (use the model selector UI in Zed)
- `/thinking` - maps to 'mode' selector in Zed
- `/clear` - not implemented (use ACP client 'new' command)

#### 3) Skill commands

- Skill commands can be enabled in pi settings and will appear in the slash command list in ACP client as `/skill:skill-name`.

**Note**: Slash commands provided by pi extensions are not currently supported.

## Authentication (ACP Registry support)

This agent supports **Terminal Auth** for the [ACP Registry](https://agentclientprotocol.com/get-started/registry).
In Zed, this will show an **Authenticate** banner that launches pi in a terminal.
Launch pi in a terminal for interactive login/setup:

```bash
pi-acp --terminal-login
```

Your ACP client can also invoke this automatically based on the agent's advertised `authMethods`.

## Development

```bash
npm install
npm run dev        # run from src via tsx
npm run build
npm run lint
npm run test
```

Project layout:

- `src/acp/*` – ACP server + translation layer
- `src/pi-rpc/*` – pi subprocess wrapper (RPC protocol)

## Limitations

- No ACP filesystem delegation (`fs/*`) and no ACP terminal delegation (`terminal/*`). pi reads/writes and executes locally.
- MCP servers are accepted in ACP params and stored in session state, but not wired through to pi in this adapter. If you use [pi MCP adapter](https://github.com/nicobailon/pi-mcp-adapter) it will be available in the ACP client.
- Assistant streaming is currently sent as `agent_message_chunk` (no separate thought stream).
- Queue is implemented client-side and should work like pi's `one-at-a-time`
- ~~ACP clients don't yet suport session history, but ACP sessions from `pi-acp` can be `/resume`d in pi directly~~

## License

MIT (see [LICENSE](LICENSE)).
