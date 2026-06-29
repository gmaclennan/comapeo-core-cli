import assert from 'node:assert/strict'
import { after, test } from 'node:test'

import { startTui } from '../src/tui/app.js'
import { makeManager, noopDiscovery } from './helpers/managers.js'
import {
  KEY,
  makeCaptureStdout,
  makeFakeStdin,
  waitFor,
} from './helpers/tui-io.js'

/**
 * Drive the read-only data browser entirely with arrow keys: menu → data types
 * → records → a single record, then back out. Single manager, no network.
 */

/** @type {Array<() => Promise<void>>} */
const cleanups = []
after(async () => {
  for (const fn of cleanups.reverse()) await fn()
})

test(
  'arrow-nav data browse opens a record and pages back out',
  { timeout: 30_000 },
  async () => {
    const { manager, config } = await makeManager('solo', cleanups)
    const projectId = await manager.createProject({ name: 'Survey' })
    config.data.lastProjectId = projectId
    await config.write()

    const project = await manager.getProject(projectId)
    for (const lat of [1, 2]) {
      await project.observation.create({
        schemaName: 'observation',
        lat,
        lon: lat,
        tags: { type: 'point' },
        attachments: [],
        metadata: {},
      })
    }

    const stdin = makeFakeStdin()
    const cap = makeCaptureStdout()
    const ui = startTui({
      io: { stdin, stdout: cap.stdout },
      session: {
        manager,
        config,
        ...noopDiscovery,
        close: async () => {},
      },
    })

    await waitFor(() => cap.output().includes('CoMapeo'), { label: 'menu' })

    stdin.write('d')
    await waitFor(() => /observations\s+2/.test(cap.output()), {
      label: 'datatype list with counts',
    })

    stdin.write(KEY.enter) // open observations (first row)
    await waitFor(() => cap.output().includes('2 records'), {
      label: 'record list',
    })

    stdin.write(KEY.down)
    stdin.write(KEY.enter) // open the second record
    await waitFor(() => cap.output().includes('read-only'), {
      label: 'record detail',
    })

    const out = cap.output()
    assert.match(out, /docId/)
    assert.match(out, /tags/)
    assert.match(out, /type\s+point/, 'tag flattened one level')

    // A lone Esc byte resolves only after keys.js's escapeCodeTimeout (50ms), so
    // settle between writes to keep each Esc from coalescing with the next byte.
    const settle = () => new Promise((r) => setTimeout(r, 80))

    stdin.write(KEY.escape) // record → record list
    await settle()
    await waitFor(() => cap.output().includes('Data ▸ observations'), {
      label: 'back to record list',
    })

    stdin.write(KEY.escape) // record list → datatype list
    await settle()
    await waitFor(() => /observations\s+2/.test(cap.output()), {
      label: 'back to datatype list',
    })

    stdin.write(KEY.ctrlC)
    await ui
  },
)

test('members screen lists the local device', { timeout: 30_000 }, async () => {
  const { manager, config } = await makeManager('solo-m', cleanups)
  const projectId = await manager.createProject({ name: 'P' })
  config.data.lastProjectId = projectId
  await config.write()

  const stdin = makeFakeStdin()
  const cap = makeCaptureStdout()
  const ui = startTui({
    io: { stdin, stdout: cap.stdout },
    session: {
      manager,
      config,
      ...noopDiscovery,
      close: async () => {},
    },
  })

  await waitFor(() => cap.output().includes('CoMapeo'), { label: 'menu' })
  stdin.write('m')
  await waitFor(
    () =>
      cap.output().includes('Members') && /solo-m.*\(you\)/.test(cap.output()),
    {
      label: 'members list shows this device',
    },
  )

  stdin.write(KEY.ctrlC)
  await ui
})
