/**
 * Resolve a BrowserClaw base URL or return null.
 *
 * Priority (first match wins):
 *   1. BROWSERCLAW_URL_OVERRIDE env var (populated from user_config.url)
 *   2. Probe http://127.0.0.1:9200/system/health -> 200
 *
 * BrowserClaw does not write a discovery file today (unlike BrowserOS's
 * `~/.browseros/server.json`), so we rely on the single canonical port
 * `9200` documented in the claw-server package.
 *
 * Pure module: no SDK imports, no caching, no shared mutable state.
 */

const DEFAULT_URL = 'http://127.0.0.1:9200'
const HEALTH_PATH = '/system/health'
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
  return normalizeUrl(process.env.BROWSERCLAW_URL_OVERRIDE)
}

async function probeHealth(baseUrl) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(`${baseUrl}${HEALTH_PATH}`, {
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

async function fromDefaultPort() {
  return (await probeHealth(DEFAULT_URL)) ? DEFAULT_URL : null
}

/**
 * @returns {Promise<string | null>} The resolved base URL or null if BrowserClaw
 *   does not appear to be reachable.
 */
export async function discoverBaseUrl() {
  return (await fromEnvOverride()) || (await fromDefaultPort())
}
