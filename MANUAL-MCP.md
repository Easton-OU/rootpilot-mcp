# MANUAL-MCP.md — human steps to publish rootpilot-mcp

Everything in this repo is code + docs. The steps below need a human (accounts, secrets, external listings). Nothing here writes a real key to a file.

## 1. Decide names

- [x] npm scope/package: `@rootpilot` org created on npm; package published as `@rootpilot/mcp-ssh-diagnose`. If the `@rootpilot` npm org is not owned, either create it or switch to an unscoped/`rootpilot-ssh-diagnose` name. Update `name` in `package.json` and the `npx` line in `README.md` if changed.
- [x] GitHub repo slug: `rootpilot-mcp` under `Easton-OU`; `repository.url` in `package.json` points to `git+https://github.com/Easton-OU/rootpilot-mcp.git`.

## 2. Create the GitHub repo (public)

- [x] `git init && git add . && git commit` (this directory is standalone — no link to the main product repo).
- [x] Create public repo `rootpilot-mcp`, push `main`.
- [x] Repo **About**: description "MCP server for safe, read-only SSH diagnostics — bring your own LLM", website `https://rootpilotx.com`.
- [x] **Topics**: `mcp`, `model-context-protocol`, `ssh`, `devops`, `docker`, `troubleshooting`.
- [x] Confirm the `ci` workflow goes green on the first push (build + tests on Node 18/20/22).

## 3. Publish to npm

- [x] `npm login` (publishes require 2FA; publishConfig pins the official registry).
- [x] `npm publish --access public` (runs `prepublishOnly` → build). Only `dist/`, `README.md`, `LICENSE`, `hosts.example.json` are shipped (see `files`).
- [x] Verify `npx -y @rootpilot/mcp-ssh-diagnose` cold-starts (measured: 14s) in a clean shell (≤30s).

## 4. Community listings

- [x] Submitted to `punkpeye/awesome-mcp-servers` (PR #9881, Command Line section, Glama badge added; Glama listing claimed, release 1.0.0 built, quality score A) — awaiting maintainer merge (and any other awesome-mcp list) under a devops/monitoring section.
- [ ] Optionally submit to the official MCP servers registry if applicable.

## 5. Cross-link with the release repo

- [x] In `rootpilot-release/README.md`, the Related section links here links here as "the calibration/collection layer, open-sourced." Add the real repo URL once created.
- [x] Add a line to this README's intro linking back to the `rootpilot-release` GitHub repo, so the two open-source properties point at each other and both at rootpilotx.com.

## 6. Acceptance (already verified locally)

- [x] Build + typecheck clean; 20 tests pass (whitelist size/uniqueness, container-injection rejection, secret redaction, truncation, collect validation).
- [x] MCP handshake smoke test: `initialize` → `tools/list` (5 tools) → `prompts/list` (2 prompts) → `get_whitelist` (38 commands) all respond.
- [ ] **Real-host acceptance** (needs two real servers): configure `hosts.json`, run `diagnose-host` in Claude Desktop, confirm `collect_base` → `container_deep_dive` → model produces an evidence-backed conclusion; confirm a bad container name and an off-whitelist key are both rejected, and that a secret in output is redacted.
