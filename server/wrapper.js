#!/usr/bin/env node

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

const DOWN_MESSAGES = {
  'not-installed':
    'BrowserOS neo does not appear to be installed on this machine. ' +
    'Install it from https://browseros.com/agents, then ask me again.',
  'installed-not-running':
    'BrowserOS neo is installed but I could not reach it. I checked the ' +
    "running-port record and the default (http://127.0.0.1:9200), and " +
    'got no response on either.\n\n' +
    '  1. Is BrowserOS neo open? The MCP server runs while the app is running.\n' +
    '  2. If BrowserOS neo runs on a custom port, set the base URL in ' +
    'Claude Desktop -> Settings -> BrowserOS neo -> Configure.',
}

function messageForResult(result) {
  if (!result || result.state === 'running') return ''
  if (result.state === 'override-not-loopback') {
    return (
      `The configured BrowserOS neo URL ${result.attempted} is not a ` +
      'loopback address. For security, only URLs on 127.0.0.1, [::1], ' +
      'or localhost are allowed. Update the URL in Claude Desktop -> ' +
      'Settings -> BrowserOS neo -> Configure, or leave it blank to ' +
      'auto-discover.'
    )
  }
  if (result.state === 'override-unreachable') {
    return (
      `The configured BrowserOS neo URL ${result.attempted} is unreachable. ` +
      'Check the URL in Claude Desktop -> Settings -> BrowserOS neo -> ' +
      'Configure, or leave it blank to auto-discover on the default port.'
    )
  }
  return DOWN_MESSAGES[result.state]
}

function logInfo(msg, extra) {
  if (extra !== undefined) {
    process.stderr.write(`[browseros-neo] ${msg} ${JSON.stringify(extra)}\n`)
  } else {
    process.stderr.write(`[browseros-neo] ${msg}\n`)
  }
}

function logError(msg, err) {
  const detail = err instanceof Error ? err.message : String(err)
  process.stderr.write(`[browseros-neo] error: ${msg}: ${detail}\n`)
}

async function readWrapperVersion() {
  try {
    const pkgPath = join(__dirname, '..', 'package.json')
    const raw = await readFile(pkgPath, 'utf8')
    return JSON.parse(raw).version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

// Deduplicate offline polling noise without suppressing the first reconnect log.
function logDiscoveryOutcome(state, msg, extra) {
  const key = extra === undefined ? msg : `${msg}|${JSON.stringify(extra)}`
  if (state.lastDiscoveryLog === key) return
  state.lastDiscoveryLog = key
  logInfo(msg, extra)
}

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
    logDiscoveryOutcome(state, 'connected to BrowserOS neo', {
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
        'discovery: BrowserOS neo URL found but connect failed',
        {
          baseUrl: result.url,
          attempted: `${result.url}/mcp`,
          cause: causeMsg,
        },
      )
      state.lastResult = { state: 'installed-not-running', url: null }
    } else {
      logError('inner connect threw', err)
    }
    return null
  }
}

// Share one reconnect promise so concurrent calls cannot create duplicate MCP clients.
async function getOrOpenInner(state, version) {
  if (state.inner) return state.inner
  if (!state.reconnect) {
    state.reconnect = tryOpenInner(state, version).finally(() => {
      state.reconnect = null
    })
  }
  const inner = await state.reconnect
  state.inner = inner
  return inner
}

async function callWithReconnect(state, version, op) {
  if (state.inner) {
    try {
      return await op(state.inner)
    } catch (err) {
      logError('inner call failed, will try reconnect', err)
      const stale = state.inner
      state.inner = null
      // A successful reconnect must be visible even when it returns to the same URL.
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

function buildOuterServer({ initialInner, version, state }) {
  // Advertising tools while offline lets Claude retry instead of disabling the extension.
  const capabilities = initialInner?.capabilities ?? { tools: {} }

  const server = new Server(
    { name: 'browseros-neo-claude-desktop', version },
    { capabilities },
  )

  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    try {
      return await callWithReconnect(state, version, (inner) =>
        inner.client.listTools(request.params),
      )
    } catch {
      return { tools: [] }
    }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      return await callWithReconnect(state, version, (inner) =>
        inner.client.callTool(request.params),
      )
    } catch {
      // Protocol-level errors may be swallowed, so connection failures use a tool result.
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
    } catch {}
    return {}
  })

  return server
}

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
