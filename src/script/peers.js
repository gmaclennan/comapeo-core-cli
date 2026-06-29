import { shortId } from '../core/format.js'
import { openSession } from '../core/session.js'
import { waitForConnectedPeers } from '../core/wait.js'
import { CliError, info, printJson, printTable } from './output.js'

/**
 * @param {object} args
 * @param {string} args.storage
 * @param {boolean} [args.json]
 * @param {boolean} [args.waitConnected] Wait for at least one connected peer first
 * @param {number} [args.timeout]
 */
export async function peersList({ storage, json, waitConnected, timeout }) {
  const session = await openSession({ storage, discovery: true })
  try {
    if (waitConnected) {
      if (!json) info('Discovering peers…')
      await waitForConnectedPeers(session.manager, { timeout })
    }
    const peers = await session.manager.listLocalPeers()
    if (json) {
      printJson(peers)
      return
    }
    if (peers.length === 0) {
      info('No peers found on the local network.')
      return
    }
    printTable(
      peers.map((p) => ({
        name: p.name ?? '(unknown)',
        deviceType: p.deviceType ?? '',
        status: p.status,
        deviceId: shortId(p.deviceId),
      })),
    )
  } finally {
    await session.close()
  }
}

/**
 * Connect to a peer directly by address + port, bypassing mDNS discovery (for a
 * peer on another subnet, behind `adb forward`/`reverse`, or any known host).
 * Waits until it connects, then prints it.
 *
 * @param {object} args
 * @param {string} args.storage
 * @param {string} args.address
 * @param {number} args.port
 * @param {boolean} [args.json]
 * @param {number} [args.timeout] ms to wait for the peer to connect (default 30000)
 */
export async function peersConnect({
  storage,
  address,
  port,
  json,
  timeout = 30_000,
}) {
  const session = await openSession({
    storage,
    discovery: true,
    autoConnect: false,
  })
  try {
    if (!json) info(`Dialing ${address}:${port}…`)
    session.connectByAddress({ address, port })
    let connected
    try {
      connected = await waitForConnectedPeers(session.manager, { timeout })
    } catch {
      throw new CliError(
        `No peer connected from ${address}:${port} within ${timeout}ms.`,
        1,
      )
    }
    if (json) {
      printJson(connected)
      return
    }
    info(`Connected (${connected.length} peer(s)):`)
    printTable(
      connected.map((p) => ({
        name: p.name ?? '(unknown)',
        deviceType: p.deviceType ?? '',
        deviceId: shortId(p.deviceId),
      })),
    )
  } finally {
    await session.close()
  }
}

/**
 * Print the address(es) and port a remote peer can dial to reach this CLI. Use
 * with `comapeo peers connect <address> <port>` on the other device.
 *
 * @param {object} args
 * @param {string} args.storage
 * @param {boolean} [args.json]
 */
export async function peersAddress({ storage, json }) {
  const session = await openSession({
    storage,
    discovery: true,
    autoConnect: false,
  })
  try {
    const listen = session.getListenAddress()
    if (!listen) throw new CliError('Discovery server is not listening.', 1)
    if (json) {
      printJson(listen)
      return
    }
    info(`Listening on port ${listen.port}. Reachable at:`)
    if (listen.addresses.length === 0) {
      info('  (no non-loopback IPv4 address found)')
    } else {
      for (const { iface, address } of listen.addresses) {
        info(`  ${address}:${listen.port}  (${iface})`)
      }
    }
  } finally {
    await session.close()
  }
}
