import stripAnsi from 'strip-ansi'

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createSyncModel } from '../src/core/sync-model.js'
import {
  bar,
  dashboard,
  pct,
  peerDetail,
  peerLine,
  recordDetail,
  sparkline,
  statusOf,
} from '../src/tui/render.js'

test('bar fills proportionally to width', () => {
  assert.equal(bar(0, 10), '░░░░░░░░░░')
  assert.equal(bar(1, 10), '██████████')
  assert.equal(bar(0.5, 10), '█████░░░░░')
  // Clamps out-of-range input.
  assert.equal(bar(2, 4), '████')
  assert.equal(bar(-1, 4), '░░░░')
})

test('pct rounds and right-pads to 4 chars', () => {
  assert.equal(pct(0), '  0%')
  assert.equal(pct(1), '100%')
  assert.equal(pct(0.825), ' 83%')
})

test('statusOf reflects connection and sync state', () => {
  assert.deepEqual(
    statusOf(/** @type {any} */ ({ connection: 'connecting' })).label,
    'connecting',
  )
  assert.deepEqual(
    statusOf(/** @type {any} */ ({ connection: 'disconnected' })).label,
    'offline',
  )
  assert.deepEqual(
    statusOf(/** @type {any} */ ({ connection: 'connected', synced: false }))
      .label,
    'syncing',
  )
  assert.deepEqual(
    statusOf(/** @type {any} */ ({ connection: 'connected', synced: true }))
      .label,
    'done',
  )
})

test('peerLine shows the name, a done glyph and 100% when synced', () => {
  /** @type {any} */
  const row = {
    deviceId: 'abc123',
    name: 'field-tablet',
    connection: 'connected',
    synced: true,
    initial: { progress: 1, want: 0, wanted: 0 },
    data: { progress: 1, want: 0, wanted: 0 },
  }
  const line = peerLine(row)
  assert.match(line, /field-tablet/)
  assert.match(line, /^✓/)
  assert.match(line, /100%/)
})

test('peerLine shows transferred totals by default and remaining when raw', () => {
  /** @type {any} */
  const row = {
    deviceId: 'aa',
    name: 'x',
    connection: 'connected',
    synced: false,
    initial: { progress: 1, want: 0, wanted: 0, downloaded: 0, uploaded: 0 },
    data: { progress: 0.5, want: 2, wanted: 10, downloaded: 10, uploaded: 3 },
  }
  assert.match(peerLine(row), /↓10 ↑3/)
  assert.match(peerLine(row, { raw: true }), /10\/2 left/)
})

test('recordDetail flattens tags, uses short ids, and marks read-only', () => {
  const doc = {
    docId: 'aa'.repeat(32),
    versionId: 'bb'.repeat(32),
    schemaName: 'observation',
    createdAt: '2026-06-21T00:00:00Z',
    lat: 1,
    lon: 2,
    tags: { type: 'water-point', clean: true },
    attachments: [],
  }
  const out = stripAnsi(recordDetail(doc))
  assert.match(out, /docId/)
  assert.match(out, /tags/)
  assert.match(out, /type\s+water-point/, 'tag flattened one level')
  assert.match(out, /clean\s+true/)
  assert.match(out, /read-only/)
  assert.ok(!out.includes('aa'.repeat(32)), 'full hex id is not shown')
})

test('sparkline scales to the window max and clamps width', () => {
  assert.equal(sparkline([]), '')
  const s = sparkline([0, 50, 100], 3)
  assert.equal([...s].length, 3)
  assert.equal([...s][0], '▁')
  assert.equal([...s][2], '█')
  assert.equal(
    [...sparkline([1, 2, 3, 4, 5], 3)].length,
    3,
    'windowed to width',
  )
})

test('peerDetail shows per-group progress, and raw block counts when toggled', () => {
  /** @type {any} */
  const row = {
    deviceId: 'cd'.repeat(32),
    name: 'field-tablet',
    deviceType: 'tablet',
    connection: 'connected',
    synced: false,
    initial: { progress: 1, want: 0, wanted: 0, peakWanted: 4 },
    data: { progress: 0.5, want: 3, wanted: 20, peakWanted: 40 },
  }
  const human = stripAnsi(peerDetail(row, { raw: false }))
  assert.match(human, /field-tablet/)
  assert.match(human, /initial/)
  assert.match(human, /50%/)

  const raw = stripAnsi(peerDetail(row, { raw: true }))
  assert.match(raw, /want 3\s+wanted 20/)
  assert.match(raw, /peak 40/)
})

test('dashboard renders a row per peer and a caught-up footer', () => {
  const model = createSyncModel()
  model.applyPeers([{ deviceId: 'A', name: 'laptop', status: 'connected' }])
  model.applySyncState({
    initial: { isSyncEnabled: true },
    data: { isSyncEnabled: true },
    remoteDeviceSyncState: {
      A: {
        initial: { isSyncEnabled: true, want: 0, wanted: 0 },
        data: { isSyncEnabled: true, want: 0, wanted: 0 },
      },
    },
  })
  const frame = stripAnsi(dashboard(model, { projectName: 'Survey' }))
  assert.match(frame, /CoMapeo Sync\s+Survey\s+1 peer/)
  assert.match(frame, /laptop/)
  assert.match(frame, /All connected peers are caught up/)
  // L0 aggregate bar present (everything synced → 100%).
  assert.match(frame, /█{4,}.*100%/s)
})
