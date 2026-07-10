/**
 * Resolve a BrowserClaw base URL and report why if we cannot.
 *
 * Returns a tagged discriminant so the wrapper can render distinct
 * error messages per failure mode:
 *
 *   { state: 'running', url, source: 'override' | 'default' }
 *   { state: 'override-unreachable', url: null, attempted }
 *   { state: 'not-installed', url: null }
 *   { state: 'installed-not-running', url: null }
 *
 * State machine:
 *
 *   BROWSERCLAW_URL_OVERRIDE is set:
 *     parses AND probeHealth passes  -> running (override)
 *     otherwise                      -> override-unreachable
 *
 *   no override:
 *     ~/.browserclaw is missing      -> not-installed
 *     probeHealth on 9200 fails      -> installed-not-running
 *     otherwise                      -> running (default)
 *
 * Dev-mode claw-server (which uses `~/.browserclaw-dev`) is NOT
 * detected. Dev users must set BROWSERCLAW_URL_OVERRIDE explicitly.
 *
 * Pure module: no SDK imports, no caching, no shared mutable state.
 */

import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_URL = 'http://127.0.0.1:9200'
const HEALTH_PATH = '/system/health'
const CONFIG_DIR = join(homedir(), '.browserclaw')
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

/**
 * True when the claw-server's state directory exists on disk. Created on
 * first launch of the BrowserClaw app; left in place after quit and
 * across most uninstalls.
 */
async function isBrowserclawInstalled() {
  try {
    await access(CONFIG_DIR)
    return true
  } catch {
    return false
  }
}

/**
 * @typedef {(
 *   | { state: 'running'; url: string; source: 'override' | 'default' }
 *   | { state: 'override-unreachable'; url: null; attempted: string }
 *   | { state: 'not-installed'; url: null }
 *   | { state: 'installed-not-running'; url: null }
 * )} DiscoveryResult
 *
 * @returns {Promise<DiscoveryResult>}
 */
export async function discoverBaseUrl() {
  const override = normalizeUrl(process.env.BROWSERCLAW_URL_OVERRIDE)
  if (override) {
    if (await probeHealth(override)) {
      return { state: 'running', url: override, source: 'override' }
    }
    return { state: 'override-unreachable', url: null, attempted: override }
  }

  if (!(await isBrowserclawInstalled())) {
    return { state: 'not-installed', url: null }
  }

  if (!(await probeHealth(DEFAULT_URL))) {
    return { state: 'installed-not-running', url: null }
  }

  return { state: 'running', url: DEFAULT_URL, source: 'default' }
}
