import { roles } from '@comapeo/core'

import { shortId } from '../core/format.js'
import { resolveProjectId } from '../core/projects.js'
import { openSession } from '../core/session.js'
import { CliError, info, printJson } from './output.js'

const ROLE_IDS = {
  member: roles.MEMBER_ROLE_ID,
  coordinator: roles.COORDINATOR_ROLE_ID,
}

/**
 * Invite a connected device into a project (coordinator side). Connection-bound:
 * the target device must be reachable on the LAN and connected while this runs.
 * `$member.invite` resolves once the device responds (accept / reject / already).
 *
 * @param {object} args
 * @param {string} args.storage
 * @param {string} args.deviceId Device to invite (full id or unique prefix)
 * @param {string} [args.project] Project id or unique prefix
 * @param {'member' | 'coordinator'} [args.role]
 * @param {boolean} [args.json]
 * @param {number} [args.timeout] ms to wait for the device to connect (default 60000)
 */
export async function invite({
  storage,
  deviceId,
  project,
  role = 'member',
  json,
  timeout = 60_000,
}) {
  const roleId = ROLE_IDS[role]
  if (!roleId)
    throw new CliError(`Unknown role "${role}" (use member or coordinator).`, 2)

  const session = await openSession({ storage, discovery: true })
  const { manager, config } = session
  try {
    const projectId = await resolveProjectId(manager, {
      projectId: project,
      fallbackId: config.data.lastProjectId,
    }).catch((e) => {
      throw new CliError(e.message, 2)
    })

    if (!json)
      info('Discovering peers… (the device to invite must be on the LAN)')
    const target = await waitForDevice(manager, deviceId, timeout)

    const projectInstance = /** @type {any} */ (
      await manager.getProject(projectId)
    )
    const label = target.name ?? shortId(target.deviceId)
    if (!json) info(`Inviting ${label} as ${role}…`)

    const decision = String(
      await projectInstance.$member.invite(target.deviceId, {
        roleId,
        roleName: role,
      }),
    ).toLowerCase()

    if (json) printJson({ deviceId: target.deviceId, role, decision })
    else info(`${label}: ${decision}`)
    if (decision === 'reject') process.exitCode = 1
  } finally {
    await session.close()
  }
}

/**
 * Poll until a device matching `deviceId` (full id or unique prefix) is a
 * connected peer, or reject on timeout.
 * @param {import('@comapeo/core').MapeoManager} manager
 * @param {string} deviceId
 * @param {number} timeout
 * @returns {Promise<import('@comapeo/core').PublicPeerInfo>}
 */
async function waitForDevice(manager, deviceId, timeout) {
  const deadline = Date.now() + timeout
  for (;;) {
    const connected = (await manager.listLocalPeers()).filter(
      (p) => p.status === 'connected',
    )
    const matches = connected.filter(
      (p) => p.deviceId === deviceId || p.deviceId.startsWith(deviceId),
    )
    if (matches.length === 1) return matches[0]
    if (matches.length > 1) {
      throw new CliError(
        `"${deviceId}" matches ${matches.length} connected devices; be more specific.`,
        2,
      )
    }
    if (Date.now() > deadline) {
      const seen =
        connected.map((p) => p.deviceId.slice(0, 8)).join(', ') || 'none'
      throw new CliError(
        `Device "${deviceId}" did not connect within ${timeout}ms (connected: ${seen}).`,
        1,
      )
    }
    await new Promise((r) => setTimeout(r, 250))
  }
}
