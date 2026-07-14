/**
 * Unit tests for the loopback restriction on `BROWSERCLAW_URL_OVERRIDE`.
 *
 * The override is the one input Claude Desktop passes into the wrapper
 * that the user directly controls. Restricting it to loopback prevents
 * a misconfigured or hostile URL from making the wrapper forward MCP
 * traffic to a public host. These tests pin that guard.
 *
 * Notes on shape:
 *   - Non-loopback hosts short-circuit before any network I/O, so tests
 *     for the rejection path are fast.
 *   - Loopback tests still exercise `probeHealth`, which fetches
 *     `http://127.0.0.1:.../system/health` and waits `PROBE_TIMEOUT_MS`
 *     (1s) before falling through to `override-unreachable`. That is
 *     the state a loopback override yields when nothing is listening,
 *     which is enough to prove the loopback branch was taken and the
 *     rejection branch was NOT.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { discoverBaseUrl } from '../server/discovery.js'

function withOverride(url, fn) {
  const prev = process.env.BROWSERCLAW_URL_OVERRIDE
  process.env.BROWSERCLAW_URL_OVERRIDE = url
  return Promise.resolve()
    .then(() => fn())
    .finally(() => {
      if (prev === undefined) delete process.env.BROWSERCLAW_URL_OVERRIDE
      else process.env.BROWSERCLAW_URL_OVERRIDE = prev
    })
}

// ---------------------------------------------------------------------------
// Rejected: non-loopback hosts short-circuit with override-not-loopback
// ---------------------------------------------------------------------------

test('rejects a public https URL', () =>
  withOverride('https://evil.example.com/mcp', async () => {
    const result = await discoverBaseUrl()
    assert.equal(result.state, 'override-not-loopback')
    // /mcp is stripped by normalizeUrl before the check.
    assert.equal(result.attempted, 'https://evil.example.com')
  }))

test('rejects a public http URL', () =>
  withOverride('http://attacker.test:8080/mcp', async () => {
    const result = await discoverBaseUrl()
    assert.equal(result.state, 'override-not-loopback')
    assert.equal(result.attempted, 'http://attacker.test:8080')
  }))

test('rejects a private LAN IP (192.168.x.x is not loopback)', () =>
  withOverride('http://192.168.1.50:9200', async () => {
    const result = await discoverBaseUrl()
    assert.equal(result.state, 'override-not-loopback')
    assert.equal(result.attempted, 'http://192.168.1.50:9200')
  }))

test('rejects a private LAN IP (10.x.x.x is not loopback)', () =>
  withOverride('http://10.0.0.5:9200', async () => {
    const result = await discoverBaseUrl()
    assert.equal(result.state, 'override-not-loopback')
    assert.equal(result.attempted, 'http://10.0.0.5:9200')
  }))

test('rejects a non-loopback IPv6 address', () =>
  withOverride('http://[2001:db8::1]:9200', async () => {
    const result = await discoverBaseUrl()
    assert.equal(result.state, 'override-not-loopback')
    assert.equal(result.attempted, 'http://[2001:db8::1]:9200')
  }))

// ---------------------------------------------------------------------------
// Accepted: loopback variants pass the guard and reach the probe.
// Nothing is listening on these test ports, so the assertion is that the
// state is `override-unreachable` (probe failed) rather than
// `override-not-loopback` (rejected at the guard).
// ---------------------------------------------------------------------------

test('accepts 127.0.0.1 (reaches probe, then unreachable)', () =>
  withOverride('http://127.0.0.1:1', async () => {
    const result = await discoverBaseUrl()
    assert.equal(result.state, 'override-unreachable')
    assert.equal(result.attempted, 'http://127.0.0.1:1')
  }))

test('accepts localhost (reaches probe, then unreachable)', () =>
  withOverride('http://localhost:1', async () => {
    const result = await discoverBaseUrl()
    assert.equal(result.state, 'override-unreachable')
    assert.equal(result.attempted, 'http://localhost:1')
  }))

test('accepts IPv6 loopback [::1] (reaches probe, then unreachable)', () =>
  withOverride('http://[::1]:1', async () => {
    const result = await discoverBaseUrl()
    assert.equal(result.state, 'override-unreachable')
    assert.equal(result.attempted, 'http://[::1]:1')
  }))
