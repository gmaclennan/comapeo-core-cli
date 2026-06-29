import { shortId } from '../core/format.js'
import { resolveProjectId } from '../core/projects.js'
import { openSession } from '../core/session.js'
import { CliError, info, printJson, printTable } from './output.js'

const SCHEMAS = ['observation', 'track', 'preset', 'field']

/**
 * View records of one data type, read-only (locally stored project data).
 *
 * @param {object} args
 * @param {string} args.storage
 * @param {string} args.schema observation | track | preset | field
 * @param {string} [args.project] Project id or unique prefix
 * @param {string} [args.lang] Language for translated preset/field names
 * @param {boolean} [args.json]
 */
export async function view({ storage, schema, project, lang, json }) {
  const session = await openSession({ storage })
  const { manager, config } = session
  try {
    const projectId = await resolveProjectId(manager, {
      projectId: project,
      fallbackId: config.data.lastProjectId,
    }).catch((e) => {
      throw new CliError(e.message, 2)
    })

    const projectInstance = /** @type {any} */ (
      await manager.getProject(projectId)
    )
    const dataType = projectInstance[schema]
    if (!dataType || typeof dataType.getMany !== 'function') {
      throw new CliError(
        `Unknown data type "${schema}" (try: ${SCHEMAS.join(', ')}).`,
        2,
      )
    }

    const docs = await dataType.getMany(lang ? { lang } : {})
    if (json) {
      printJson(docs)
      return
    }
    if (docs.length === 0) {
      info(`No ${schema}s.`)
      return
    }
    printTable(docs.map(summarize))
  } finally {
    await session.close()
  }
}

/** A compact, schema-agnostic row for the human table. @param {any} d */
function summarize(d) {
  /** @type {Record<string, string | number>} */
  const row = {
    id: shortId(d.docId),
    created: d.createdAt ? String(d.createdAt).slice(0, 10) : '',
  }
  if (d.lat != null && d.lon != null) {
    row.lat = d.lat
    row.lon = d.lon
  }
  if (d.name != null) row.name = d.name
  const tags = tagSummary(d.tags)
  if (tags) row.tags = tags
  return row
}

/** @param {any} tags */
function tagSummary(tags) {
  if (!tags || typeof tags !== 'object') return ''
  return Object.entries(tags)
    .slice(0, 3)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')
}
