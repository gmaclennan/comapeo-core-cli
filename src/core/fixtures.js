/**
 * Synthetic data generation for demos and testing. Creates observations and
 * tracks scattered around a center point. Not part of the read-only TUI — this
 * is a dev/demo helper used by the `fixtures` command and the demo script.
 */

const DEMO_TYPES = [
  'water',
  'tree',
  'building',
  'trail-marker',
  'camp',
  'hazard',
  'animal',
  'plant',
]

/**
 * @typedef {{ lat: number, lon: number, source: string }} Center
 */

/**
 * Resolve a center point: explicit lat/lon, else a geo-IP lookup, else null.
 * The geo-IP lookup is an external HTTPS request that exposes this machine's
 * public IP to the lookup service.
 *
 * @param {object} opts
 * @param {number} [opts.lat]
 * @param {number} [opts.lon]
 * @param {boolean} [opts.geoip] Allow a geo-IP fallback (default true)
 * @returns {Promise<Center | null>}
 */
export async function resolveCenter({ lat, lon, geoip = true }) {
  if (typeof lat === 'number' && typeof lon === 'number') {
    return { lat, lon, source: 'provided' }
  }
  if (geoip) return geoIpCenter()
  return null
}

/** @returns {Promise<Center | null>} */
async function geoIpCenter() {
  try {
    const res = await fetch('https://ipwho.is/', {
      signal: AbortSignal.timeout(4000),
    })
    const j = /** @type {any} */ (await res.json())
    if (
      j &&
      j.success !== false &&
      typeof j.latitude === 'number' &&
      typeof j.longitude === 'number'
    ) {
      return {
        lat: j.latitude,
        lon: j.longitude,
        source: `geo-ip (${j.city || 'approx'})`,
      }
    }
  } catch {
    // network/lookup failure — caller falls back to requiring lat/lon
  }
  return null
}

/** @param {number} n @param {number} [p] */
const round = (n, p = 6) => Math.round(n * 10 ** p) / 10 ** p
/** @param {number} min @param {number} max */
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min
/** @param {readonly any[]} arr */
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

/**
 * A point uniformly distributed within `radiusKm` of the center.
 * @param {Center} center @param {number} radiusKm
 */
function jitter(center, radiusKm) {
  const r = radiusKm * Math.sqrt(Math.random())
  const theta = Math.random() * 2 * Math.PI
  const dLat = (r / 111) * Math.cos(theta)
  const dLon =
    (r / (111 * Math.cos((center.lat * Math.PI) / 180))) * Math.sin(theta)
  return { lat: round(center.lat + dLat), lon: round(center.lon + dLon) }
}

/**
 * A short random-walk path of GPS positions near the center.
 * @param {Center} center @param {number} radiusKm @param {number} points
 */
function makeTrackPath(center, radiusKm, points) {
  const start = jitter(center, radiusKm)
  let { lat, lon } = start
  const t0 = Date.now() - points * 60_000
  return Array.from({ length: points }, (_, i) => {
    lat = round(lat + (Math.random() - 0.5) * 0.0009)
    lon = round(lon + (Math.random() - 0.5) * 0.0009)
    return {
      timestamp: new Date(t0 + i * 60_000).toISOString(),
      mocked: true,
      coords: {
        latitude: lat,
        longitude: lon,
        accuracy: round(randInt(3, 15), 2),
      },
    }
  })
}

/**
 * Create `observations` observations and `tracks` tracks around `center`.
 * Observation tags reuse a random project preset's tags when available.
 *
 * @param {any} project A MapeoProject instance
 * @param {object} opts
 * @param {Center} opts.center
 * @param {number} [opts.observations]
 * @param {number} [opts.tracks]
 * @param {number} [opts.radius] km
 * @returns {Promise<{ observations: any[], tracks: any[] }>}
 */
export async function generateFixtures(
  project,
  { center, observations = 0, tracks = 0, radius = 2 },
) {
  const presets = await project.preset.getMany().catch(() => [])
  /** @type {any[]} */
  const obs = []
  for (let i = 0; i < observations; i++) {
    const p = jitter(center, radius)
    const preset = presets.length ? pick(presets) : null
    const tags =
      preset?.tags && Object.keys(preset.tags).length
        ? { ...preset.tags }
        : { type: pick(DEMO_TYPES) }
    obs.push(
      await project.observation.create({
        schemaName: 'observation',
        lat: p.lat,
        lon: p.lon,
        tags,
        attachments: [],
        metadata: {},
      }),
    )
  }
  /** @type {any[]} */
  const trk = []
  for (let i = 0; i < tracks; i++) {
    const refs = obs.length
      ? Array.from({ length: Math.min(obs.length, randInt(0, 3)) }, () => {
          const o = pick(obs)
          return { docId: o.docId, versionId: o.versionId }
        })
      : []
    trk.push(
      await project.track.create({
        schemaName: 'track',
        observationRefs: refs,
        tags: {},
        locations: makeTrackPath(center, radius, randInt(8, 20)),
      }),
    )
  }
  return { observations: obs, tracks: trk }
}
