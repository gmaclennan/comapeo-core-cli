import { idMatches, shortId } from './format.js'

/**
 * Resolve which project a command should act on: an explicit id (full or a
 * unique prefix, raw or short form), else the only project if there's exactly
 * one. Throws a descriptive error when no id is given and the choice is
 * ambiguous, or when an id matches zero/many projects.
 *
 * There is deliberately no "last-used project" fallback: acting on a project
 * implicitly chosen by a previous command is too surprising. Callers that want
 * to let an operator pick interactively should catch the ambiguity (see
 * {@link AmbiguousProjectError}) and prompt.
 *
 * @param {import('@comapeo/core').MapeoManager} manager
 * @param {object} [opts]
 * @param {string} [opts.projectId] Explicit id or unique prefix (raw or short)
 * @returns {Promise<string>}
 */
export async function resolveProjectId(manager, { projectId } = {}) {
  const projects = await manager.listProjects()
  if (projects.length === 0) {
    throw new Error('No projects yet. Join one, or create one first.')
  }

  if (projectId) {
    const matches = projects.filter((p) => idMatches(p.projectId, projectId))
    if (matches.length === 1) return matches[0].projectId
    if (matches.length === 0)
      throw new Error(`No project matches "${projectId}".`)
    throw new Error(
      `"${projectId}" matches ${matches.length} projects; be more specific.`,
    )
  }

  if (projects.length === 1) return projects[0].projectId

  throw new AmbiguousProjectError(projects)
}

/**
 * Thrown when no project id was given and more than one project exists, so the
 * caller must either demand `--project` or prompt the operator to choose.
 */
export class AmbiguousProjectError extends Error {
  /** @param {Array<{ projectId: string, name?: string }>} projects */
  constructor(projects) {
    super(
      'Multiple projects exist; specify one with --project <id>:\n' +
        projects
          .map((p) => `  ${shortId(p.projectId)}  ${p.name ?? ''}`)
          .join('\n'),
    )
    this.name = 'AmbiguousProjectError'
    this.projects = projects
  }
}
