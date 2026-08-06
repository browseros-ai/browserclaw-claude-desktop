# BrowserOS neo for Claude Desktop

## Install the extension

1. Download the latest `browseros-neo-<version>.mcpb` from the [releases](https://github.com/browseros-ai/browseros-claude-desktop/releases) page.
2. In Claude Desktop, open Settings.
3. In Settings, click Extensions in the sidebar, under the Desktop app section.
4. Click Advanced settings.
5. On the next screen, click Install extension and select the `.mcpb` file you downloaded.

Claude Desktop loads the extension automatically.

You also need [BrowserOS neo](https://browseros.com/agents) and [Claude Desktop](https://claude.ai/download).

## Try it

Open BrowserOS neo, then ask Claude:

> Open browseros.com/agents in a new tab and tell me the page title.

Claude can now use BrowserOS neo to open sites, sign in, click through pages, and read content.

## Troubleshooting

**Claude says BrowserOS neo is not running:** Open BrowserOS neo and try again.

**Claude does not use BrowserOS neo:** Ask it to "use BrowserOS neo" for the task.

**The extension does not load:** Open BrowserOS neo at least once, then reinstall the latest `.mcpb` from the [releases](https://github.com/browseros-ai/browseros-claude-desktop/releases) page.

## Privacy

The extension collects nothing and only passes messages between Claude Desktop and BrowserOS neo on your computer. See the [privacy policy](https://docs.browseros.com/neo/privacy).

## How it works

BrowserOS neo runs a local MCP server at `http://127.0.0.1:9200/mcp`. The extension forwards Claude Desktop's browser requests to it.

```text
Claude Desktop <-> extension <-> BrowserOS neo
```

If BrowserOS neo uses a custom port, set its URL in Claude Desktop under Settings -> Extensions -> BrowserOS neo -> Configure. Leave it blank to use the default port.
