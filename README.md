# BrowserClaw for Claude Desktop

## Install the extension

1. Download the latest `browserclaw-<version>.mcpb` from the [releases](https://github.com/browseros-ai/browserclaw-claude-desktop/releases) page.
2. In Claude Desktop, open Settings.
3. In Settings, click Extensions in the sidebar, under the Desktop app section.
4. Click Advanced settings.
5. On the next screen, click Install extension and select the `.mcpb` file you downloaded.

Claude Desktop loads the extension automatically.

You also need [BrowserClaw](https://browseros.com/agents) and [Claude Desktop](https://claude.ai/download).

## Try it

Open BrowserClaw, then ask Claude:

> Open browseros.com/agents in a new tab and tell me the page title.

Claude can now use BrowserClaw to open sites, sign in, click through pages, and read content.

## Troubleshooting

**Claude says BrowserClaw is not running:** Open BrowserClaw and try again.

**Claude does not use BrowserClaw:** Ask it to "use BrowserClaw" for the task.

**The extension does not load:** Open BrowserClaw at least once, then reinstall the latest `.mcpb` from the [releases](https://github.com/browseros-ai/browserclaw-claude-desktop/releases) page.

## Privacy

The extension collects nothing and only passes messages between Claude Desktop and BrowserClaw on your computer. See the [privacy policy](https://browseros.com/privacy/browserclaw-extension).

## How it works

BrowserClaw runs a local MCP server at `http://127.0.0.1:9200/mcp`. The extension forwards Claude Desktop's browser requests to it.

```text
Claude Desktop <-> extension <-> BrowserClaw
```

If BrowserClaw uses a custom port, set its URL in Claude Desktop under Settings -> Extensions -> BrowserClaw -> Configure. Leave it blank to use the default port.
