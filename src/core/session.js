import { bootstrap } from './bootstrap.js'
import { LocalDiscovery } from './discovery.js'
import { lanAddresses } from './net.js'

/**
 * @typedef {object} DiscoveredDevice
 * @property {string} name mDNS service name (random per session, not the deviceId)
 * @property {string} address
 * @property {number} port
 * @property {boolean} dialed We've already initiated a connection to it
 */

/**
 * @typedef {object} Session
 * @property {import('@comapeo/core').MapeoManager} manager
 * @property {import('lowdb').Low<import('./bootstrap.js').ConfigData>} config
 * @property {() => boolean} isDiscovering
 * @property {() => Promise<void>} startDiscovery
 * @property {() => Promise<void>} stopDiscovery
 * @property {() => DiscoveredDevice[]} listDevices
 * @property {(name: string) => void} connectDevice
 * @property {(opts: { address: string, port: number, name?: string }) => void} connectByAddress
 * @property {() => void} connectAllDevices
 * @property {() => Promise<void>} disconnectAll
 * @property {() => { port: number, addresses: Array<{ iface: string, address: string }> } | undefined} getListenAddress
 * @property {(cb: () => void) => () => void} onDevicesChanged
 * @property {() => Promise<void>} close
 */

/**
 * Open a manager for one operation or for the interactive session. Discovery
 * (the mDNS browser + local discovery server) is controllable on demand: the
 * TUI starts it at launch and keeps it running app-wide so devices and invites
 * surface anywhere; pass `discovery: true` to start it immediately (the
 * scriptable commands do this). Peers are never auto-dialed — the operator
 * connects them via {@link Session.connectDevice}/{@link Session.connectAllDevices}.
 *
 * @param {object} options
 * @param {string} options.storage
 * @param {number} [options.port]
 * @param {boolean} [options.discovery] Start LAN peer discovery immediately
 * @param {boolean} [options.autoConnect] Dial discovered peers automatically.
 *   Defaults to `discovery` so the non-interactive commands keep connecting on
 *   their own; the TUI opens with both off and connects peers on command.
 * @returns {Promise<Session>}
 */
export async function openSession({
  storage,
  port = 0,
  discovery = false,
  autoConnect = discovery,
}) {
  const {
    manager,
    config,
    close: closeManager,
  } = await bootstrap({ storage, port })

  // Created eagerly so device subscriptions/queries work before start(); the
  // browser/server only run once started.
  const disco = new LocalDiscovery(manager, { autoConnect })
  let discovering = false

  async function startDiscovery() {
    if (discovering) return
    discovering = true
    await disco.start()
  }
  async function stopDiscovery() {
    if (!discovering) return
    discovering = false
    await disco.stop()
  }

  if (discovery) await startDiscovery()

  return {
    manager,
    config,
    isDiscovering: () => discovering,
    startDiscovery,
    stopDiscovery,
    listDevices: () => disco.listDiscovered(),
    connectDevice: (name) => disco.connect(name),
    connectByAddress: (opts) => disco.connectByAddress(opts),
    connectAllDevices: () => disco.connectAll(),
    disconnectAll: () => disco.disconnectAll(),
    getListenAddress: () => {
      const info = disco.getServerInfo()
      return info ? { port: info.port, addresses: lanAddresses() } : undefined
    },
    onDevicesChanged: (cb) => {
      disco.on('devices-changed', cb)
      return () => disco.off('devices-changed', cb)
    },
    async close() {
      // Discovery must stop before the manager closes.
      await stopDiscovery()
      await closeManager()
    },
  }
}
