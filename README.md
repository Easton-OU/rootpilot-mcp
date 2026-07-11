# rootpilot-ssh-diagnose

> This is the open-source, bring-your-own-LLM taste of [RootPilot](https://rootpilotx.com). The full product adds calibrated diagnosis (89.7% across 29 standard failure scenarios, zero false alarms on healthy hosts), alert-triggered auto-diagnosis, history, and multi-host management → [rootpilotx.com](https://rootpilotx.com)

An [MCP](https://modelcontextprotocol.io) server that lets any MCP client — Claude Desktop, Claude Code, or your own — **safely collect read-only diagnostics from your servers over SSH**. It gathers evidence from a fixed whitelist of read-only commands; **your model does the reasoning**. The server never runs anything outside the whitelist, and never makes a change to your hosts.

## Why

When a server misbehaves, you end up SSH-ing in and running the same twenty commands — `df -h`, `docker ps`, `dmesg | grep -i oom`, `free -m` — then eyeballing the output. This server turns that into a conversation: your LLM asks for exactly the evidence it needs, gets structured, secret-redacted output back, and reasons about the root cause. You stay in control; nothing leaves your machine except SSH to your own hosts.

## Security model (read this first)

- **Read-only whitelist.** There are exactly 38 built-in commands (`get_whitelist` lists them all). There is no tool that runs an arbitrary command — not even with a confirmation prompt. Every command only inspects state.
- **The only injectable value is a container name**, validated against `^[a-zA-Z0-9_.-]+$` before it is ever placed in a command. `web; rm -rf /` is rejected, not escaped.
- **Secrets are redacted** from output before it reaches your model: `KEY=value` secrets, `Bearer`/`Basic` tokens, `sk-`/`ghp_`/`AKIA…` key shapes, PEM private-key blocks, and credentials embedded in URLs. `docker inspect` env values are scrubbed.
- **Per-command timeout** (15s) and output truncation guard against hangs and floods.
- **Credentials stay local.** Host definitions live in a file you control; passwords are never logged.

## 30-second setup

Add the server to your MCP client. For **Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "rootpilot-ssh-diagnose": {
      "command": "npx",
      "args": ["-y", "@rootpilot/mcp-ssh-diagnose"],
      "env": {
        "RP_HOSTS": "/Users/me/.rootpilot-mcp/hosts.json"
      }
    }
  }
}
```

Then create `hosts.json` (see [`hosts.example.json`](./hosts.example.json)):

```json
[
  { "name": "prod-1", "host": "1.2.3.4", "port": 22, "user": "rootpilot",
    "auth": { "type": "key", "keyPath": "~/.ssh/rootpilot_key" } },
  { "name": "prod-2", "host": "10.0.0.5", "user": "ops",
    "auth": { "type": "password", "password": "..." } }
]
```

Restart your client. Ask it: **"Diagnose prod-1"** (or run the `diagnose-host` prompt).

> **Use a least-privilege account.** Create a dedicated read-only SSH user for diagnostics rather than reusing root. The commands only read state, but the account should reflect that.

## Tools

| tool | arguments | what it does |
|---|---|---|
| `list_hosts` | `probe?` | List configured hosts; with `probe`, also test SSH reachability |
| `get_whitelist` | — | Return all 38 commands (key, purpose, template) so you and the model can audit exactly what can run |
| `collect` | `host`, `keys[]` (≤8), `container?` | Run specific whitelisted commands and return redacted, truncated output |
| `collect_base` | `host` | Shortcut: the base overview (`docker_ps`, `df`, `df_inode`, `free`, `uptime`, `dmesg_oom`, `docker_daemon`) |
| `container_deep_dive` | `host`, `container` | Shortcut: `docker_logs`, `docker_inspect` (redacted), `container_state`, `docker_stats` for one container |

Two prompts ship built-in: **`diagnose-host`** (evidence-first root-cause walkthrough) and **`health-check`** (a light sweep).

## Configuration

| env var | default | purpose |
|---|---|---|
| `RP_HOSTS` | — | Path to your `hosts.json` (**required**) |
| `RP_PROBE_URL` | `https://cloudflare.com` | Target for the outbound-connectivity / DNS probes |
| `RP_NO_PROMO` | — | Set to `1` to silence the one-line pointer to the full product |

## How it works

```
  your MCP client (the LLM)
        │  "collect df, docker_ps, dmesg_oom from prod-1"
        ▼
  rootpilot-ssh-diagnose  ──ssh──▶  your server
        │  renders a whitelisted template, runs it read-only,
        │  redacts secrets, truncates, returns structured output
        ▼
  the LLM reasons about root cause from the evidence
```

The server deliberately does **no** analysis of its own — no built-in LLM call, no multi-round orchestration. That boundary is the point: it's a clean, auditable evidence collector. Calibrated diagnosis (deciding *which* evidence to pull for *which* symptom, across follow-up rounds, scored against a failure-scenario library) is what the full [RootPilot](https://rootpilotx.com) product does.

## FAQ

**Does it ever change my server?** No. Every command is read-only, and there is no arbitrary-command tool. The full whitelist is visible via `get_whitelist`.

**Where does my data go?** Nowhere except SSH between this server (running on your machine) and your hosts. Command output goes to your MCP client's model. No telemetry.

**Which LLM does it use?** None of its own — it's bring-your-own. Whatever model your MCP client runs does the reasoning.

**Can it manage Windows servers or jump hosts?** Not in v1. It targets Linux hosts over direct SSH.

**How is this different from RootPilot?** This collects evidence; you (or your model) interpret it ad hoc. RootPilot adds calibrated diagnosis, alert-triggered auto-diagnosis, a per-host history ("medical record"), and multi-host management. See [rootpilotx.com](https://rootpilotx.com).

## Development

```bash
npm install
npm run build      # compile to dist/
npm test           # whitelist / injection / redaction / timeout tests
npm run typecheck
```

## License

MIT — see [LICENSE](./LICENSE).
