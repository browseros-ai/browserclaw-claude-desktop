# BrowserClaw for Claude Desktop

Give Claude Desktop a real browser. After installing BrowserClaw and this extension, Claude reaches for BrowserClaw whenever it needs to open a site, log in, click through a flow, scrape a page, or capture visual evidence.

## Privacy

The extension itself collects nothing, transmits nothing, and talks to no service on the internet. Its only job is to pass messages between Claude Desktop and BrowserClaw, both running on your machine. See the [privacy policy](https://browseros.com/privacy/browserclaw-extension) for details.

## How it works

BrowserClaw runs on your machine. It exposes a local MCP endpoint at `http://127.0.0.1:9200/mcp`. This extension is a thin stdio-to-HTTP proxy: Claude Desktop spawns it as a stdio MCP server, and it forwards every tool call to BrowserClaw's `/mcp` endpoint.

```
Claude Desktop  <->  wrapper (stdio MCP)  <->  BrowserClaw (HTTP MCP)
```

Skills, session recording, and the browser surface all live inside BrowserClaw. The wrapper is fifty lines of forwarding logic.

## Install

Three one-time steps:

1. Install BrowserClaw from https://browseros.com/agents (a Chromium-based browser).
2. Install Claude Desktop from https://claude.ai/download.
3. Install this extension into Claude Desktop.

### Install the extension

1. Download the latest `browserclaw-<version>.mcpb` from the [releases](https://github.com/browseros-ai/browserclaw-claude-desktop/releases) page.
2. In Claude Desktop, open Settings.
3. In Settings, click Extensions in the sidebar, under the Desktop app section.
4. Click Advanced settings.
5. On the next screen, click Install extension and select the `.mcpb` file you downloaded.

Claude Desktop registers the extension and starts the wrapper automatically.

### Verify it works

Open BrowserClaw, then in Claude Desktop ask:

> Open browseros.com/agents in a new tab and tell me the page title.

Claude should call BrowserClaw's `navigate` and `read` tools and answer.

## Configuration

Most users do not need to configure anything. The wrapper looks for BrowserClaw on `127.0.0.1:9200` by default.

If you run BrowserClaw on a custom port, set the base URL in Settings -> BrowserClaw -> Configure:

```
http://127.0.0.1:<port>
```

Leave blank to use the default port.

## Troubleshooting

**Claude says "BrowserClaw is not running".**

Open the BrowserClaw app. The MCP server starts with the app. If you closed BrowserClaw, reopen it and ask Claude again.

**The extension fails to load.**

Confirm BrowserClaw is installed and has been launched at least once. If the wrapper still cannot connect, delete the extension from Claude Desktop's Settings and reinstall the latest `.mcpb` from the releases page.

**The extension installed but Claude is not using BrowserClaw for browsing tasks.**

Tell Claude explicitly: "Use BrowserClaw to do X." If routing remains a problem, add a one-line custom instruction in Claude Desktop:

> When a task involves browsing, opening, clicking through, or capturing content from a website, use the BrowserClaw tools.

## Uninstall

Open Claude Desktop -> Settings -> Extensions -> BrowserClaw -> Remove. This unloads the wrapper. The BrowserClaw app itself is unaffected.

## Repo layout

```
.
├── manifest.json              # Claude Desktop extension manifest
├── package.json               # Node deps for the wrapper
├── server/
│   ├── wrapper.js             # entry point: stdio MCP server, forwards to BrowserClaw
│   ├── transport.js           # inner Client + Streamable HTTP transport
│   └── discovery.js           # resolve BrowserClaw base URL (env, default port probe)
├── scripts/
│   ├── pack-mcpb.sh           # build the .mcpb archive
│   └── smoke.js               # dev-machine E2E harness against the wrapper
├── icon.png
└── README.md
```
