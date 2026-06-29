/**
 * Resolve which project a command should act on: an explicit id (full or a
 * unique prefix), else the last-used project from config, else the only project.
 * Throws a descriptive error when ambiguous.
 *
 * @param {import('@comapeo/core').MapeoManager} manager
 * @param {object} [opts]
 * @param {string} [opts.projectId] Explicit id or unique prefix
 * @param {string} [opts.fallbackId] e.g. the last-used project id from config
 * @returns {Promise<string>}
 */
export async function resolveProjectId(
  manager,
  { projectId, fallbackId } = {},
) {
  const projects = await manager.listProjects()
  if (projects.length === 0) {
    throw new Error('No projects yet. Join one, or create one first.')
  }

  if (projectId) {
    const matches = projects.filter(
      (p) => p.projectId === projectId || p.projectId.startsWith(projectId),
    )
    if (matches.length === 1) return matches[0].projectId
    if (matches.length === 0)
      throw new Error(`No project matches "${projectId}".`)
    throw new Error(
      `"${projectId}" matches ${matches.length} projects; be more specific.`,
    )
  }

  if (fallbackId && projects.some((p) => p.projectId === fallbackId)) {
    return fallbackId
  }

  if (projects.length === 1) return projects[0].projectId

  throw new Error(
    'Multiple projects exist; specify one with --project <id>:\n' +
      projects
        .map((p) => `  ${p.projectId.slice(0, 12)}  ${p.name ?? ''}`)
        .join('\n'),
  )
}
