import assert from 'node:assert/strict'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
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
 * Exercise the editable, drill-down screens added to the TUI: the projects
 * action menu (switch), device settings as an arrow-nav list (rename via a
 * prompt), and opening your own device from the Members list.
 */

/** @type {Array<() => Promise<void>>} */
const cleanups = []
after(async () => {
  for (const fn of cleanups.reverse()) await fn()
})

// A lone Esc resolves only after keys.js's escapeCodeTimeout (50ms).
const settle = () => new Promise((r) => setTimeout(r, 80))

test(
  'projects drill-down switches to the highlighted project',
  { timeout: 30_000 },
  async () => {
    const { manager, config } = await makeManager('switcher', cleanups)
    await manager.createProject({ name: 'Alpha' })
    await manager.createProject({ name: 'Beta' })

    const stdin = makeFakeStdin()
    const cap = makeCaptureStdout()
    const ui = startTui({
      io: { stdin, stdout: cap.stdout },
      session: { manager, config, ...noopDiscovery, close: async () => {} },
    })

    await waitFor(() => cap.output().includes('CoMapeo'), { label: 'menu' })
    stdin.write('p') // manage projects
    await waitFor(
      () =>
        cap.output().includes('Projects') &&
        cap.output().includes('Alpha') &&
        cap.output().includes('Beta'),
      { label: 'projects list' },
    )

    stdin.write(KEY.enter) // open the highlighted project's screen
    await waitFor(() => cap.output().includes('Switch to this project'), {
      label: 'project screen',
    })

    // Rows: Name, Description, ─, Switch, Create, Leave — move to Switch.
    stdin.write(KEY.down)
    stdin.write(KEY.down)
    stdin.write(KEY.enter) // "Switch to this project"
    await waitFor(() => /project:\s*Alpha/.test(cap.output()), {
      label: 'switched, back on the home menu',
    })
    assert.ok(config.data.lastProjectId, 'persisted the selected project id')

    stdin.write(KEY.ctrlC)
    await ui
  },
)

test(
  'device settings list renames the device via a prompt',
  { timeout: 30_000 },
  async () => {
    const { manager, config } = await makeManager('laptop', cleanups)

    const stdin = makeFakeStdin()
    const cap = makeCaptureStdout()
    const ui = startTui({
      io: { stdin, stdout: cap.stdout },
      session: { manager, config, ...noopDiscovery, close: async () => {} },
    })

    await waitFor(() => cap.output().includes('CoMapeo'), { label: 'menu' })
    stdin.write('e') // device settings
    await waitFor(
      () =>
        cap.output().includes('Device settings') &&
        cap.output().includes('laptop'),
      { label: 'device settings list' },
    )

    stdin.write(KEY.enter) // edit the Name field (first row) → opens a prompt
    await waitFor(() => cap.output().includes('Device name'), {
      label: 'rename prompt',
    })
    stdin.write('basecamp')
    stdin.write(KEY.enter)

    await waitFor(() => config.data.deviceName === 'basecamp', {
      label: 'device renamed',
    })
    await waitFor(() => cap.output().includes('basecamp'), {
      label: 'list reflects the new name',
    })

    stdin.write(KEY.ctrlC)
    await ui
  },
)

test(
  'members list opens device settings for your own device',
  { timeout: 30_000 },
  async () => {
    const { manager, config } = await makeManager('me', cleanups)
    const projectId = await manager.createProject({ name: 'Survey' })
    config.data.lastProjectId = projectId
    await config.write()

    const stdin = makeFakeStdin()
    const cap = makeCaptureStdout()
    const ui = startTui({
      io: { stdin, stdout: cap.stdout },
      session: { manager, config, ...noopDiscovery, close: async () => {} },
    })

    await waitFor(() => cap.output().includes('CoMapeo'), { label: 'menu' })
    stdin.write('m')
    await waitFor(() => cap.output().includes('(you)'), {
      label: 'members list',
    })

    stdin.write(KEY.enter) // open your own device
    await waitFor(() => cap.output().includes('Device settings'), {
      label: 'device settings from members',
    })

    stdin.write(KEY.escape) // back to members
    await settle()
    await waitFor(() => cap.output().includes('Members'), {
      label: 'back to members',
    })

    stdin.write(KEY.ctrlC)
    await ui
  },
)

test(
  'project settings edits the description in place',
  { timeout: 30_000 },
  async () => {
    const { manager, config } = await makeManager('editor', cleanups)
    const projectId = await manager.createProject({ name: 'Río Bravo' })
    config.data.lastProjectId = projectId
    await config.write()

    const stdin = makeFakeStdin()
    const cap = makeCaptureStdout()
    const ui = startTui({
      io: { stdin, stdout: cap.stdout },
      session: { manager, config, ...noopDiscovery, close: async () => {} },
    })

    await waitFor(() => cap.output().includes('CoMapeo'), { label: 'menu' })
    stdin.write('p')
    await waitFor(() => cap.output().includes('Río Bravo'), {
      label: 'projects list',
    })
    stdin.write(KEY.enter) // open the project screen (settings are fields here)
    await waitFor(() => cap.output().includes('Description'), {
      label: 'settings fields',
    })

    stdin.write(KEY.down) // Name → Description field
    stdin.write(KEY.enter) // edit it
    await waitFor(() => cap.output().includes('Project description'), {
      label: 'description prompt',
    })
    stdin.write('hydrology survey')
    stdin.write(KEY.enter)

    const project = await manager.getProject(projectId)
    await waitFor(
      async () =>
        (await project.$getProjectSettings()).projectDescription ===
        'hydrology survey',
      { label: 'description persisted' },
    )
    await waitFor(() => cap.output().includes('hydrology survey'), {
      label: 'description shown in the list',
    })

    stdin.write(KEY.ctrlC)
    await ui
  },
)

test(
  'data screen exports the project to a folder',
  { timeout: 30_000 },
  async () => {
    const { manager, config } = await makeManager('exporter', cleanups)
    const projectId = await manager.createProject({ name: 'Survey' })
    config.data.lastProjectId = projectId
    await config.write()
    const project = await manager.getProject(projectId)
    await project.observation.create({
      schemaName: 'observation',
      lat: 1,
      lon: 1,
      tags: {},
      attachments: [],
      metadata: {},
    })

    const base = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), 'comapeo-export-'),
    )
    cleanups.push(() => fsPromises.rm(base, { recursive: true, force: true }))
    // A not-yet-existing nested folder: export must create it (the mkdir fix).
    const outDir = path.join(base, 'nested', 'out')

    const stdin = makeFakeStdin()
    const cap = makeCaptureStdout()
    const ui = startTui({
      io: { stdin, stdout: cap.stdout },
      session: { manager, config, ...noopDiscovery, close: async () => {} },
    })

    await waitFor(() => cap.output().includes('CoMapeo'), { label: 'menu' })
    stdin.write('d')
    await waitFor(() => cap.output().includes('Export data'), {
      label: 'data screen with actions',
    })

    for (let i = 0; i < 12; i++) stdin.write(KEY.down) // clamp to the last row
    stdin.write(KEY.enter) // "Export data…"
    await waitFor(() => cap.output().includes('Export to folder'), {
      label: 'folder prompt',
    })
    stdin.write(outDir)
    stdin.write(KEY.enter)
    await waitFor(() => cap.output().includes('Export format'), {
      label: 'format prompt',
    })
    stdin.write(KEY.enter) // GeoJSON (default first choice)

    await waitFor(() => cap.output().includes('Wrote geojson'), {
      label: 'export completed',
    })
    const files = await fsPromises.readdir(outDir)
    assert.ok(
      files.some((f) => f.endsWith('.geojson')),
      `a .geojson file was written (saw: ${files.join(', ')})`,
    )

    stdin.write(KEY.ctrlC)
    await ui
  },
)

test(
  'data screen exposes a mock-data generator',
  { timeout: 30_000 },
  async () => {
    const { manager, config } = await makeManager('mocker', cleanups)
    const projectId = await manager.createProject({ name: 'Survey' })
    config.data.lastProjectId = projectId
    await config.write()

    const stdin = makeFakeStdin()
    const cap = makeCaptureStdout()
    const ui = startTui({
      io: { stdin, stdout: cap.stdout },
      session: { manager, config, ...noopDiscovery, close: async () => {} },
    })

    await waitFor(() => cap.output().includes('CoMapeo'), { label: 'menu' })
    stdin.write('d')
    await waitFor(() => cap.output().includes('Generate mock data'), {
      label: 'data screen lists the generator',
    })

    // Find and open the generator (rows above it vary with seeded datatypes).
    for (let i = 0; i < 12; i++) stdin.write(KEY.up) // clamp to the first row
    // The generator sits just after the datatype groups; page down to it.
    for (let i = 0; i < 12; i++) stdin.write(KEY.down)
    stdin.write(KEY.up) // last action is Export; one up is Generate
    stdin.write(KEY.enter)
    await waitFor(() => cap.output().includes('How many observations'), {
      label: 'generator prompt opened',
    })

    stdin.write(KEY.ctrlC) // first Ctrl-C cancels the prompt (back to Data)
    await settle()
    stdin.write(KEY.ctrlC) // now quit the TUI
    await ui
  },
)
