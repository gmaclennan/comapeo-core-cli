import assert from 'node:assert/strict'
import { after, test } from 'node:test'

import { generateFixtures } from '../src/core/fixtures.js'
import { makeManager } from './helpers/managers.js'

/** @type {Array<() => Promise<void>>} */
const cleanups = []
after(async () => {
  for (const fn of cleanups.reverse()) await fn()
})

test('generateFixtures creates observations and tracks around a center', async () => {
  const { manager } = await makeManager('fixtures', cleanups)
  const projectId = await manager.createProject({ name: 'Demo' })
  const project = await manager.getProject(projectId)

  const center = { lat: 12.34, lon: -68.98, source: 'test' }
  const result = await generateFixtures(project, {
    center,
    observations: 6,
    tracks: 2,
    radius: 1,
  })

  assert.equal(result.observations.length, 6)
  assert.equal(result.tracks.length, 2)
  assert.equal((await project.observation.getMany()).length, 6)
  assert.equal((await project.track.getMany()).length, 2)

  // Observations land within a degree of the center, and carry tags.
  for (const o of await project.observation.getMany()) {
    assert.ok(Math.abs((o.lat ?? 0) - center.lat) < 1, 'lat near center')
    assert.ok(Math.abs((o.lon ?? 0) - center.lon) < 1, 'lon near center')
    assert.ok(o.tags && Object.keys(o.tags).length > 0, 'has tags')
  }
  // Tracks carry a non-empty GPS path.
  for (const t of await project.track.getMany()) {
    assert.ok(
      Array.isArray(t.locations) && t.locations.length > 0,
      'has a path',
    )
    assert.equal(typeof t.locations[0].coords.latitude, 'number')
  }
})
