# Notes for Anthropic Directory reviewers

This document walks a reviewer end-to-end from a clean machine to a working test of the extension.

## What the extension is

A small stdio MCP server that Claude Desktop spawns as a subprocess. It has no tools of its own. It discovers a running BrowserClaw instance on the same machine and forwards Claude Desktop's tool calls to BrowserClaw's local MCP endpoint. Every tool Claude sees in `tools/list` comes from BrowserClaw.

## What you need

1. **Claude Desktop**: download from https://claude.ai/download.
2. **BrowserClaw**: download from https://browseros.com/agents. macOS and Windows only. Open BrowserClaw once after installing so it initialises its local state.
3. **This extension**: grab the latest `browserclaw-<version>.mcpb` from the [releases page](https://github.com/browseros-ai/browserclaw-claude-desktop/releases).

No accounts, no API keys, no credentials needed. BrowserClaw runs entirely on the reviewer's machine and uses whatever browser sessions the reviewer already has.

## Install

1. Open Claude Desktop → Settings → Extensions.
2. Drag `browserclaw-<version>.mcpb` onto the Settings window.
3. Claude Desktop registers the extension and starts the wrapper automatically.

## Verify

With BrowserClaw open in the background, in a new Claude Desktop conversation ask:

> Open browseros.com/agents in a new tab and tell me the page title.

Expected behaviour:
- Claude calls BrowserClaw's `tabs` tool to open a new page.
- BrowserClaw opens a real Chromium tab.
- Claude calls `read` or `snapshot`.
- Claude answers with the page title.

If Claude answers "BrowserClaw is not running", confirm the BrowserClaw app is open. The extension only works while BrowserClaw is running.

## Tool surface

The extension forwards these tools from BrowserClaw:

| Tool | Purpose | Hint |
|---|---|---|
| `tabs` | Manage browser tabs (list, new, close, active) | destructive |
| `windows` | Manage browser windows | destructive |
| `tab_groups` | Manage tab groups | destructive |
| `navigate` | Load a URL, go back/forward, reload | destructive |
| `snapshot` | Capture the page as an indented accessibility tree with element refs | read-only |
| `diff` | Show what changed since the last snapshot | read-only |
| `read` | Extract page content as markdown / text / links | read-only |
| `grep` | Search page content by regex | read-only |
| `screenshot` | Capture a JPEG/PNG/WebP of the page | read-only |
| `pdf` | Save the page as a PDF file | read-only |
| `act` | Click / type / fill / press keys against elements from the snapshot | destructive |
| `upload` | Set file paths on `<input type="file">` | destructive |
| `download` | Trigger a file download from a snapshot ref | destructive |
| `evaluate` | Run JavaScript in a page context | destructive |
| `wait` | Pause for time / text appearance / selector match | read-only |
| `run` | Execute a server-side script against the browser SDK | destructive |

Every tool BrowserClaw currently exposes carries a `title` and either `readOnlyHint: true` or `destructiveHint: true`, and destructive tools prompt for confirmation in Claude Desktop as expected. The wrapper forwards BrowserClaw's `tools/list` verbatim; it does not add, validate, or override annotations. The table above reflects what a reviewer will see when sideloading the current release.

## Debugging

Extension logs are captured by Claude Desktop at:

- **macOS**: `~/Library/Logs/Claude/mcp-server-browserclaw.log`
- **Windows**: `%APPDATA%\Claude\logs\mcp-server-browserclaw.log`

A successful connection logs a line like:

```
[browserclaw] connected to BrowserClaw {"baseUrl":"http://127.0.0.1:9200","source":"runtime","serverInfo":{...}}
```

The `source` field indicates how the extension discovered BrowserClaw's URL: `override` (an explicitly configured URL in Settings; loopback only), `runtime` (preferred automatic discovery), `manifest`, `log`, or `default`.

## Uninstall

Claude Desktop → Settings → Extensions → BrowserClaw → Remove. BrowserClaw itself is unaffected.
