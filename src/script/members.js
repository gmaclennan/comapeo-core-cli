import { shortId } from '../core/format.js'
import { resolveProjectId } from '../core/projects.js'
import { openSession } from '../core/session.js'
import { CliError, info, printJson, printTable } from './output.js'

/**
 * List the members of a project (read-only — locally stored project data, no
 * network needed).
 *
 * @param {object} args
 * @param {string} args.storage
 * @param {string} [args.project] Project id or unique prefix
 * @param {boolean} [args.json]
 */
export async function membersList({ storage, project, json }) {
  const session = await openSession({ storage })
  const { manager, config } = session
  try {
    const projectId = await resolveProjectId(manager, {
      projectId: project,
      fallbackId: config.data.lastProjectId,
    }).catch((e) => {
      throw new CliError(e.message, 2)
    })
    const projectInstance = await manager.getProject(projectId)
    const members = await projectInstance.$member.getMany()
    if (json) {
      printJson(members)
      return
    }
    if (members.length === 0) {
      info('No members.')
      return
    }
    printTable(
      members.map((m) => ({
        name: m.name ?? '(unknown)',
        id: shortId(m.deviceId),
        role: m.role?.name ?? '',
        deviceType: m.deviceType ?? '',
        you: m.deviceId === manager.deviceId ? 'you' : '',
      })),
    )
  } finally {
    await session.close()
  }
}
