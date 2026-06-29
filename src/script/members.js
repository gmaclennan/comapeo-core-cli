import { shortId } from '../core/format.js'
import { openSession } from '../core/session.js'
import { info, printJson, printTable } from './output.js'
import { pickProjectId } from './resolve-project.js'

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
  const { manager } = session
  try {
    const projectId = await pickProjectId(manager, { project, json })
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
