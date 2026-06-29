import { DnsSdBrowser } from 'dns-sd-browser'

import { EventEmitter } from 'node:events'
import net from 'node:net'

const SERVICE_TYPE = '_comapeo._tcp'

/**
 * Discovery-only LAN peer browser for the CLI. Browses for CoMapeo peers and
 * lets the operator dial them manually via {@link LocalDiscovery#connect} /
 * {@link LocalDiscovery#connectAll}. It does NOT advertise and never auto-dials:
 * the CLI only ever initiates connections, and the operator chooses which.
 *
 * `startLocalPeerDiscoveryServer()` is still required — core drops any outbound
 * connection whose local TCP server isn't listening (local-discovery.js
 * `#handleNoiseStreamConnection`). We start that server but never publish its port.
 *
 * Emits `devices-changed` whenever the discovered or dialed set changes; callers
 * re-pull {@link LocalDiscovery#listDiscovered}. Real connection state comes from
 * `manager.listLocalPeers()` / the manager `'local-peers'` event.
 *
 * @extends {EventEmitter<{ 'devices-changed': [] }>}
 */
export class LocalDiscovery extends EventEmitter {
  #manager
  /** Dial every discovered device automatically (for non-interactive commands). */
  #autoConnect
  /** @type {DnsSdBrowser | undefined} */
  #mdns
  /** The local peer discovery server (its TCP port) once started. @type {{ name: string, port: number } | undefined} */
  #server
  /** @type {AbortController | undefined} */
  #ac
  /** @type {Promise<void> | undefined} */
  #loop
  /** Discovered services keyed by mDNS name. @type {Map<string, { name: string, address: string, port: number }>} */
  #discovered = new Map()
  /** Services we've dialed, so they drop out of the "available" list. @type {Set<string>} */
  #dialed = new Set()

  /**
   * @param {import('@comapeo/core').MapeoManager} manager
   * @param {{ autoConnect?: boolean }} [opts] `autoConnect` dials every discovered
   *   device automatically — used by the scriptable commands, which have no UI to
   *   pick peers. The TUI leaves it off and connects on the operator's command.
   */
  constructor(manager, { autoConnect = false } = {}) {
    super()
    this.#manager = manager
    this.#autoConnect = autoConnect
  }

  /**
   * @returns {Promise<{ name: string, port: number } | undefined>}
   */
  async start() {
    if (this.#mdns) return this.#server
    const server = await this.#manager.startLocalPeerDiscoveryServer()
    this.#server = server
    this.#mdns = new DnsSdBrowser()
    this.#ac = new AbortController()
    // browse() starts the mDNS transport; ready() resolves once its socket binds.
    const browser = this.#mdns.browse(SERVICE_TYPE, { signal: this.#ac.signal })
    await this.#mdns.ready()
    this.#loop = this.#consume(browser)
    return server
  }

  /**
   * @param {AsyncIterable<import('dns-sd-browser').BrowseEvent>} browser
   */
  async #consume(browser) {
    try {
      for await (const event of browser) {
        if (event.type === 'serviceUp' || event.type === 'serviceUpdated') {
          this.#onServiceUp(event.service)
        } else if (event.type === 'serviceDown') {
          const name = serviceName(event.service)
          if (!name) continue
          const changed =
            this.#discovered.delete(name) || this.#dialed.delete(name)
          if (changed) this.emit('devices-changed')
        }
      }
    } catch (err) {
      // Aborting the browse rejects the iterator; only rethrow on a real error.
      if (!this.#ac?.signal.aborted) throw err
    }
  }

  /**
   * @param {import('dns-sd-browser').Service} service
   */
  #onServiceUp(service) {
    const name = serviceName(service)
    if (!name) return
    const address = service.addresses?.find((a) => net.isIPv4(a))
    if (!address) return // wait for a serviceUpdated that carries an IPv4
    const prev = this.#discovered.get(name)
    if (prev && prev.address === address && prev.port === service.port) return
    this.#discovered.set(name, { name, address, port: service.port })
    if (this.#autoConnect) this.connect(name)
    this.emit('devices-changed')
  }

  /**
   * Discovered devices. `dialed` means we've already initiated a connection (so
   * it won't appear as "available"); the resulting connected peer surfaces via
   * `manager.listLocalPeers()`. The mDNS name is random per session — the real
   * deviceId/name only become known once connected.
   * @returns {Array<{ name: string, address: string, port: number, dialed: boolean }>}
   */
  listDiscovered() {
    return [...this.#discovered.values()].map((s) => ({
      ...s,
      dialed: this.#dialed.has(s.name),
    }))
  }

  /**
   * Dial one discovered device by its mDNS name. No-op if unknown or already dialed.
   * @param {string} name
   */
  connect(name) {
    const service = this.#discovered.get(name)
    if (!service || this.#dialed.has(name)) return
    this.#dialed.add(name)
    this.#manager.connectLocalPeer({
      address: service.address,
      port: service.port,
      name,
    })
    this.emit('devices-changed')
  }

  /** Dial every discovered device not already dialed. */
  connectAll() {
    for (const name of this.#discovered.keys()) this.connect(name)
  }

  /**
   * Dial a peer directly by address + port, bypassing mDNS discovery. For
   * peers the browser can't see (different subnet, an Android emulator behind
   * `adb forward`/`reverse`, a known static host). The connection surfaces via
   * `manager.listLocalPeers()` like any other.
   *
   * @param {{ address: string, port: number, name?: string }} opts
   */
  connectByAddress({ address, port, name = `${address}:${port}` }) {
    this.#manager.connectLocalPeer({ address, port, name })
  }

  /**
   * The local peer discovery server (its TCP port) once {@link start} has run,
   * else undefined. The port is what a remote peer dials to reach this CLI.
   * @returns {{ name: string, port: number } | undefined}
   */
  getServerInfo() {
    return this.#server
  }

  /**
   * Drop ALL peer connections. Core exposes no per-peer disconnect, so this
   * force-stops the discovery server (which destroys every connection) then
   * restarts it, so the operator stays discoverable and can reconnect. The
   * browser keeps running (the device list survives) and dialed state resets,
   * returning every device to "available".
   */
  async disconnectAll() {
    if (!this.#mdns) return
    await this.#manager.stopLocalPeerDiscoveryServer({ force: true })
    this.#dialed.clear()
    this.#server = await this.#manager.startLocalPeerDiscoveryServer()
    this.emit('devices-changed')
  }

  async stop() {
    if (!this.#mdns) return
    this.#ac?.abort()
    await this.#mdns.destroy() // closes the UDP socket → clean process exit
    await this.#loop?.catch(() => {})
    this.#mdns = undefined
    this.#server = undefined
    this.#ac = undefined
    this.#loop = undefined
    this.#discovered.clear()
    this.#dialed.clear()
    await this.#manager.stopLocalPeerDiscoveryServer({ force: true })
  }
}

/**
 * @param {import('dns-sd-browser').Service} service
 * @returns {string | undefined}
 */
function serviceName(service) {
  const n = service.txt?.name
  return (typeof n === 'string' && n) || service.name
}
