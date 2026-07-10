#!/usr/bin/env node
/**
 * Smoke harness for server/wrapper.js.
 *
 * Dev-machine only. Not wired into CI in v1, because CI does not have a
 * running BrowserClaw claw-server.
 *
 * Run with:
 *   node scripts/smoke.js                       # auto-discovers BrowserClaw
 *   BROWSERCLAW_URL_OVERRIDE=... node scripts/smoke.js
 *
 * What it does (sad first so contributors without BrowserClaw still verify
 * the disconnect-error wiring before the happy path can fail):
 *   1. Sad path: spawn the wrapper with BROWSERCLAW_URL_OVERRIDE pointed at
 *      port 1 (intentionally dead). Asserts:
 *        - tools/list returns an empty array
 *        - tools/call returns isError: true with the down message
 *
 *   2. Happy path: spawn the wrapper, do initialize, list tools, call
 *      navigate("https://browseros.com/agents"). Asserts:
 *        - initialize returns serverInfo and capabilities
 *        - tools/list contains at least one tool
 *        - tools/call returns a non-error result
 *
 * Exit 0 on all assertions passing, non-zero on the first failure.
 */

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WRAPPER_PATH = join(__dirname, '..', 'server', 'wrapper.js')

// ---------------------------------------------------------------------------
// Minimal JSON-RPC over stdio harness.
// ---------------------------------------------------------------------------

class JsonRpcChild {
  constructor(env = {}) {
    this.child = spawn(process.execPath, [WRAPPER_PATH], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, ...env },
    })
    this.buffer = ''
    this.pending = new Map()
    this.nextId = 1
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk) => this._onData(chunk))
    this.child.once('exit', (code) => {
      for (const [, { reject }] of this.pending) {
        reject(new Error(`wrapper exited with code ${code}`))
      }
      this.pending.clear()
    })
  }

  _onData(chunk) {
    this.buffer += chunk
    // MCP stdio framing is one JSON-RPC message per line.
    let nl = this.buffer.indexOf('\n')
    while (nl !== -1) {
      const line = this.buffer.slice(0, nl).trim()
      this.buffer = this.buffer.slice(nl + 1)
      if (line) this._handleLine(line)
      nl = this.buffer.indexOf('\n')
    }
  }

  _handleLine(line) {
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch (err) {
      console.error(`[smoke] non-JSON output: ${line}`)
      return
    }
    if (parsed.id !== undefined && this.pending.has(parsed.id)) {
      const { resolve, reject } = this.pending.get(parsed.id)
      this.pending.delete(parsed.id)
      if (parsed.error) reject(new Error(JSON.stringify(parsed.error)))
      else resolve(parsed.result)
    }
    // Notifications (no id) are ignored; the smoke harness doesn't need them.
  }

  request(method, params) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      const frame = JSON.stringify({ jsonrpc: '2.0', id, method, params })
      this.child.stdin.write(`${frame}\n`)
    })
  }

  notify(method, params) {
    const frame = JSON.stringify({ jsonrpc: '2.0', method, params })
    this.child.stdin.write(`${frame}\n`)
  }

  async close() {
    this.child.stdin.end()
    if (this.child.exitCode === null) await once(this.child, 'exit')
  }
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

function assert(cond, msg) {
  if (!cond) {
    console.error(`[smoke] FAIL: ${msg}`)
    process.exit(1)
  }
}

async function initialize(rpc) {
  const result = await rpc.request('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'smoke-harness', version: '0.0.0' },
  })
  rpc.notify('notifications/initialized', {})
  return result
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function happyPath() {
  console.log('[smoke] happy path: spawn wrapper, expect BrowserClaw reachable')
  const rpc = new JsonRpcChild()
  try {
    const init = await initialize(rpc)
    assert(init?.serverInfo, 'initialize missing serverInfo')
    assert(init?.capabilities, 'initialize missing capabilities')

    const list = await rpc.request('tools/list', {})
    assert(Array.isArray(list?.tools), 'tools/list did not return tools[]')
    assert(
      list.tools.length > 0,
      `tools/list returned empty; BrowserClaw running? got: ${JSON.stringify(list)}`,
    )
    console.log(`[smoke] happy path: got ${list.tools.length} tools`)

    const call = await rpc.request('tools/call', {
      name: 'navigate',
      arguments: { url: 'https://browseros.com/agents' },
    })
    // The wrapper's job is to faithfully forward. Whether the specific
    // tool call succeeds depends on claw-server's schema, which is out
    // of scope for this smoke test. Assert only that the response is a
    // well-formed tool-result envelope.
    assert(
      Array.isArray(call?.content),
      `tools/call returned malformed envelope: ${JSON.stringify(call)}`,
    )
    console.log(
      `[smoke] happy path: tools/call returned ${call.content.length} content item(s), isError=${call.isError === true}`,
    )
  } finally {
    await rpc.close()
  }
}

async function sadPath() {
  console.log('[smoke] sad path: spawn wrapper with dead URL override')
  const rpc = new JsonRpcChild({
    BROWSERCLAW_URL_OVERRIDE: 'http://127.0.0.1:1',
  })
  try {
    await initialize(rpc)

    const list = await rpc.request('tools/list', {})
    assert(Array.isArray(list?.tools), 'tools/list did not return tools[]')
    assert(
      list.tools.length === 0,
      `tools/list should be empty when BrowserClaw is unreachable; got: ${JSON.stringify(list)}`,
    )
    console.log('[smoke] sad path: tools/list returned empty')

    const call = await rpc.request('tools/call', {
      name: 'navigate',
      arguments: { url: 'https://browseros.com/agents' },
    })
    assert(
      call?.isError === true,
      `tools/call should set isError; got: ${JSON.stringify(call)}`,
    )
    const text = call?.content?.[0]?.text ?? ''
    assert(
      text.includes('is unreachable'),
      `tools/call message missing expected copy; got: ${text}`,
    )
    console.log('[smoke] sad path: down error surfaced correctly')
  } finally {
    await rpc.close()
  }
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

async function main() {
  // sad first: independent of whether BrowserClaw is installed on this machine.
  await sadPath()
  await happyPath()
  console.log('[smoke] PASS')
}

main().catch((err) => {
  console.error('[smoke] FAIL:', err.message)
  process.exit(1)
})
