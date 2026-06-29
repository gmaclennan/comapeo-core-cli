import { generateFixtures, resolveCenter } from '../core/fixtures.js'
import { openSession } from '../core/session.js'
import { CliError, info, printJson } from './output.js'
import { pickProjectId } from './resolve-project.js'

/**
 * Generate synthetic observations/tracks for demos and testing.
 *
 * @param {object} args
 * @param {string} args.storage
 * @param {string} [args.project]
 * @param {number} [args.observations]
 * @param {number} [args.tracks]
 * @param {number} [args.lat]
 * @param {number} [args.lon]
 * @param {number} [args.radius] km
 * @param {boolean} [args.geoip] Allow geo-IP center lookup (default true)
 * @param {boolean} [args.json]
 */
export async function fixtures({
  storage,
  project,
  observations = 25,
  tracks = 3,
  lat,
  lon,
  radius = 2,
  geoip = true,
  json,
}) {
  const session = await openSession({ storage })
  try {
    const projectId = await pickProjectId(session.manager, { project, json })

    const center = await resolveCenter({ lat, lon, geoip })
    if (!center) {
      throw new CliError(
        'Could not determine a center location. Pass --lat and --lon (geo-IP lookup failed or --no-geoip was set).',
        2,
      )
    }
    if (!json) {
      info(
        `Center: ${center.lat.toFixed(5)}, ${center.lon.toFixed(5)} (${center.source}) · radius ${radius}km`,
      )
    }

    const projectInstance = await session.manager.getProject(projectId)
    const result = await generateFixtures(projectInstance, {
      center,
      observations,
      tracks,
      radius,
    })

    if (json) {
      printJson({
        projectId,
        center,
        observations: result.observations.length,
        tracks: result.tracks.length,
      })
    } else {
      info(
        `Created ${result.observations.length} observations, ${result.tracks.length} tracks.`,
      )
    }
  } finally {
    await session.close()
  }
}
