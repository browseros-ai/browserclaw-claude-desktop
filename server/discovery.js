/** Resolve BrowserOS neo without changing its legacy on-disk state contract. */

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

function normalizeUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null
  let trimmed = raw.trim().replace(/\/+$/, '')
  // Discovery sources may record a transport endpoint, while probes need the base URL.
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

async function isBrowserOSNeoInstalled() {
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
  const override =
    normalizeUrl(process.env.BROWSEROS_NEO_URL_OVERRIDE) ??
    normalizeUrl(process.env.BROWSERCLAW_URL_OVERRIDE)
  if (override) {
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

  // Avoid probing the same default endpoint twice after a recorded URL fails.
  if (
    runtimeUrl !== DEFAULT_URL &&
    manifestUrl !== DEFAULT_URL &&
    logUrl !== DEFAULT_URL
  ) {
    if (await probeHealth(DEFAULT_URL)) {
      return { state: 'running', url: DEFAULT_URL, source: 'default' }
    }
  }

  if (!(await isBrowserOSNeoInstalled())) {
    return { state: 'not-installed', url: null }
  }
  return { state: 'installed-not-running', url: null }
}
