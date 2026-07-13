/**
 * On-disk discovery helpers.
 *
 * claw-server writes its actually-bound base URL to two places whenever it
 * boots successfully:
 *
 *   1. `<configDir>/mcp-manager/manifest.json` — maintained by the
 *      agent-mcp-manager library that ships inside BrowserOS. On every
 *      boot, `migrateMcpUrls()` in claw-server rewrites any recorded
 *      server URL to the current `publicMcpUrl()`, so this file's
 *      `.servers["BrowserClaw"].spec.url` reflects the running port.
 *      Only present after at least one harness (Claude Code / Claude
 *      Desktop / etc.) has been linked; missing on a fresh install.
 *
 *   2. `<configDir>/claw-server.log` — pino-shaped JSON per line. The
 *      line `{"msg":"claw-server listening","url":"http://..."}` is
 *      written immediately after `Bun.serve()` returns, so this line
 *      exists after ANY successful bind, even before harnesses are
 *      linked.
 *
 * Both functions return the recorded URL or null. Never throw. Pure
 * module: no shared mutable state, no SDK imports.
 */

import { open, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const MANIFEST_REL = 'mcp-manager/manifest.json'
const LOG_REL = 'claw-server.log'
const LOG_LISTEN_MSG = 'claw-server listening'

// 32 KiB tail is generous. The bind line is written first thing after
// listen and is well under 512 bytes; anything more just protects
// against unusually chatty startup logging without paying for a full
// file read.
const LOG_TAIL_BYTES = 32 * 1024

/**
 * Read the mcp-manager manifest and extract the recorded BrowserClaw
 * base URL. Returns the URL string when the manifest has a
 * `.servers["BrowserClaw"]` entry with an http or sse transport.
 * Returns null for any other outcome (missing file, malformed JSON,
 * missing entry, stdio transport).
 *
 * @param {string} configDir Absolute path to the claw-server state
 *   directory, typically `~/.browserclaw`.
 * @returns {Promise<string | null>}
 */
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
  const entry = doc?.servers?.BrowserClaw
  const spec = entry?.spec
  if (!spec || typeof spec.url !== 'string') return null
  if (spec.transport !== 'http' && spec.transport !== 'sse') return null
  return spec.url
}

/**
 * Read the tail of the claw-server log and return the URL from the
 * most recent successful-listen line. Returns null when the file
 * doesn't exist, contains no listen line, or is otherwise unparseable.
 *
 * Reads only the last `LOG_TAIL_BYTES` to avoid pulling in a
 * rotated-but-not-yet-truncated file. Malformed JSON lines are
 * silently skipped so a transient stray write doesn't break discovery.
 *
 * @param {string} configDir Absolute path to the claw-server state
 *   directory.
 * @returns {Promise<string | null>}
 */
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
    // If the tail started mid-line (position > 0), the first fragment
    // is discarded so we never parse a truncated JSON line.
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
