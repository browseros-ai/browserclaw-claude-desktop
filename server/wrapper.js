#!/usr/bin/env node
/**
 * Entry point for the BrowserClaw Claude Desktop extension.
 *
 * Claude Desktop spawns this as a stdio MCP server. We turn around and act
 * as an MCP client against the BrowserClaw claw-server's StreamableHTTP MCP
 * endpoint at <discovered base>/mcp. Each Claude Desktop request is
 * forwarded to BrowserClaw verbatim, so Claude sees BrowserClaw's real tool
 * definitions.
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

// ---------------------------------------------------------------------------
// User-facing messages keyed by discovery state. Each message is a single
// self-contained instruction: what the reader should do next. Empty string
// for `running` because there is nothing to say on the happy path.
// ---------------------------------------------------------------------------

const DOWN_MESSAGES = {
  'not-installed':
    'BrowserClaw does not appear to be installed on this machine. ' +
    'Install it from https://browseros.com/agents, then ask me again.',
  'installed-not-running':
    'BrowserClaw is installed but I could not reach it on ' +
    'http://127.0.0.1:9200. Two things to check:\n\n' +
    '  1. Is BrowserClaw open? The MCP server runs while the app is running.\n' +
    '  2. Is BrowserClaw running on a different port? If so, set the base URL ' +
    'in Claude Desktop -> Settings -> BrowserClaw -> Configure.',
}

/**
 * Renders the discovery result into the corresponding user-facing message.
 * `override-unreachable` interpolates the offending URL so the reader knows
 * exactly which value in Settings is stale; other states are static.
 */
function messageForResult(result) {
  if (!result || result.state === 'running') return ''
  if (result.state === 'override-unreachable') {
    return (
      `The configured BrowserClaw URL ${result.attempted} is unreachable. ` +
      'Check the URL in Claude Desktop -> Settings -> BrowserClaw -> ' +
      'Configure, or leave it blank to auto-discover on the default port.'
    )
  }
  return DOWN_MESSAGES[result.state]
}

// ---------------------------------------------------------------------------
// stderr-only logging. Anything on stdout would corrupt the JSON-RPC framing.
// ---------------------------------------------------------------------------

function logInfo(msg, extra) {
  if (extra !== undefined) {
    process.stderr.write(`[browserclaw] ${msg} ${JSON.stringify(extra)}\n`)
  } else {
    process.stderr.write(`[browserclaw] ${msg}\n`)
  }
}

function logError(msg, err) {
  const detail = err instanceof Error ? err.message : String(err)
  process.stderr.write(`[browserclaw] error: ${msg}: ${detail}\n`)
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
// transparently reconnects on the next call when BrowserClaw comes back up.
// ---------------------------------------------------------------------------

/**
 * Emit a discovery-outcome log line only when the outcome key changes.
 * Without this, a long offline period would spam stderr with one
 * identical line per Claude Desktop poll, since callers re-enter
 * tryOpenInner on every request that finds state.inner === null.
 */
function logDiscoveryOutcome(state, msg, extra) {
  const key = extra === undefined ? msg : `${msg}|${JSON.stringify(extra)}`
  if (state.lastDiscoveryLog === key) return
  state.lastDiscoveryLog = key
  logInfo(msg, extra)
}

/**
 * Try to discover BrowserClaw and open the inner client. Never throws.
 * Returns the handle on success, null on failure (caller decides what to
 * surface). Stashes the latest discovery result on `state.lastResult` so
 * the tool-call error handler can pick the right user-facing message.
 */
async function tryOpenInner(state, version) {
  const result = await discoverBaseUrl()
  state.lastResult = result

  if (result.state !== 'running') {
    logDiscoveryOutcome(
      state,
      `discovery: ${result.state}`,
      result.attempted ? { attempted: result.attempted } : undefined,
    )
    return null
  }

  try {
    const inner = await openInnerClient(result.url, version)
    logDiscoveryOutcome(state, 'connected to BrowserClaw', {
      baseUrl: result.url,
      source: result.source,
      serverInfo: inner.serverInfo,
    })
    return inner
  } catch (err) {
    if (err instanceof TransportConnectError) {
      const causeMsg =
        err.cause instanceof Error
          ? err.cause.message
          : String(err.cause ?? '')
      logDiscoveryOutcome(
        state,
        'discovery: BrowserClaw URL found but connect failed',
        {
          baseUrl: result.url,
          attempted: `${result.url}/mcp`,
          cause: causeMsg,
        },
      )
      // Transport rejects fold into the same state the user was already in.
      // Re-tag as installed-not-running so the tool-call message tells the
      // reader to check that BrowserClaw is open and on the expected port,
      // instead of leaving the last successful `running` result stashed.
      state.lastResult = { state: 'installed-not-running', url: null }
    } else {
      logError('inner connect threw', err)
    }
    return null
  }
}

/**
 * Single-flight reconnect: concurrent callers share one in-flight
 * `tryOpenInner` so we never end up with multiple live MCP Clients pointing
 * at the same BrowserClaw instance, each holding an open HTTP transport.
 * The first caller to find `state.inner === null` creates the promise on
 * `state.reconnect` and stores its resolved value into `state.inner`.
 * Subsequent callers that race in await the same promise. `.finally()`
 * clears `state.reconnect` after the promise settles so the next disconnect
 * can trigger a fresh attempt.
 */
async function getOrOpenInner(state, version) {
  if (state.inner) return state.inner
  if (!state.reconnect) {
    state.reconnect = tryOpenInner(state, version).finally(() => {
      state.reconnect = null
    })
  }
  const inner = await state.reconnect
  // Both racing callers will reach this line and idempotently set the same
  // resolved value; assignment is intentional.
  state.inner = inner
  return inner
}

/**
 * Run `op` against the current inner client, with one transparent reconnect
 * attempt on transport failure. Returns the inner client's response.
 *
 * Throws if both the first call and the post-reconnect retry fail.
 */
async function callWithReconnect(state, version, op) {
  if (state.inner) {
    try {
      return await op(state.inner)
    } catch (err) {
      logError('inner call failed, will try reconnect', err)
      const stale = state.inner
      state.inner = null
      // Clear the dedup key so a successful reconnect logs the new
      // "connected to BrowserClaw" line even when the URL+serverInfo are
      // identical to the previous connect (the common case for a
      // transient transport blip).
      state.lastDiscoveryLog = undefined
      try {
        await stale.close()
      } catch {}
    }
  }

  const inner = await getOrOpenInner(state, version)
  if (!inner) {
    throw new TransportConnectError(messageForResult(state.lastResult))
  }
  return await op(inner)
}

// ---------------------------------------------------------------------------
// Build the outer Server and wire request handlers.
// ---------------------------------------------------------------------------

function buildOuterServer({ initialInner, version, state }) {
  // Match the inner server's capabilities when we have them so Claude
  // Desktop sees the BrowserClaw surface. When we do not (BrowserClaw was
  // down at startup), advertise tools-only so Claude does not give up on
  // the extension entirely. tools/call will return the down error in that
  // case.
  const capabilities = initialInner?.capabilities ?? { tools: {} }

  const server = new Server(
    { name: 'browserclaw-claude-desktop', version },
    { capabilities },
  )

  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    try {
      return await callWithReconnect(state, version, (inner) =>
        inner.client.listTools(request.params),
      )
    } catch {
      // Decision per plan: return an empty list when BrowserClaw is
      // unreachable. We do NOT advertise tools we cannot back, and we do
      // NOT cache.
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
        content: [{ type: 'text', text: messageForResult(state.lastResult) }],
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

  const state = { inner: null, lastResult: null }
  state.inner = await tryOpenInner(state, version)

  const server = buildOuterServer({
    initialInner: state.inner,
    version,
    state,
  })
  installSignalHandlers(state, server)

  await server.connect(new StdioServerTransport())
  logInfo('outer server connected to stdio')
}

main().catch((err) => {
  logError('fatal', err)
  process.exit(1)
})
