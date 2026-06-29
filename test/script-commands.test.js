import assert from 'node:assert/strict'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

import { generateFixtures } from '../src/core/fixtures.js'
import { shortId } from '../src/core/format.js'
import { openSession } from '../src/core/session.js'
import { deviceArchive } from '../src/script/device.js'
import { exportData } from '../src/script/export.js'
import { invite } from '../src/script/invite.js'
import { membersList } from '../src/script/members.js'
import { projectsLeave } from '../src/script/projects.js'
import { stats } from '../src/script/stats.js'
import { view } from '../src/script/view.js'

/**
 * Exercise the read/export scriptable commands against a seeded project on a
 * temp storage dir (no network). Each handler opens and closes its own session,
 * so the seed session is closed first to release the single-writer lock.
 */

/** @type {Array<() => Promise<void>>} */
const cleanups = []
after(async () => {
  for (const fn of cleanups.reverse()) await fn()
})

/** Capture everything a fn writes to stdout. @param {() => Promise<void>} fn */
async function captureStdout(fn) {
  const orig = process.stdout.write.bind(process.stdout)
  let out = ''
  process.stdout.write = (/** @type {any} */ chunk) => {
    out += String(chunk)
    return true
  }
  try {
    await fn()
  } finally {
    process.stdout.write = orig
  }
  return out
}

test(
  'members / view / export read a seeded project',
  { timeout: 30_000 },
  async () => {
    const storage = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), 'comapeo-script-'),
    )
    cleanups.push(() =>
      fsPromises.rm(storage, { recursive: true, force: true }),
    )

    // Seed a project, then release the lock so the command handlers can open it.
    const session = await openSession({ storage })
    await session.manager.setDeviceInfo({
      name: 'tester',
      deviceType: 'desktop',
    })
    session.config.data.deviceName = 'tester'
    session.config.data.configured = true
    const projectId = await session.manager.createProject({ name: 'Smoke' })
    session.config.data.lastProjectId = projectId
    await session.config.write()
    const project = await session.manager.getProject(projectId)
    await generateFixtures(project, {
      center: { lat: 0, lon: 0, source: 'test' },
      observations: 5,
      tracks: 1,
      radius: 2,
    })
    await session.close()

    const members = JSON.parse(
      await captureStdout(() => membersList({ storage, json: true })),
    )
    assert.equal(members.length, 1, 'one member')
    assert.equal(members[0].name, 'tester')
    assert.equal(members[0].role?.name, 'Project Creator')

    const observations = JSON.parse(
      await captureStdout(() =>
        view({ storage, schema: 'observation', json: true }),
      ),
    )
    assert.equal(observations.length, 5, 'five observations')

    const out = path.join(storage, 'exp')
    const exported = JSON.parse(
      await captureStdout(() => exportData({ storage, out, json: true })),
    )
    assert.match(exported.path, /\.geojson$/)
    await fsPromises.access(exported.path) // throws if the file wasn't written

    const projectStats = JSON.parse(
      await captureStdout(() => stats({ storage, json: true })),
    )
    /** @param {{ values: Array<[string, number]> }} s */
    const sum = (s) => s.values.reduce((t, [, n]) => t + n, 0)
    assert.equal(
      sum(projectStats.observations),
      5,
      'stats counts the 5 observations',
    )
    assert.equal(sum(projectStats.tracks), 1, 'stats counts the 1 track')
  },
)

test('with multiple projects, a command refuses unless given --project', async () => {
  const storage = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), 'comapeo-multi-'),
  )
  cleanups.push(() => fsPromises.rm(storage, { recursive: true, force: true }))

  const seed = await openSession({ storage })
  const a = await seed.manager.createProject({ name: 'Alpha' })
  await seed.manager.createProject({ name: 'Beta' })
  // A leftover last-used id must NOT be used as a silent fallback anymore.
  seed.config.data.lastProjectId = a
  await seed.config.write()
  await seed.close()

  // Non-interactive + ambiguous → refuse (exit code 2), don't guess.
  await assert.rejects(
    () =>
      captureStdout(() => view({ storage, schema: 'observation', json: true })),
    (/** @type {any} */ err) =>
      err?.code === 2 && /Multiple projects/.test(err.message),
  )

  // An explicit short id disambiguates and resolves.
  const out = await captureStdout(() =>
    view({ storage, schema: 'observation', project: shortId(a), json: true }),
  )
  assert.deepEqual(JSON.parse(out), [], 'resolved to Alpha (empty project)')
})

test('device archive shows and toggles archive mode', async () => {
  const storage = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), 'comapeo-archive-'),
  )
  cleanups.push(() => fsPromises.rm(storage, { recursive: true, force: true }))

  // The CLI default is archive-on; toggling persists across reopen.
  const show = () => captureStdout(() => deviceArchive({ storage, json: true }))
  assert.deepEqual(JSON.parse(await show()), { isArchiveDevice: true })
  await captureStdout(() =>
    deviceArchive({ storage, state: 'off', json: true }),
  )
  assert.deepEqual(JSON.parse(await show()), { isArchiveDevice: false })
  await captureStdout(() => deviceArchive({ storage, state: 'on', json: true }))
  assert.deepEqual(JSON.parse(await show()), { isArchiveDevice: true })
})

test('projects leave removes the project and clears the last-used id', async () => {
  const storage = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), 'comapeo-leave-'),
  )
  cleanups.push(() => fsPromises.rm(storage, { recursive: true, force: true }))

  const seed = await openSession({ storage })
  const projectId = await seed.manager.createProject({ name: 'Temp' })
  seed.config.data.lastProjectId = projectId
  await seed.config.write()
  await seed.close()

  await captureStdout(() =>
    projectsLeave({ storage, id: projectId, yes: true, json: true }),
  )

  const check = await openSession({ storage })
  try {
    const projects = await check.manager.listProjects()
    assert.ok(
      !projects.some((p) => p.projectId === projectId),
      'project no longer listed',
    )
    assert.equal(
      check.config.data.lastProjectId,
      undefined,
      'last-used id cleared',
    )
  } finally {
    await check.close()
  }
})

test('invite rejects an unknown role before touching storage', async () => {
  await assert.rejects(
    () =>
      invite({
        storage: '/nonexistent',
        deviceId: 'whatever',
        role: /** @type {any} */ ('bogus'),
      }),
    /Unknown role/,
  )
})
