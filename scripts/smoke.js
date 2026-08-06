#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WRAPPER_PATH = join(__dirname, '..', 'server', 'wrapper.js')

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
    const exited = this.child.exitCode === null ? once(this.child, 'exit') : null
    this.child.stdin.end()
    if (!exited) return
    this.child.kill('SIGTERM')
    await exited
  }
}

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

async function happyPath() {
  console.log('[smoke] happy path: spawn wrapper, expect BrowserOS neo reachable')
  const rpc = new JsonRpcChild()
  try {
    const init = await initialize(rpc)
    assert(init?.serverInfo, 'initialize missing serverInfo')
    assert(init?.capabilities, 'initialize missing capabilities')

    const list = await rpc.request('tools/list', {})
    assert(Array.isArray(list?.tools), 'tools/list did not return tools[]')
    assert(
      list.tools.length > 0,
      `tools/list returned empty; BrowserOS neo running? got: ${JSON.stringify(list)}`,
    )
    console.log(`[smoke] happy path: got ${list.tools.length} tools`)

    const call = await rpc.request('tools/call', {
      name: 'navigate',
      arguments: { url: 'https://browseros.com/agents' },
    })
    // Tool schemas can change independently, so only the forwarded envelope is stable here.
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
    BROWSEROS_NEO_URL_OVERRIDE: 'http://127.0.0.1:1',
  })
  try {
    await initialize(rpc)

    const list = await rpc.request('tools/list', {})
    assert(Array.isArray(list?.tools), 'tools/list did not return tools[]')
    assert(
      list.tools.length === 0,
      `tools/list should be empty when BrowserOS neo is unreachable; got: ${JSON.stringify(list)}`,
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

async function nonLoopbackPath() {
  console.log('[smoke] non-loopback path: spawn wrapper with a public URL override')
  const rpc = new JsonRpcChild({
    BROWSEROS_NEO_URL_OVERRIDE: 'https://evil.example.com/mcp',
  })
  try {
    await initialize(rpc)

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
      text.includes('is not a loopback address'),
      `tools/call message missing loopback-rejection copy; got: ${text}`,
    )
    console.log('[smoke] non-loopback path: rejection message surfaced correctly')
  } finally {
    await rpc.close()
  }
}

async function main() {
  // Failure paths run first because the happy path requires a live BrowserOS neo instance.
  await sadPath()
  await nonLoopbackPath()
  await happyPath()
  console.log('[smoke] PASS')
}

main().catch((err) => {
  console.error('[smoke] FAIL:', err.message)
  process.exit(1)
})
