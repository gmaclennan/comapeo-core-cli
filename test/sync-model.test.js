import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createSyncModel } from '../src/core/sync-model.js'

/**
 * @param {object} opts
 * @param {Record<string, { initial: [number, number], data: [number, number] }>} opts.peers
 *   Map of deviceId → [want, wanted] tuples per group.
 * @param {boolean} [opts.dataEnabled]
 */
function syncState({ peers, dataEnabled = true }) {
  /** @type {Record<string, any>} */
  const remoteDeviceSyncState = {}
  for (const [deviceId, g] of Object.entries(peers)) {
    remoteDeviceSyncState[deviceId] = {
      initial: {
        isSyncEnabled: true,
        want: g.initial[0],
        wanted: g.initial[1],
      },
      data: { isSyncEnabled: dataEnabled, want: g.data[0], wanted: g.data[1] },
    }
  }
  return {
    initial: { isSyncEnabled: true },
    data: { isSyncEnabled: dataEnabled },
    remoteDeviceSyncState,
  }
}

test('peak-wanted progress derivation drains from 0 to 1', () => {
  const model = createSyncModel()
  // First tick: 40 blocks wanted from peer A → peak 40, progress 0.
  model.applySyncState(
    syncState({ peers: { A: { initial: [0, 0], data: [0, 40] } } }),
  )
  let a = model.list()[0]
  assert.equal(a.data.peakWanted, 40)
  assert.equal(a.data.progress, 0)
  assert.equal(a.synced, false)

  // Halfway: 20 left → progress 0.5, peak stays 40.
  model.applySyncState(
    syncState({ peers: { A: { initial: [0, 0], data: [0, 20] } } }),
  )
  a = model.list()[0]
  assert.equal(a.data.peakWanted, 40)
  assert.equal(a.data.progress, 0.5)

  // Done: 0 left → progress 1, synced.
  model.applySyncState(
    syncState({ peers: { A: { initial: [0, 0], data: [0, 0] } } }),
  )
  a = model.list()[0]
  assert.equal(a.data.progress, 1)
  assert.equal(a.synced, true)
})

test('peak grows when more becomes wanted mid-sync', () => {
  const model = createSyncModel()
  model.applySyncState(
    syncState({ peers: { A: { initial: [0, 0], data: [0, 10] } } }),
  )
  // New data discovered: wanted jumps to 30 → peak tracks up, progress recomputed.
  model.applySyncState(
    syncState({ peers: { A: { initial: [0, 0], data: [0, 30] } } }),
  )
  const a = model.list()[0]
  assert.equal(a.data.peakWanted, 30)
  assert.equal(a.data.progress, 0)
})

test('tracks transferred downloaded/uploaded via peaks', () => {
  const model = createSyncModel()
  // [want, wanted]: peer wants 10 from us, we want 40 from it.
  model.applySyncState(
    syncState({ peers: { A: { initial: [0, 0], data: [10, 40] } } }),
  )
  let a = model.list()[0]
  assert.equal(a.data.downloaded, 0)
  assert.equal(a.data.uploaded, 0)
  // Both directions make progress: we've pulled 25, pushed 4.
  model.applySyncState(
    syncState({ peers: { A: { initial: [0, 0], data: [6, 15] } } }),
  )
  a = model.list()[0]
  assert.equal(a.data.downloaded, 25, 'peakWanted(40) - wanted(15)')
  assert.equal(a.data.uploaded, 4, 'peakWant(10) - want(6)')
})

test('a peer is not synced while it still wants blocks from us', () => {
  const model = createSyncModel()
  // wanted is 0 but want (upload to peer) is 5 → not done.
  model.applySyncState(
    syncState({ peers: { A: { initial: [0, 0], data: [5, 0] } } }),
  )
  assert.equal(model.list()[0].synced, false)
})

test('joins sync state with peer info by deviceId', () => {
  const model = createSyncModel()
  model.applySyncState(
    syncState({ peers: { dev_a: { initial: [0, 0], data: [0, 5] } } }),
  )
  model.applyPeers([
    {
      deviceId: 'dev_a',
      name: 'Albas-Laptop',
      deviceType: 'desktop',
      status: 'connected',
    },
  ])
  const a = model.list()[0]
  assert.equal(a.name, 'Albas-Laptop')
  assert.equal(a.deviceType, 'desktop')
  assert.equal(a.connection, 'connected')
})

test('isAllSynced requires at least one connected, all-synced peer', () => {
  const model = createSyncModel()
  assert.equal(model.isAllSynced(), false, 'no peers → not synced')

  model.applyPeers([{ deviceId: 'A', name: 'a', status: 'connected' }])
  model.applySyncState(
    syncState({ peers: { A: { initial: [0, 0], data: [0, 3] } } }),
  )
  assert.equal(model.isAllSynced(), false, 'peer still downloading')

  model.applySyncState(
    syncState({ peers: { A: { initial: [0, 0], data: [0, 0] } } }),
  )
  assert.equal(model.isAllSynced(), true, 'peer caught up')

  // A second connected peer that is behind flips it back to false.
  model.applyPeers([{ deviceId: 'B', name: 'b', status: 'connected' }])
  model.applySyncState(
    syncState({
      peers: {
        A: { initial: [0, 0], data: [0, 0] },
        B: { initial: [0, 0], data: [0, 8] },
      },
    }),
  )
  assert.equal(model.isAllSynced(), false)
})

test('disconnected peers sort last and retain their row', () => {
  const model = createSyncModel()
  model.applyPeers([
    { deviceId: 'A', name: 'zeta', status: 'connected' },
    { deviceId: 'B', name: 'alpha', status: 'connected' },
  ])
  assert.deepEqual(
    model.list().map((r) => r.name),
    ['alpha', 'zeta'],
  )
  model.applyPeers([{ deviceId: 'B', name: 'alpha', status: 'disconnected' }])
  assert.deepEqual(
    model.list().map((r) => r.name),
    ['zeta', 'alpha'],
    'disconnected alpha now sorts last',
  )
})
