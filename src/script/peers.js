import { shortId } from '../core/format.js'
import { openSession } from '../core/session.js'
import { waitForConnectedPeers } from '../core/wait.js'
import { info, printJson, printTable } from './output.js'

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
