import { confirm } from '@inquirer/prompts'

import { shortId } from '../core/format.js'
import { resolveProjectId } from '../core/projects.js'
import { openSession } from '../core/session.js'
import { CliError, info, printJson, printTable } from './output.js'

/**
 * @param {object} args
 * @param {string} args.storage
 * @param {boolean} [args.json]
 * @param {boolean} [args.includeLeft]
 */
export async function projectsList({ storage, json, includeLeft }) {
  const session = await openSession({ storage })
  try {
    const projects = await session.manager.listProjects({ includeLeft })
    if (json) {
      printJson(projects)
      return
    }
    if (projects.length === 0) {
      info(
        'No projects. Create one with `comapeo projects create --name <name>`.',
      )
      return
    }
    printTable(
      projects.map((p) => ({
        id: shortId(p.projectId),
        name: p.name ?? '(unnamed)',
        status: p.status,
      })),
    )
  } finally {
    await session.close()
  }
}

/**
 * @param {object} args
 * @param {string} args.storage
 * @param {string} args.name
 * @param {boolean} [args.json]
 */
export async function projectsCreate({ storage, name, json }) {
  if (!name) throw new CliError('A project name is required (--name).', 2)
  const session = await openSession({ storage })
  try {
    const projectId = await session.manager.createProject({ name })
    if (json) printJson({ projectId, name })
    else info(`Created project "${name}"\n  ${shortId(projectId)}`)
  } finally {
    await session.close()
  }
}

/**
 * Leave a project — removes it from this device. Prompts for confirmation on a
 * TTY; requires `--yes` to leave non-interactively.
 *
 * @param {object} args
 * @param {string} args.storage
 * @param {string} args.id Project id or unique prefix to leave
 * @param {boolean} [args.yes] Skip the confirmation prompt
 * @param {boolean} [args.json]
 */
export async function projectsLeave({ storage, id, yes, json }) {
  const session = await openSession({ storage })
  const { manager, config } = session
  try {
    const projectId = await resolveProjectId(manager, { projectId: id }).catch(
      (e) => {
        throw new CliError(e.message, 2)
      },
    )
    const match = (await manager.listProjects()).find(
      (p) => p.projectId === projectId,
    )
    const name = match?.name ?? shortId(projectId)

    if (!yes) {
      if (!process.stdin.isTTY) {
        throw new CliError(
          `Re-run with --yes to leave "${name}" non-interactively.`,
          2,
        )
      }
      const ok = await confirm({
        message: `Leave project "${name}"? This removes it from this device.`,
        default: false,
      })
      if (!ok) {
        info('Cancelled.')
        return
      }
    }

    await manager.leaveProject(projectId)
    if (config.data.lastProjectId === projectId) {
      config.data.lastProjectId = undefined
      await config.write()
    }
    if (json) printJson({ left: true, projectId })
    else info(`Left "${name}".`)
  } finally {
    await session.close()
  }
}
