/**
 * Unit tests for server/on-disk-discovery.js.
 *
 * Pure fs-only functions, so each test spins up a scratch config dir
 * under `os.tmpdir()`, populates the two files the helpers care about,
 * and asserts on the returned URL. No claw-server, no network.
 *
 * Run: node --test test/on-disk-discovery.test.js
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  readLogUrl,
  readManifestUrl,
  readRuntimeUrl,
} from '../server/on-disk-discovery.js'

async function makeConfigDir() {
  const dir = await mkdtemp(join(tmpdir(), 'browserclaw-disco-'))
  return dir
}

async function writeManifest(dir, doc) {
  const mgrDir = join(dir, 'mcp-manager')
  await mkdir(mgrDir, { recursive: true })
  await writeFile(join(mgrDir, 'manifest.json'), JSON.stringify(doc), 'utf8')
}

async function writeLog(dir, contents) {
  await writeFile(join(dir, 'claw-server.log'), contents, 'utf8')
}

async function writeRuntime(dir, doc) {
  await writeFile(join(dir, 'runtime.json'), JSON.stringify(doc), 'utf8')
}

// ---------------------------------------------------------------------------
// readRuntimeUrl
// ---------------------------------------------------------------------------

test('readRuntimeUrl returns null when runtime file is missing', async (t) => {
  const dir = await makeConfigDir()
  t.after(() => rm(dir, { recursive: true, force: true }))
  assert.equal(await readRuntimeUrl(dir), null)
})

test('readRuntimeUrl returns null when runtime is not valid JSON', async (t) => {
  const dir = await makeConfigDir()
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(join(dir, 'runtime.json'), '{not-json', 'utf8')
  assert.equal(await readRuntimeUrl(dir), null)
})

test('readRuntimeUrl returns null when .url is missing', async (t) => {
  const dir = await makeConfigDir()
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeRuntime(dir, { other: 'field' })
  assert.equal(await readRuntimeUrl(dir), null)
})

test('readRuntimeUrl returns null when .url is not a string', async (t) => {
  const dir = await makeConfigDir()
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeRuntime(dir, { url: 9200 })
  assert.equal(await readRuntimeUrl(dir), null)
})

test('readRuntimeUrl returns the URL when the file is well-formed', async (t) => {
  const dir = await makeConfigDir()
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeRuntime(dir, { url: 'http://127.0.0.1:9800' })
  assert.equal(await readRuntimeUrl(dir), 'http://127.0.0.1:9800')
})

// ---------------------------------------------------------------------------
// readManifestUrl
// ---------------------------------------------------------------------------

test('readManifestUrl returns null when manifest file is missing', async (t) => {
  const dir = await makeConfigDir()
  t.after(() => rm(dir, { recursive: true, force: true }))
  assert.equal(await readManifestUrl(dir), null)
})

test('readManifestUrl returns null when manifest is not valid JSON', async (t) => {
  const dir = await makeConfigDir()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const mgrDir = join(dir, 'mcp-manager')
  await mkdir(mgrDir, { recursive: true })
  await writeFile(join(mgrDir, 'manifest.json'), '{not-json', 'utf8')
  assert.equal(await readManifestUrl(dir), null)
})

test('readManifestUrl returns null when BrowserClaw entry is missing', async (t) => {
  const dir = await makeConfigDir()
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeManifest(dir, {
    servers: {
      SomeOtherServer: {
        spec: { transport: 'http', url: 'http://127.0.0.1:9999' },
      },
    },
  })
  assert.equal(await readManifestUrl(dir), null)
})

test('readManifestUrl returns null when transport is stdio', async (t) => {
  const dir = await makeConfigDir()
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeManifest(dir, {
    servers: {
      BrowserClaw: {
        spec: { transport: 'stdio', command: 'browserclaw', args: [] },
      },
    },
  })
  assert.equal(await readManifestUrl(dir), null)
})

test('readManifestUrl returns URL when transport is http', async (t) => {
  const dir = await makeConfigDir()
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeManifest(dir, {
    servers: {
      BrowserClaw: {
        spec: { transport: 'http', url: 'http://127.0.0.1:9500/mcp' },
      },
    },
  })
  assert.equal(await readManifestUrl(dir), 'http://127.0.0.1:9500/mcp')
})

test('readManifestUrl returns URL when transport is sse', async (t) => {
  const dir = await makeConfigDir()
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeManifest(dir, {
    servers: {
      BrowserClaw: {
        spec: { transport: 'sse', url: 'http://127.0.0.1:9300/sse' },
      },
    },
  })
  assert.equal(await readManifestUrl(dir), 'http://127.0.0.1:9300/sse')
})

test('readManifestUrl accepts tagged-object transport shape', async (t) => {
  const dir = await makeConfigDir()
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeManifest(dir, {
    servers: {
      BrowserClaw: {
        spec: {
          transport: { type: 'http', headers: {} },
          url: 'http://127.0.0.1:9600/mcp',
        },
      },
    },
  })
  assert.equal(await readManifestUrl(dir), 'http://127.0.0.1:9600/mcp')
})

test('readManifestUrl rejects tagged-object transport of unsupported type', async (t) => {
  const dir = await makeConfigDir()
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeManifest(dir, {
    servers: {
      BrowserClaw: {
        spec: {
          transport: { type: 'stdio', command: 'browserclaw' },
          url: 'http://127.0.0.1:9600/mcp',
        },
      },
    },
  })
  assert.equal(await readManifestUrl(dir), null)
})

// ---------------------------------------------------------------------------
// readLogUrl
// ---------------------------------------------------------------------------

test('readLogUrl returns null when log file is missing', async (t) => {
  const dir = await makeConfigDir()
  t.after(() => rm(dir, { recursive: true, force: true }))
  assert.equal(await readLogUrl(dir), null)
})

test('readLogUrl returns null when log has no listen line', async (t) => {
  const dir = await makeConfigDir()
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeLog(
    dir,
    JSON.stringify({ level: 30, msg: 'boot', time: 1 }) +
      '\n' +
      JSON.stringify({ level: 30, msg: 'ready', time: 2 }) +
      '\n',
  )
  assert.equal(await readLogUrl(dir), null)
})

test('readLogUrl returns URL from the last matching line', async (t) => {
  const dir = await makeConfigDir()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const lines = [
    { msg: 'claw-server listening', url: 'http://127.0.0.1:9200', time: 1 },
    { msg: 'shutdown', signal: 'SIGTERM', time: 2 },
    { msg: 'claw-server listening', url: 'http://127.0.0.1:9500', time: 3 },
  ]
  await writeLog(dir, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  assert.equal(await readLogUrl(dir), 'http://127.0.0.1:9500')
})

test('readLogUrl skips malformed JSON lines', async (t) => {
  const dir = await makeConfigDir()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const contents =
    JSON.stringify({ msg: 'boot', time: 1 }) +
    '\n' +
    'this is not JSON at all\n' +
    JSON.stringify({
      msg: 'claw-server listening',
      url: 'http://127.0.0.1:9400',
      time: 2,
    }) +
    '\n' +
    'another bad line\n'
  await writeLog(dir, contents)
  assert.equal(await readLogUrl(dir), 'http://127.0.0.1:9400')
})

test('readLogUrl handles tail truncation by discarding a partial first line', async (t) => {
  const dir = await makeConfigDir()
  t.after(() => rm(dir, { recursive: true, force: true }))
  // Simulate a very large log by padding a fake partial line ahead of
  // the listen line, big enough to exceed the 32 KiB tail.
  const filler = 'x'.repeat(40 * 1024)
  const truncatedPartial = `${filler}"partial-json":"never-closes"`
  const listenLine = JSON.stringify({
    msg: 'claw-server listening',
    url: 'http://127.0.0.1:9700',
    time: 42,
  })
  const contents = `${truncatedPartial}\n${listenLine}\n`
  await writeLog(dir, contents)
  // The head of the file is truncated by the tail read; the partial
  // first line after the split must be discarded, and the listen line
  // must still be returned.
  assert.equal(await readLogUrl(dir), 'http://127.0.0.1:9700')
})
