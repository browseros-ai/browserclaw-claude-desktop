/** Read BrowserOS neo discovery records from the legacy state directory. */

import { open, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const RUNTIME_REL = 'runtime.json'
const MANIFEST_REL = 'mcp-manager/manifest.json'
const LOG_REL = 'claw-server.log'
const LOG_LISTEN_MSG = 'claw-server listening'
const MCP_SERVER_NAMES = ['BrowserOS neo', 'BrowserClaw']

// One MiB covers long sessions without reading the full 20 MiB rotating log.
const LOG_TAIL_BYTES = 1024 * 1024

/** Return the recorded runtime URL, or null for unreadable or invalid data. */
export async function readRuntimeUrl(configDir) {
  const path = join(configDir, RUNTIME_REL)
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return null
  }
  try {
    const doc = JSON.parse(raw)
    return typeof doc?.url === 'string' ? doc.url : null
  } catch {
    return null
  }
}

/** Prefer the BrowserOS neo manifest entry, then its legacy BrowserClaw alias. */
export async function readManifestUrl(configDir) {
  const path = join(configDir, MANIFEST_REL)
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return null
  }
  let doc
  try {
    doc = JSON.parse(raw)
  } catch {
    return null
  }
  for (const serverName of MCP_SERVER_NAMES) {
    const spec = doc?.servers?.[serverName]?.spec
    if (!spec || typeof spec.url !== 'string') continue
    const transport =
      typeof spec.transport === 'string'
        ? spec.transport
        : spec.transport?.type
    if (transport === 'http' || transport === 'sse') return spec.url
  }
  return null
}

/** Return the most recent listening URL from the bounded log tail. */
export async function readLogUrl(configDir) {
  const path = join(configDir, LOG_REL)
  let handle
  try {
    handle = await open(path, 'r')
  } catch {
    return null
  }
  try {
    const stat = await handle.stat()
    const size = stat.size
    if (size <= 0) return null
    const len = Math.min(size, LOG_TAIL_BYTES)
    const position = size - len
    const buf = Buffer.alloc(len)
    await handle.read(buf, 0, len, position)
    const text = buf.toString('utf8')
    // A bounded tail may begin with an unparseable partial record.
    const lines = text.split('\n')
    if (position > 0 && lines.length > 0) lines.shift()
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim()
      if (!line) continue
      let obj
      try {
        obj = JSON.parse(line)
      } catch {
        continue
      }
      if (obj && obj.msg === LOG_LISTEN_MSG && typeof obj.url === 'string') {
        return obj.url
      }
    }
    return null
  } catch {
    return null
  } finally {
    await handle.close().catch(() => {})
  }
}
