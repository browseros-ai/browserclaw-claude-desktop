/**
 * Resolve a BrowserOS base URL or return null.
 *
 * Priority (first match wins):
 *   1. BROWSEROS_URL_OVERRIDE env var (populated from user_config.url)
 *   2. ~/.browseros/server.json `url` field
 *   3. Probe common ports 9100, 9200, 9300 for GET <base>/health -> 200
 *
 * Pure module: no SDK imports, no caching, no shared mutable state.
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SERVER_JSON_PATH = join(homedir(), '.browseros', 'server.json')
const COMMON_PORTS = [9100, 9200, 9300]
const PROBE_TIMEOUT_MS = 1000

/**
 * Strip trailing slashes, validate scheme. Returns the cleaned URL or null.
 */
function normalizeUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null
  let trimmed = raw.trim().replace(/\/+$/, '')
  // Forgive a paste of the full MCP endpoint. openInnerClient appends "/mcp"
  // when it opens the transport; keeping a trailing "/mcp" on the base would
  // 404 with no diagnostic for the user.
  if (/\/mcp$/i.test(trimmed)) {
    trimmed = trimmed.slice(0, -4)
  }
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return trimmed
  } catch {
    return null
  }
}

async function fromEnvOverride() {
  return normalizeUrl(process.env.BROWSEROS_URL_OVERRIDE)
}

async function fromServerJson() {
  try {
    const raw = await readFile(SERVER_JSON_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    return normalizeUrl(parsed?.url)
  } catch {
    // ENOENT, parse error, or missing url field all collapse to "skip".
    return null
  }
}

async function probeHealth(baseUrl) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      signal: controller.signal,
    })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

async function fromCommonPorts() {
  for (const port of COMMON_PORTS) {
    const candidate = `http://127.0.0.1:${port}`
    if (await probeHealth(candidate)) return candidate
  }
  return null
}

/**
 * @returns {Promise<string | null>} The resolved base URL or null if BrowserOS
 *   does not appear to be reachable.
 */
export async function discoverBaseUrl() {
  return (
    (await fromEnvOverride()) ||
    (await fromServerJson()) ||
    (await fromCommonPorts())
  )
}
