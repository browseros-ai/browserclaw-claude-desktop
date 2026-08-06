# Notes for Anthropic Directory reviewers

This document walks a reviewer end-to-end from a clean machine to a working test of the extension.

## What the extension is

A small stdio MCP server that Claude Desktop spawns as a subprocess. It has no tools of its own. It discovers a running BrowserOS neo instance on the same machine and forwards Claude Desktop's tool calls to BrowserOS neo's local MCP endpoint. Every tool Claude sees in `tools/list` comes from BrowserOS neo.

## What you need

1. **Claude Desktop**: download from https://claude.ai/download.
2. **BrowserOS neo**: download from https://browseros.com/agents. macOS and Windows only. Open BrowserOS neo once after installing so it initialises its local state.
3. **This extension**: grab the latest `browseros-neo-<version>.mcpb` from the [releases page](https://github.com/browseros-ai/browseros-claude-desktop/releases).

No accounts, no API keys, no credentials needed. BrowserOS neo runs entirely on the reviewer's machine and uses whatever browser sessions the reviewer already has.

## Install

1. Open Claude Desktop → Settings → Extensions.
2. Drag `browseros-neo-<version>.mcpb` onto the Settings window.
3. Claude Desktop registers the extension and starts the wrapper automatically.

## Verify

With BrowserOS neo open in the background, in a new Claude Desktop conversation ask:

> Open browseros.com/agents in a new tab and tell me the page title.

Expected behaviour:
- Claude calls BrowserOS neo's `tabs` tool to open a new page.
- BrowserOS neo opens a real Chromium tab.
- Claude calls `read` or `snapshot`.
- Claude answers with the page title.

If Claude answers "BrowserOS neo is not running", confirm BrowserOS neo is open. The extension only works while BrowserOS neo is running.

## Tool surface

The extension forwards these tools from BrowserOS neo:

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

Every tool BrowserOS neo currently exposes carries a `title` and either `readOnlyHint: true` or `destructiveHint: true`, and destructive tools prompt for confirmation in Claude Desktop as expected. The wrapper forwards BrowserOS neo's `tools/list` verbatim; it does not add, validate, or override annotations. The table above reflects what a reviewer will see when sideloading the current release.

## Debugging

Extension logs are captured by Claude Desktop at:

- **macOS**: `~/Library/Logs/Claude/mcp-server-browserclaw.log`
- **Windows**: `%APPDATA%\Claude\logs\mcp-server-browserclaw.log`

The log filename retains the extension's original machine ID so existing installations upgrade in place.

A successful connection logs a line like:

```
[browseros-neo] connected to BrowserOS neo {"baseUrl":"http://127.0.0.1:9200","source":"runtime","serverInfo":{...}}
```

The `source` field indicates how the extension discovered BrowserOS neo's URL: `override` (an explicitly configured URL in Settings; loopback only), `runtime` (preferred automatic discovery), `manifest`, `log`, or `default`.

## Uninstall

Claude Desktop → Settings → Extensions → BrowserOS neo → Remove. BrowserOS neo itself is unaffected.
