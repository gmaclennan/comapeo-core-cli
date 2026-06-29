import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { bootstrap } from '../../src/core/bootstrap.js'

/**
 * Bootstrap a manager in a temp dir with a device name and a "configured"
 * config (so the TUI skips first-run). Registers teardown on `cleanups`.
 *
 * @param {string} name
 * @param {Array<() => Promise<void>>} cleanups
 * @returns {Promise<{ manager: import('@comapeo/core').MapeoManager, config: any, storage: string }>}
 */
export async function makeManager(name, cleanups) {
  const storage = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), `comapeo-it-${name}-`),
  )
  const { manager, config, close } = await bootstrap({ storage })
  await manager.setDeviceInfo({ name, deviceType: 'desktop' })
  config.data.deviceName = name
  config.data.configured = true
  await config.write()
  cleanups.push(async () => {
    await close()
    await fsPromises.rm(storage, { recursive: true, force: true })
  })
  return { manager, config, storage }
}

/**
 * No-op discovery/connection controls for an injected TUI session. The tests
 * establish connections directly (via {@link connectPeers}), so the TUI's
 * discovery surface can be inert. Spread into a session stub and override the
 * fields a given test cares about.
 *
 * @type {Pick<import('../../src/core/session.js').Session,
 *   'isDiscovering' | 'startDiscovery' | 'stopDiscovery' | 'listDevices' |
 *   'connectDevice' | 'connectAllDevices' | 'disconnectAll' | 'onDevicesChanged'>}
 */
export const noopDiscovery = {
  isDiscovering: () => true,
  startDiscovery: async () => {},
  stopDiscovery: async () => {},
  listDevices: () => [],
  connectDevice: () => {},
  connectAllDevices: () => {},
  disconnectAll: async () => {},
  onDevicesChanged: () => () => {},
}

/**
 * Connect managers directly over loopback (no mDNS), mirroring core's test
 * helper. Registers teardown on `cleanups`.
 *
 * @param {import('@comapeo/core').MapeoManager[]} managers
 * @param {Array<() => Promise<void>>} cleanups
 */
export async function connectPeers(managers, cleanups) {
  await Promise.all(
    managers.map(async (manager) => {
      const { name, port } = await manager.startLocalPeerDiscoveryServer()
      for (const other of managers) {
        if (other === manager) continue
        other.connectLocalPeer({ address: '127.0.0.1', name, port })
      }
    }),
  )
  cleanups.push(async () => {
    await Promise.all(
      managers.map((m) => m.stopLocalPeerDiscoveryServer({ force: true })),
    )
  })
}

/**
 * Resolve once every manager sees every other as a connected peer (with name).
 * @param {import('@comapeo/core').MapeoManager[]} managers
 * @returns {Promise<void>}
 */
export function waitForConnected(managers) {
  const deviceIds = new Set(managers.map((m) => m.deviceId))
  const done = async () => {
    for (const manager of managers) {
      const want = new Set(deviceIds)
      want.delete(manager.deviceId)
      for (const peer of await manager.listLocalPeers()) {
        if (peer.status === 'connected' && peer.name) want.delete(peer.deviceId)
      }
      if (want.size > 0) return false
    }
    return true
  }
  return new Promise((resolve) => {
    const check = async () => {
      if (await done()) {
        for (const m of managers) m.off('local-peers', check)
        resolve()
      }
    }
    for (const m of managers) m.on('local-peers', check)
    check()
  })
}
