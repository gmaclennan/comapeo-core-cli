import fs from 'node:fs/promises'

import { resolveProjectId } from '../core/projects.js'
import { openSession } from '../core/session.js'
import { CliError, info, printJson } from './output.js'

/**
 * Export a project's data to a folder as GeoJSON (default) or a zip that bundles
 * attachments. Reads locally stored data + blobs directly (no media server).
 *
 * @param {object} args
 * @param {string} args.storage
 * @param {string} args.out Folder to write the export into (the file name is auto-generated)
 * @param {string} [args.project] Project id or unique prefix
 * @param {boolean} [args.zip] Export a zip (incl. attachments) instead of GeoJSON
 * @param {string} [args.lang] Language for translated names
 * @param {boolean} [args.json]
 */
export async function exportData({ storage, out, project, zip, lang, json }) {
  if (!out) throw new CliError('An output folder is required (--out <dir>).', 2)
  const session = await openSession({ storage })
  const { manager, config } = session
  try {
    const projectId = await resolveProjectId(manager, {
      projectId: project,
      fallbackId: config.data.lastProjectId,
    }).catch((e) => {
      throw new CliError(e.message, 2)
    })

    await fs.mkdir(out, { recursive: true })
    const projectInstance = /** @type {any} */ (
      await manager.getProject(projectId)
    )
    const opts = lang ? { lang } : {}
    const path = zip
      ? await projectInstance.exportZipFile(out, opts)
      : await projectInstance.exportGeoJSONFile(out, opts)

    const archived = manager.getIsArchiveDevice()
    if (json) {
      printJson({
        path,
        format: zip ? 'zip' : 'geojson',
        archiveDevice: archived,
      })
    } else {
      info(`Exported ${zip ? 'zip' : 'GeoJSON'} to\n  ${path}`)
      // A non-archive device intentionally skips original media variants.
      if (!archived) {
        info(
          'Note: not an archive device — original media variants may be missing from the export.',
        )
      }
    }
  } finally {
    await session.close()
  }
}
