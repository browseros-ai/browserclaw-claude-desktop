import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

// Keep the legacy client name so BrowserOS neo preserves existing client attribution.
const WRAPPER_NAME = 'browserclaw-claude-desktop-wrapper'

export class TransportConnectError extends Error {
  constructor(userMessage, cause) {
    super(userMessage)
    this.name = 'TransportConnectError'
    this.userMessage = userMessage
    if (cause) this.cause = cause
  }
}

export async function openInnerClient(baseUrl, version) {
  const endpoint = new URL(`${baseUrl}/mcp`)
  const transport = new StreamableHTTPClientTransport(endpoint)

  const client = new Client(
    { name: WRAPPER_NAME, version },
    { capabilities: {} },
  )

  try {
    await client.connect(transport)
  } catch (cause) {
    try {
      await transport.close()
    } catch {}
    throw new TransportConnectError(
      `could not connect to BrowserOS neo at ${endpoint.href}`,
      cause,
    )
  }

  return {
    client,
    serverInfo: client.getServerVersion(),
    capabilities: client.getServerCapabilities(),
    close: async () => {
      try {
        await client.close()
      } catch {}
    },
  }
}
