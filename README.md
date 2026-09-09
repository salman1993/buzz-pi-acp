# pi-acp for Buzz

An [Agent Client Protocol](https://agentclientprotocol.com/) adapter for the [Pi coding agent](https://github.com/earendil-works/pi).

This repository is a fork of [svkozak/pi-acp](https://github.com/svkozak/pi-acp). It exists to carry compatibility changes needed to use Pi as an agent harness in [Buzz](https://github.com/block/buzz). The critical change adds client-supplied system prompts, which let Buzz pass each managed agent's instructions to Pi. The fork also supports Buzz session titles and forwarding Pi launch options.

## Install

Requires Node.js 22 or newer.

Install Pi and configure its model provider:

```bash
npm install -g @earendil-works/pi-coding-agent
pi
```

Install this adapter directly from the fork:

```bash
npm install -g --install-links=true git+https://github.com/salman1993/pi-acp.git#main
```

Restart Buzz, then select **Pi** as the agent harness. Buzz starts `pi-acp` automatically.

Run the same install command again to update the adapter.

## Fork additions

### Client system prompts

Buzz can replace Pi's system prompt through the provisional `session/new.params.systemPrompt` field:

```json
{ "systemPrompt": "Follow this agent's instructions." }
```

The value must be a nonempty string. It is not advertised during capability negotiation. The adapter preserves the prompt when Buzz reloads or restores the session.

### Forwarding Pi launch options

Arguments after `--` are passed to every Pi process. For example:

```bash
pi-acp -- --skill /absolute/path/to/skills
```

For all standard features and configuration, consult the [upstream pi-acp documentation](https://github.com/svkozak/pi-acp).

## Development

```bash
npm ci
npm run build
npm test
```

`src/acp/` handles ACP requests. `src/pi-rpc/` manages the `pi --mode rpc` subprocess.

## License

MIT. See [LICENSE](LICENSE).
