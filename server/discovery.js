/**
 * Resolve a BrowserClaw base URL and report why if we cannot.
 *
 * Returns a tagged discriminant so the wrapper can render distinct
 * error messages per failure mode:
 *
 *   { state: 'running', url,
 *     source: 'override' | 'manifest' | 'log' | 'default' }
 *   { state: 'override-unreachable', url: null, attempted }
 *   { state: 'not-installed', url: null }
 *   { state: 'installed-not-running', url: null }
 *
 * Precedence:
 *
 *   1. BROWSERCLAW_URL_OVERRIDE is set:
 *        parses AND probeHealth passes  -> running (override)
 *        otherwise                      -> override-unreachable
 *
 *   2. no override:
 *        a) manifest URL (from
 *           `~/.browserclaw/mcp-manager/manifest.json`) probes healthy
 *           -> running (manifest). Missing manifest or unreachable URL
 *           falls through.
 *        b) log URL (last `claw-server listening` line in
 *           `~/.browserclaw/claw-server.log`) probes healthy
 *           -> running (log). Same fall-through rules.
 *        c) default `http://127.0.0.1:9200` probes healthy
 *           -> running (default).
 *
 *   3. every probe failed:
 *        `~/.browserclaw` is missing    -> not-installed
 *        otherwise                      -> installed-not-running
 *
 * Dev-mode claw-server (which uses `~/.browserclaw-dev`) is NOT
 * detected. Dev users must set BROWSERCLAW_URL_OVERRIDE explicitly.
 *
 * Pure module: no SDK imports, no caching, no shared mutable state.
 */

import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { readLogUrl, readManifestUrl } from './on-disk-discovery.js'

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
 *       source: 'override' | 'manifest' | 'log' | 'default' }
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

  const manifestUrl = normalizeUrl(await readManifestUrl(CONFIG_DIR))
  if (manifestUrl && (await probeHealth(manifestUrl))) {
    return { state: 'running', url: manifestUrl, source: 'manifest' }
  }

  const logUrl = normalizeUrl(await readLogUrl(CONFIG_DIR))
  if (logUrl && logUrl !== manifestUrl && (await probeHealth(logUrl))) {
    return { state: 'running', url: logUrl, source: 'log' }
  }

  // Only probe the default if neither on-disk source pointed at it.
  // When manifest or log already record 9200, the earlier probes
  // already covered that URL and the answer was `not healthy`; probing
  // again would only waste a round trip.
  if (manifestUrl !== DEFAULT_URL && logUrl !== DEFAULT_URL) {
    if (await probeHealth(DEFAULT_URL)) {
      return { state: 'running', url: DEFAULT_URL, source: 'default' }
    }
  }

  if (!(await isBrowserclawInstalled())) {
    return { state: 'not-installed', url: null }
  }
  return { state: 'installed-not-running', url: null }
}
