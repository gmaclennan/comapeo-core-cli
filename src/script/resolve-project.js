import { shortId } from '../core/format.js'
import { AmbiguousProjectError, resolveProjectId } from '../core/projects.js'
import { CliError } from './output.js'

/**
 * Resolve the project a command should act on. With `--project` (or a single
 * project), this is unambiguous. Otherwise: in an interactive terminal we prompt
 * the operator to pick; non-interactively (piped, scripted, or `--json`) we
 * refuse rather than guess, listing the choices.
 *
 * @param {import('@comapeo/core').MapeoManager} manager
 * @param {object} [opts]
 * @param {string} [opts.project] The `--project` value (id or unique prefix)
 * @param {boolean} [opts.json] Suppress the prompt (machine output)
 * @returns {Promise<string>}
 */
export async function pickProjectId(manager, { project, json } = {}) {
  try {
    return await resolveProjectId(manager, { projectId: project })
  } catch (err) {
    if (
      err instanceof AmbiguousProjectError &&
      !json &&
      process.stdin.isTTY &&
      process.stdout.isTTY
    ) {
      const { select } = await import('@inquirer/prompts')
      return select({
        message: 'Which project?',
        choices: err.projects.map((p) => ({
          name: `${p.name ?? '(unnamed)'}  ${shortId(p.projectId)}`,
          value: p.projectId,
        })),
      })
    }
    if (err instanceof CliError) throw err
    throw new CliError(err instanceof Error ? err.message : String(err), 2)
  }
}
