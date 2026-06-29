import { confirm } from '@inquirer/prompts'

import { shortId } from '../core/format.js'
import { invitorName, waitForInvite } from '../core/invites.js'
import { openSession } from '../core/session.js'
import { CliError, info, printJson } from './output.js'

/**
 * Join a project by accepting an invite. The flow is connection-bound: a
 * coordinator on the LAN must send an invite while this command is running.
 *
 * @param {object} args
 * @param {string} args.storage
 * @param {boolean} [args.autoAccept] Accept the first matching invite without prompting
 * @param {string} [args.from] Only accept an invite from this device name
 * @param {boolean} [args.json]
 * @param {number} [args.timeout] ms to wait for an invite (default 120000)
 */
export async function join({ storage, autoAccept, from, json, timeout }) {
  const session = await openSession({ storage, discovery: true })
  const { manager } = session
  try {
    if (!json) {
      info(
        from
          ? `Waiting for an invite from "${from}"… (have a coordinator invite this device)`
          : 'Waiting for an invite… (have a coordinator invite this device)',
      )
    }

    const invite = await waitForInvite(manager, { from, timeout })
    const fromName = (await invitorName(manager, invite)) ?? 'a device'

    let accept = autoAccept
    if (!accept) {
      if (!process.stdin.isTTY) {
        throw new CliError(
          `Received an invite to "${invite.projectName}" from ${fromName}. ` +
            `Re-run with --auto-accept to join non-interactively.`,
          2,
        )
      }
      accept = await confirm({
        message: `Join project "${invite.projectName}" (invited by ${fromName})?`,
        default: true,
      })
    }

    if (!accept) {
      manager.invite.reject({ inviteId: invite.inviteId })
      if (json) printJson({ joined: false, projectName: invite.projectName })
      else info('Invite rejected.')
      return
    }

    if (!json) info(`Joining "${invite.projectName}"… (this can take a moment)`)
    const projectId = await manager.invite.accept({ inviteId: invite.inviteId })

    if (json)
      printJson({ joined: true, projectId, projectName: invite.projectName })
    else info(`Joined "${invite.projectName}"\n  ${shortId(projectId)}`)
  } finally {
    await session.close()
  }
}
