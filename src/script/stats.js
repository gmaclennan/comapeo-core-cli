import { openSession } from '../core/session.js'
import { info, printJson, printTable } from './output.js'
import { pickProjectId } from './resolve-project.js'

/**
 * Project activity stats. Core's `$getStats` returns new observations, tracks,
 * and members bucketed by week over roughly the last three months — so the
 * human summary is a recent total, not a lifetime count.
 *
 * @param {object} args
 * @param {string} args.storage
 * @param {string} [args.project] Project id or unique prefix
 * @param {boolean} [args.json]
 */
export async function stats({ storage, project, json }) {
  const session = await openSession({ storage })
  const { manager } = session
  try {
    const projectId = await pickProjectId(manager, { project, json })

    const projectInstance = /** @type {any} */ (
      await manager.getProject(projectId)
    )
    const projectStats = projectInstance.$getStats()
    if (json) {
      printJson(projectStats)
      return
    }

    /** @param {{ values: Array<[string, number]> }} s */
    const total = (s) => s.values.reduce((sum, [, n]) => sum + n, 0)
    info('New records by week, last ~3 months:')
    printTable([
      { category: 'observations', total: total(projectStats.observations) },
      { category: 'tracks', total: total(projectStats.tracks) },
      { category: 'members', total: total(projectStats.members) },
    ])
  } finally {
    await session.close()
  }
}
