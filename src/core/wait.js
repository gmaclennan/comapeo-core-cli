/**
 * Wait until at least `min` peers are connected, or reject on timeout.
 *
 * @param {import('@comapeo/core').MapeoManager} manager
 * @param {object} [opts]
 * @param {number} [opts.min] Minimum connected peers (default 1)
 * @param {number} [opts.timeout] ms before rejecting (default 30000)
 * @returns {Promise<import('@comapeo/core').PublicPeerInfo[]>}
 */
export async function waitForConnectedPeers(
  manager,
  { min = 1, timeout = 30_000 } = {},
) {
  const connected = async () =>
    (await manager.listLocalPeers()).filter((p) => p.status === 'connected')

  const initial = await connected()
  if (initial.length >= min) return initial

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      manager.off('local-peers', onPeers)
      reject(new Error(`Timed out waiting for ${min} connected peer(s)`))
    }, timeout)

    /** @param {import('@comapeo/core').PublicPeerInfo[]} peers */
    const onPeers = (peers) => {
      const ready = peers.filter((p) => p.status === 'connected')
      if (ready.length >= min) {
        clearTimeout(timer)
        manager.off('local-peers', onPeers)
        resolve(ready)
      }
    }
    manager.on('local-peers', onPeers)
  })
}
