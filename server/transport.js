/**
 * Owns the lifecycle of one HTTP-side MCP Client connected to the BrowserOS
 * desktop app's stateless `/mcp` endpoint via Streamable HTTP.
 *
 * The Node SDK API used here:
 *   - Client (from '@modelcontextprotocol/sdk/client')
 *   - StreamableHTTPClientTransport
 *     (from '@modelcontextprotocol/sdk/client/streamableHttp.js')
 *
 * The transport reports server metadata after connect() via the Client's
 * getServerVersion() and getServerCapabilities() helpers.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const WRAPPER_NAME = 'browseros-claude-desktop-wrapper'

/**
 * Custom error type so the wrapper can distinguish connect failures from
 * downstream protocol errors without inspecting strings.
 */
export class TransportConnectError extends Error {
  constructor(userMessage, cause) {
    super(userMessage)
    this.name = 'TransportConnectError'
    this.userMessage = userMessage
    if (cause) this.cause = cause
  }
}

/**
 * Open and initialize one MCP Client against `<baseUrl>/mcp`.
 *
 * Throws TransportConnectError if the connection cannot be established or the
 * initialize handshake fails. Callers are responsible for translating the
 * thrown error into the user-facing "BrowserOS not running" message.
 *
 * @param {string} baseUrl  Discovered base, e.g. http://127.0.0.1:9100
 * @param {string} version  The wrapper's own version, from package.json
 * @returns {Promise<{
 *   client: Client,
 *   serverInfo: { name: string, version: string } | undefined,
 *   capabilities: object | undefined,
 *   close: () => Promise<void>
 * }>}
 */
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
    // Best-effort cleanup; ignore secondary errors during teardown.
    try {
      await transport.close()
    } catch {}
    throw new TransportConnectError(
      `could not connect to BrowserOS at ${endpoint.href}`,
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
