#!/usr/bin/env node
/**
 * Entry point for the BrowserOS Claude Desktop extension.
 *
 * Claude Desktop spawns this as a stdio MCP server. We turn around and act
 * as an MCP client against the BrowserOS desktop app's StreamableHTTP MCP
 * endpoint at <discovered base>/mcp. Each Claude Desktop request is
 * forwarded to BrowserOS verbatim, so Claude sees BrowserOS's real tool
 * definitions (and the descriptions audited in the companion BrowserOS PR).
 *
 * Why the low-level Server (not McpServer):
 *   McpServer expects each tool registered up front. We are a proxy: we do
 *   not know the tool surface at start time, and we do not want to. Server
 *   plus setRequestHandler lets us forward by schema.
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  PingRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import { discoverBaseUrl } from './discovery.js'
import { openInnerClient, TransportConnectError } from './transport.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const BROWSEROS_DOWN_MESSAGE =
  "BrowserOS is not running. Open the BrowserOS app, then ask me again. " +
  "If you don't have BrowserOS installed yet, get it at https://browseros.com."

// ---------------------------------------------------------------------------
// stderr-only logging. Anything on stdout would corrupt the JSON-RPC framing.
// ---------------------------------------------------------------------------

function logInfo(msg, extra) {
  if (extra !== undefined) {
    process.stderr.write(`[browseros] ${msg} ${JSON.stringify(extra)}\n`)
  } else {
    process.stderr.write(`[browseros] ${msg}\n`)
  }
}

function logError(msg, err) {
  const detail = err instanceof Error ? err.message : String(err)
  process.stderr.write(`[browseros] error: ${msg}: ${detail}\n`)
}

// ---------------------------------------------------------------------------
// Version stamping from package.json so the inner client identity matches the
// version users see in their package.
// ---------------------------------------------------------------------------

async function readWrapperVersion() {
  try {
    const pkgPath = join(__dirname, '..', 'package.json')
    const raw = await readFile(pkgPath, 'utf8')
    return JSON.parse(raw).version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

// ---------------------------------------------------------------------------
// Inner client lifecycle. Single live connection at a time; the wrapper
// transparently reconnects on the next call when BrowserOS comes back up.
// ---------------------------------------------------------------------------

/**
 * Try to discover BrowserOS and open the inner client. Never throws. Returns
 * the handle on success, null on failure (caller decides what to surface).
 */
async function tryOpenInner(version) {
  const baseUrl = await discoverBaseUrl()
  if (!baseUrl) {
    logInfo('discovery: no BrowserOS URL found')
    return null
  }
  try {
    const inner = await openInnerClient(baseUrl, version)
    logInfo('connected to BrowserOS', { baseUrl, serverInfo: inner.serverInfo })
    return inner
  } catch (err) {
    if (err instanceof TransportConnectError) {
      logInfo('discovery: BrowserOS URL found but connect failed', {
        baseUrl,
      })
    } else {
      logError('inner connect threw', err)
    }
    return null
  }
}

/**
 * Run `op` against the current inner client, with one transparent reconnect
 * attempt on transport failure. Returns the inner client's response.
 *
 * `state` is mutated in place: `state.inner` is closed and replaced on the
 * reconnect path so subsequent calls reuse the fresh connection.
 *
 * Throws if both the first call and the post-reconnect retry fail.
 */
async function callWithReconnect(state, version, op) {
  if (state.inner) {
    try {
      return await op(state.inner)
    } catch (err) {
      logError('inner call failed, will try reconnect', err)
      try {
        await state.inner.close()
      } catch {}
      state.inner = null
    }
  }

  state.inner = await tryOpenInner(version)
  if (!state.inner) {
    throw new TransportConnectError(BROWSEROS_DOWN_MESSAGE)
  }
  return await op(state.inner)
}

// ---------------------------------------------------------------------------
// Build the outer Server and wire request handlers.
// ---------------------------------------------------------------------------

function buildOuterServer({ initialInner, version, state }) {
  // Match the inner server's capabilities when we have them so Claude
  // Desktop sees the BrowserOS surface. When we do not (BrowserOS was down
  // at startup), advertise tools-only so Claude does not give up on the
  // extension entirely. tools/call will return the down error in that case.
  const capabilities = initialInner?.capabilities ?? { tools: {} }

  const server = new Server(
    { name: 'browseros-claude-desktop', version },
    { capabilities },
  )

  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    try {
      return await callWithReconnect(state, version, (inner) =>
        inner.client.listTools(request.params),
      )
    } catch {
      // Decision per plan: return an empty list when BrowserOS is unreachable.
      // We do NOT advertise tools we cannot back, and we do NOT cache.
      return { tools: [] }
    }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      return await callWithReconnect(state, version, (inner) =>
        inner.client.callTool(request.params),
      )
    } catch {
      // MCP convention for tool-level failures: return a tool-result with
      // isError true. Throwing would surface as a protocol-level error
      // which Claude tends to swallow.
      return {
        content: [{ type: 'text', text: BROWSEROS_DOWN_MESSAGE }],
        isError: true,
      }
    }
  })

  server.setRequestHandler(PingRequestSchema, async () => {
    if (!state.inner) return {}
    try {
      await state.inner.client.ping()
    } catch {
      // Ping failures should not fail loudly; the next real call will
      // trigger reconnect.
    }
    return {}
  })

  return server
}

// ---------------------------------------------------------------------------
// Lifecycle: install signal handlers so we tear down the inner client on
// shutdown instead of leaking sockets.
// ---------------------------------------------------------------------------

function installSignalHandlers(state, server) {
  let shuttingDown = false
  const shutdown = async (signal) => {
    if (shuttingDown) return
    shuttingDown = true
    logInfo(`shutdown on ${signal}`)
    try {
      await state.inner?.close()
    } catch {}
    try {
      await server.close()
    } catch {}
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const version = await readWrapperVersion()
  logInfo('starting', { version })

  const initialInner = await tryOpenInner(version)
  const state = { inner: initialInner }

  const server = buildOuterServer({ initialInner, version, state })
  installSignalHandlers(state, server)

  await server.connect(new StdioServerTransport())
  logInfo('outer server connected to stdio')
}

main().catch((err) => {
  logError('fatal', err)
  process.exit(1)
})
