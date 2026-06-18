# BrowserOS for Claude Desktop

Drive a real Chromium browser from Claude Desktop. After installing BrowserOS and this extension, Claude reaches for BrowserOS whenever it needs to browse, search a real site, click through a flow, scrape a page, or capture visual evidence.

## How it works

This extension is a thin discovery wrapper. The real browser surface lives in the [BrowserOS](https://browseros.com) desktop app, which embeds an MCP server. The wrapper auto-detects the running BrowserOS instance on the user's machine and forwards Claude Desktop's tool calls to it over stdio.

```
Claude Desktop  <->  wrapper (stdio MCP)  <->  BrowserOS app (HTTP MCP)
```

## Install

Three one-time steps:

1. Install BrowserOS from https://browseros.com (a Chromium-based browser).
2. Install Claude Desktop from https://claude.ai/download.
3. Install this extension into Claude Desktop.

### Install the extension

Download the latest `browseros-<version>.mcpb` from the [releases](https://github.com/browseros-ai/browseros-claude-desktop/releases) page, then drag it onto Claude Desktop's Settings window. Claude Desktop will register the extension and start the wrapper automatically.

### Verify it works

Open BrowserOS, then in Claude Desktop ask:

> Open browseros.com in a new tab and tell me the page title.

Claude should call BrowserOS's `navigate` and `read` tools and answer.

## Configuration

Most users do not need to configure anything. The wrapper reads `~/.browseros/server.json` to find the live BrowserOS MCP URL, and falls back to common ports.

If you run BrowserOS on a custom port, set the `url` field in the extension's user config (Settings -> BrowserOS -> Configure):

```
http://127.0.0.1:9000
```

Leave blank for auto-discovery.

## Troubleshooting

**Claude says "BrowserOS is not running".**

Open the BrowserOS desktop app. The MCP server starts with the app. If you closed BrowserOS, reopen it and ask Claude again.

**The extension fails to load.**

Confirm BrowserOS is installed (`ls ~/.browseros/server.json` should exist after BrowserOS has been launched at least once). If the file is missing or stale, restart BrowserOS.

**The extension installed but Claude is not using BrowserOS for browsing tasks.**

Tell Claude explicitly: "Use BrowserOS to do X." If routing remains a problem, add a one-line custom instruction in Claude Desktop:

> When a task involves browsing, opening, clicking through, or capturing content from a website, use the BrowserOS tools.

## Uninstall

Open Claude Desktop -> Settings -> Extensions -> BrowserOS -> Remove. This unloads the wrapper. The BrowserOS app itself is unaffected.

## Repo layout

```
.
├── manifest.json              # Claude Desktop extension manifest
├── package.json               # Node deps for the wrapper
├── server/
│   ├── wrapper.js             # entry point: stdio MCP server, forwards to BrowserOS
│   ├── transport.js           # inner Client + Streamable HTTP transport
│   └── discovery.js           # resolve BrowserOS base URL (env, server.json, port probe)
├── scripts/
│   ├── pack-mcpb.sh           # build the .mcpb archive
│   └── smoke.js               # dev-machine E2E harness against the wrapper
├── icon.png                   # added in a follow-up PR
└── README.md
```

## Development

```bash
# Install deps
npm install

# Smoke test against a running BrowserOS desktop app
node scripts/smoke.js

# Pack the extension into build/browseros-<version>.mcpb
./scripts/pack-mcpb.sh

# Sideload: drag build/browseros-<version>.mcpb onto Claude Desktop Settings.
```

The smoke harness spawns `server/wrapper.js`, runs the MCP initialize handshake, lists tools, calls `navigate`, and re-runs the same script against a deliberately dead URL to confirm the "BrowserOS not running" path. Dev-machine only; not wired into CI in v1.

## Status

Pre-release. Repo is private during bring-up. Public release tracks the first tagged version.

## License

MIT. See [LICENSE](./LICENSE).
