/**
 * @typedef {import('@comapeo/core').MapeoManager} MapeoManager
 * @typedef {{ inviteId: string, projectName?: string, projectDescription?: string, invitorDeviceId: string, state: string }} ReceivedInvite
 */

/**
 * Resolve the display name of the device that sent an invite, via the connected
 * peer list (invites carry only `invitorDeviceId`).
 *
 * @param {MapeoManager} manager
 * @param {ReceivedInvite} invite
 * @returns {Promise<string | undefined>}
 */
export async function invitorName(manager, invite) {
  const peers = await manager.listLocalPeers()
  return peers.find((p) => p.deviceId === invite.invitorDeviceId)?.name
}

/**
 * Wait for the next `'invite-received'`, optionally filtered to invites from a
 * device with a given name.
 *
 * @param {MapeoManager} manager
 * @param {object} [opts]
 * @param {string} [opts.from] Only resolve for an invitor with this device name
 * @param {number} [opts.timeout] ms before rejecting (default 120000)
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<ReceivedInvite>}
 */
export function waitForInvite(
  manager,
  { from, timeout = 120_000, signal } = {},
) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      manager.invite.off('invite-received', onInvite)
      signal?.removeEventListener('abort', onAbort)
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for an invite'))
    }, timeout)
    const onAbort = () => {
      cleanup()
      reject(new Error('Aborted'))
    }
    /** @param {any} invite */
    const onInvite = async (invite) => {
      if (from) {
        const name = await invitorName(manager, invite)
        if (name !== from) return
      }
      cleanup()
      resolve(invite)
    }
    if (signal?.aborted) return onAbort()
    signal?.addEventListener('abort', onAbort)
    manager.invite.on('invite-received', onInvite)
  })
}
