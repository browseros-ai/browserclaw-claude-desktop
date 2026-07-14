/**
 * Resolve a BrowserClaw base URL and report why if we cannot.
 *
 * Returns a tagged discriminant so the wrapper can render distinct
 * error messages per failure mode:
 *
 *   { state: 'running', url,
 *     source: 'override' | 'runtime' | 'manifest' | 'log' | 'default' }
 *   { state: 'override-not-loopback', url: null, attempted }
 *   { state: 'override-unreachable', url: null, attempted }
 *   { state: 'not-installed', url: null }
 *   { state: 'installed-not-running', url: null }
 *
 * Precedence:
 *
 *   1. BROWSERCLAW_URL_OVERRIDE is set:
 *        hostname NOT loopback         -> override-not-loopback
 *        loopback AND probeHealth pass -> running (override)
 *        loopback but probe fails      -> override-unreachable
 *
 *   2. no override:
 *        a) runtime URL (from `~/.browserclaw/runtime.json`) probes
 *           healthy -> running (runtime). This file is the primary
 *           on-disk source: written atomically by claw-server on every
 *           successful bind, no harness link required.
 *        b) manifest URL (from
 *           `~/.browserclaw/mcp-manager/manifest.json`) probes healthy
 *           -> running (manifest). Backup source; requires a harness
 *           link to be populated.
 *        c) log URL (last `claw-server listening` line in
 *           `~/.browserclaw/claw-server.log`) probes healthy
 *           -> running (log). Final on-disk fallback, kept for
 *           compatibility with claw-server builds that predate
 *           `runtime.json`.
 *        d) default `http://127.0.0.1:9200` probes healthy
 *           -> running (default).
 *
 *   3. every probe failed:
 *        `~/.browserclaw` is missing    -> not-installed
 *        otherwise                      -> installed-not-running
 *
 * Loopback restriction: the user-configurable override is a
 * safeguard for custom-port setups. Only loopback hostnames
 * (127.0.0.1, [::1], localhost) are accepted so a misconfigured or
 * hostile override cannot make the wrapper forward Claude Desktop's
 * MCP traffic to a public host. On-disk-discovered URLs (runtime,
 * manifest, log) come from claw-server itself and are trusted; the
 * default (127.0.0.1:9200) is loopback by construction.
 *
 * Dev-mode claw-server (which uses `~/.browserclaw-dev`) is NOT
 * detected. Dev users must set BROWSERCLAW_URL_OVERRIDE explicitly.
 *
 * Pure module: no SDK imports, no caching, no shared mutable state.
 */

import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  readLogUrl,
  readManifestUrl,
  readRuntimeUrl,
} from './on-disk-discovery.js'

const DEFAULT_URL = 'http://127.0.0.1:9200'
const HEALTH_PATH = '/system/health'
const CONFIG_DIR = join(homedir(), '.browserclaw')
const PROBE_TIMEOUT_MS = 1000

/**
 * True when `baseUrl`'s hostname is a loopback address. Accepts the
 * three forms that resolve locally in practice: the IPv4 literal
 * `127.0.0.1`, the IPv6 literal `::1` (either as `[::1]` or `::1`
 * depending on URL parser), and the `localhost` hostname. Returns
 * false on parse failure so a malformed URL is treated as non-loopback.
 */
function isLoopback(baseUrl) {
  try {
    const parsed = new URL(baseUrl)
    const host = parsed.hostname
    return (
      host === '127.0.0.1' ||
      host === '[::1]' ||
      host === '::1' ||
      host === 'localhost'
    )
  } catch {
    return false
  }
}

/**
 * Strip trailing slashes, validate scheme. Returns the cleaned URL or null.
 */
function normalizeUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null
  let trimmed = raw.trim().replace(/\/+$/, '')
  // Forgive a paste of the full transport endpoint. openInnerClient appends
  // "/mcp" when it opens the transport, and probeHealth appends
  // "/system/health"; either would 404 with no diagnostic if the trailing
  // "/mcp" or "/sse" from the manifest was left in place. Strip both so a
  // manifest-recorded sse or http URL is normalised to the base.
  trimmed = trimmed.replace(/\/(mcp|sse)$/i, '')
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
 *   | { state: 'running'; url: string;
 *       source: 'override' | 'runtime' | 'manifest' | 'log' | 'default' }
 *   | { state: 'override-not-loopback'; url: null; attempted: string }
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
    // Restrict the user-configurable override to loopback so a
    // misconfigured or hostile URL cannot make the wrapper forward
    // Claude Desktop's MCP traffic to a public host.
    if (!isLoopback(override)) {
      return { state: 'override-not-loopback', url: null, attempted: override }
    }
    if (await probeHealth(override)) {
      return { state: 'running', url: override, source: 'override' }
    }
    return { state: 'override-unreachable', url: null, attempted: override }
  }

  const runtimeUrl = normalizeUrl(await readRuntimeUrl(CONFIG_DIR))
  if (runtimeUrl && (await probeHealth(runtimeUrl))) {
    return { state: 'running', url: runtimeUrl, source: 'runtime' }
  }

  const manifestUrl = normalizeUrl(await readManifestUrl(CONFIG_DIR))
  if (
    manifestUrl &&
    manifestUrl !== runtimeUrl &&
    (await probeHealth(manifestUrl))
  ) {
    return { state: 'running', url: manifestUrl, source: 'manifest' }
  }

  const logUrl = normalizeUrl(await readLogUrl(CONFIG_DIR))
  if (
    logUrl &&
    logUrl !== runtimeUrl &&
    logUrl !== manifestUrl &&
    (await probeHealth(logUrl))
  ) {
    return { state: 'running', url: logUrl, source: 'log' }
  }

  // Only probe the default if none of the on-disk sources already pointed
  // at it. When any of them recorded 9200 and the earlier probe reported
  // `not healthy`, probing 9200 again would only waste a round trip.
  if (
    runtimeUrl !== DEFAULT_URL &&
    manifestUrl !== DEFAULT_URL &&
    logUrl !== DEFAULT_URL
  ) {
    if (await probeHealth(DEFAULT_URL)) {
      return { state: 'running', url: DEFAULT_URL, source: 'default' }
    }
  }

  if (!(await isBrowserclawInstalled())) {
    return { state: 'not-installed', url: null }
  }
  return { state: 'installed-not-running', url: null }
}
