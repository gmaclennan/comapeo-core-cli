import { roles } from '@comapeo/core'
import { confirm, input, number, select } from '@inquirer/prompts'
import chalk from 'chalk'
import { createLogUpdate } from 'log-update'

import fs from 'node:fs/promises'
import os from 'node:os'

import { generateFixtures, resolveCenter } from '../core/fixtures.js'
import { shortId } from '../core/format.js'
import { openSession } from '../core/session.js'
import { runSync } from '../core/sync-runner.js'
import { createKeyReader } from './keys.js'
import {
  dashboard,
  networkScreen,
  peerDetail,
  recordDetail,
  sparkline,
} from './render.js'

const HIDE_CURSOR = '\x1b[?25l'
const SHOW_CURSOR = '\x1b[?25h'
// Clear the screen + scrollback and home the cursor.
const CLEAR_SCREEN = '\x1b[2J\x1b[3J\x1b[H'

/**
 * @typedef {object} ListSpec
 * @property {string} title
 * @property {string} [subtitle]
 * @property {string} [header]
 * @property {any[]} items
 * @property {number} [index]
 * @property {(item: any, selected: boolean) => string} render
 * @property {(item: any) => any} onSelect
 * @property {() => any} onBack
 * @property {string} [footer] Extra key hints appended to the footer
 * @property {string} [selectHint] Verb shown after `↵` in the footer (default "open")
 * @property {Record<string, (item: any) => any>} [extra] Extra hotkeys (key name → handler)
 */

/**
 * A human-readable error message, unwrapping the `cause` that core errors wrap
 * (e.g. GeoJSONExportError hides the real ENOENT/EACCES in `cause`).
 * @param {unknown} err
 */
function describeError(err) {
  if (!(err instanceof Error)) return String(err)
  const cause = /** @type {any} */ (err).cause
  const causeMsg =
    cause instanceof Error ? cause.message : cause ? String(cause) : ''
  return causeMsg ? `${err.message}: ${causeMsg}` : err.message
}

/** One-line summary of a record for a list (the date is its own column). */
function recordSummary(/** @type {any} */ doc) {
  if (doc.lat != null && doc.lon != null) return `${doc.lat}, ${doc.lon}`
  return doc.name ?? doc.schemaName ?? ''
}

/**
 * Launch the interactive terminal UI. Resolves when the user quits.
 *
 * IO is injectable so several TUIs can run in one process (tests); production
 * callers omit `io`/`session` and get the real process streams + a fresh session.
 *
 * @param {object} args
 * @param {string} [args.storage]
 * @param {{ stdin: any, stdout: any }} [args.io]
 * @param {import('../core/session.js').Session} [args.session] Pre-opened session (tests)
 */
export async function startTui({ storage, io, session: injectedSession }) {
  const stdin = io?.stdin ?? process.stdin
  const stdout = io?.stdout ?? process.stdout
  const logUpdate = createLogUpdate(stdout)
  const promptCtx = { input: stdin, output: stdout }

  const session =
    injectedSession ?? (await openSession({ storage: String(storage) }))
  const { manager, config } = session

  // First-run: make sure the device has a real name before doing anything.
  if (!config.data.configured) {
    const name = await input(
      {
        message: 'Welcome to CoMapeo. Name this device:',
        default:
          config.data.deviceName === 'comapeo-cli'
            ? os.hostname()
            : config.data.deviceName,
      },
      promptCtx,
    )
    await manager.setDeviceInfo({ name, deviceType: config.data.deviceType })
    config.data.deviceName = name
    config.data.configured = true
    await config.write()
  }

  const state = {
    /** @type {'menu' | 'join' | 'sync' | 'record' | 'list' | 'peerDetail' | 'message' | 'devices'} */
    screen: 'menu',
    /** @type {{ projectId: string, settings: any } | undefined} */
    projectSettings: undefined,
    /** Highlighted item on the home menu. */
    menuIndex: 0,
    /** Pending invites (with resolved `from` name) for the join screen. @type {any[]} */
    invites: [],
    /** Selected invite on the join screen. */
    inviteIndex: 0,
    /** @type {Record<string, any> | undefined} */
    record: undefined,
    /** Back action from the record screen (to the list it came from). @type {(() => any) | undefined} */
    recordBack: undefined,
    /** Active arrow-nav list. @type {(ListSpec & { index: number }) | undefined} */
    list: undefined,
    /** Selected peer row index on the sync dashboard. */
    peerIndex: 0,
    /** Show raw block counts (vs %/MB) on the sync dashboard. */
    raw: false,
    /** Peer row being inspected on the peer-detail screen. @type {any} */
    peerDetail: undefined,
    /** Transient message screen content. @type {{ title: string, body: string } | undefined} */
    message: undefined,
    /** Where `esc` returns from the message screen (defaults to sync|menu). @type {(() => any) | undefined} */
    messageBack: undefined,
    /** @type {import('@comapeo/core').PublicPeerInfo[]} */
    peers: [],
    /** Discovered LAN devices (for the Network screen). @type {import('../core/session.js').DiscoveredDevice[]} */
    devices: [],
    /** Selected row on the Network screen. */
    deviceIndex: 0,
    /** @type {string | undefined} */
    projectId: config.data.lastProjectId,
    /** @type {string | undefined} */
    projectName: undefined,
    /** @type {ReturnType<typeof runSync> | undefined} */
    sync: undefined,
    /** @type {(() => void) | undefined} */
    syncUnsub: undefined,
    /** Data sync running (vs the default stopped state). */
    syncing: false,
    busy: false,
  }

  await refreshSelectedProjectName()

  let resolveExit = () => {}
  /** @type {Promise<void>} */
  const exited = new Promise((res) => (resolveExit = res))

  // --- rendering -----------------------------------------------------------
  /** @type {NodeJS.Timeout | undefined} */
  let repaintTimer
  function scheduleRepaint() {
    if (repaintTimer) return
    repaintTimer = setTimeout(() => {
      repaintTimer = undefined
      repaint()
    }, 80)
  }
  function repaint() {
    if (state.busy) return // a prompt owns the screen
    logUpdate(frame())
  }
  function frame() {
    if (state.screen === 'sync' && state.sync) {
      if (!state.syncing) return syncStoppedFrame()
      return dashboard(state.sync.model, {
        projectName: state.projectName ?? '(project)',
        selectedIndex: state.peerIndex,
        raw: state.raw,
        rate: rate.value,
        spark: rate.spark,
      })
    }
    if (state.screen === 'message' && state.message) {
      return [
        chalk.bold(state.message.title),
        chalk.dim('  ' + '─'.repeat(56)),
        '  ' + state.message.body,
        '',
        chalk.dim('  esc back'),
      ].join('\n')
    }
    if (state.screen === 'list' && state.list) return listFrame(state.list)
    if (state.screen === 'peerDetail' && state.peerDetail) {
      return peerDetail(state.peerDetail, { raw: state.raw })
    }
    if (state.screen === 'record' && state.record) {
      return recordDetail(state.record)
    }
    if (state.screen === 'devices')
      return networkScreen(networkRows(), { selectedIndex: state.deviceIndex })
    if (state.screen === 'join') return joinFrame()
    return menuFrame()
  }
  /** The Network screen's flat selectable list: connected peers, then available devices. */
  function networkRows() {
    /** @type {import('./render.js').NetworkRow[]} */
    const connected = state.peers
      .filter((p) => p.status === 'connected')
      .map((peer) => ({ kind: 'peer', peer }))
    /** @type {import('./render.js').NetworkRow[]} */
    const available = state.devices
      .filter((d) => !d.dialed)
      .map((device) => ({ kind: 'device', device }))
    return [...connected, ...available]
  }
  function joinFrame() {
    const invites = state.invites
    const lines = [
      chalk.bold('Join a project'),
      chalk.dim('  ' + '─'.repeat(62)),
    ]
    if (invites.length === 0) {
      const peers = state.peers.filter((p) => p.status === 'connected')
      lines.push(
        '',
        chalk.dim('  Waiting for an invite…'),
        chalk.dim(
          '  Connect to a coordinator on the Network screen [n], then ask to be invited.',
        ),
        '',
        chalk.dim(
          peers.length
            ? `  connected: ${peers.map((p) => p.name ?? shortId(p.deviceId)).join(', ')}`
            : '  (no peers connected yet)',
        ),
        chalk.dim('  ' + '─'.repeat(62)),
        chalk.dim('  esc back'),
      )
      return lines.join('\n')
    }
    lines.push(
      chalk.dim('  ' + 'PROJECT'.padEnd(26) + 'ROLE'.padEnd(14) + 'FROM'),
    )
    invites.forEach((inv, i) => {
      const sel = i === state.inviteIndex
      const row =
        (inv.projectName ?? '(unnamed project)').padEnd(26) +
        chalk.blue((inv.roleName ?? 'member').padEnd(14)) +
        chalk.dim(inv.from ?? '(unknown)')
      lines.push((sel ? chalk.cyan('❯ ') : '  ') + row)
    })
    lines.push(
      chalk.dim('  ' + '─'.repeat(62)),
      chalk.dim('  ↑↓ select · ↵ accept · x reject · esc back'),
    )
    return lines.join('\n')
  }
  function syncStoppedFrame() {
    const connected = state.peers.filter((p) => p.status === 'connected').length
    return [
      chalk.bold('CoMapeo Sync') +
        chalk.dim(`   ${state.projectName ?? '(project)'}`),
      '',
      chalk.dim(
        'Data sync is off. Project & settings sync automatically while connected.',
      ),
      chalk.dim('Press ') +
        chalk.cyan('[s]') +
        chalk.dim(' to start syncing observations and media.'),
      '',
      chalk.dim(
        connected
          ? `  ${connected} peer${connected === 1 ? '' : 's'} connected`
          : '  No peers connected — open Network [n] to connect.',
      ),
      chalk.dim('  s start · esc back'),
    ].join('\n')
  }
  function menuFrame() {
    const connected = state.peers.filter((p) => p.status === 'connected').length
    const ctx = chalk.dim(
      `device: ${config.data.deviceName}   ` +
        `project: ${state.projectName ?? '(none selected)'}   ` +
        `peers connected: ${connected}`,
    )
    const rows = MENU.map((m, i) => {
      const label = typeof m.label === 'function' ? m.label() : m.label
      const caret = i === state.menuIndex ? chalk.cyan('❯ ') : '  '
      const key =
        i === state.menuIndex
          ? chalk.cyan(`[${m.key}]`)
          : chalk.dim(`[${m.key}]`)
      return `${caret}${key} ${label}`
    })
    return [
      chalk.bold('CoMapeo'),
      ctx,
      '',
      ...rows,
      '',
      chalk.dim('  ↑↓ move · ↵ open · or press a key'),
    ].join('\n')
  }

  // --- generic arrow-nav list ---------------------------------------------
  const LIST_WINDOW = 10 // visible rows; keeps long lists (e.g. 500 records) bounded
  /** @param {ListSpec & { index: number }} list */
  function listFrame(list) {
    const total = list.items.length
    const lines = [
      chalk.bold(list.title) +
        (list.subtitle ? chalk.dim(`   ${list.subtitle}`) : ''),
      chalk.dim('  ' + '─'.repeat(64)),
    ]
    if (list.header) lines.push(chalk.dim('  ' + list.header))
    if (total === 0) lines.push(chalk.dim('  (none)'))

    // Scroll a fixed-size window so the selected row is always visible.
    const start = Math.max(
      0,
      Math.min(list.index - Math.floor(LIST_WINDOW / 2), total - LIST_WINDOW),
    )
    const begin = Math.max(0, start)
    const end = Math.min(total, begin + LIST_WINDOW)
    if (begin > 0) lines.push(chalk.dim(`  ↑ ${begin} more`))
    for (let i = begin; i < end; i++) {
      const item = list.items[i]
      if (item && item.separator) {
        lines.push(chalk.dim('  ' + '─'.repeat(40)))
        continue
      }
      const sel = i === list.index
      lines.push((sel ? chalk.cyan('❯ ') : '  ') + list.render(item, sel))
    }
    if (end < total) lines.push(chalk.dim(`  ↓ ${total - end} more`))

    lines.push(chalk.dim('  ' + '─'.repeat(64)))
    lines.push(
      chalk.dim(
        `  ↑↓ move · ↵ ${list.selectHint ?? 'open'}${list.footer ? ` · ${list.footer}` : ''} · esc back`,
      ),
    )
    return lines.join('\n')
  }
  /** @param {ListSpec} opts */
  function showList(opts) {
    state.list = { index: 0, ...opts }
    state.screen = 'list'
    repaint()
  }
  function backToMenu() {
    state.screen = 'menu'
    state.list = undefined
    repaint()
  }

  // --- prompt baton-pass ---------------------------------------------------
  /**
   * Run an @inquirer prompt with sole ownership of stdin, then restore the loop.
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T | undefined>}
   */
  async function withPrompt(fn) {
    state.busy = true
    keys.pause()
    logUpdate.clear()
    stdout.write(SHOW_CURSOR)
    try {
      return await fn()
    } catch (err) {
      // @inquirer throws on Ctrl-C/Escape inside a prompt; treat as cancel.
      if (err instanceof Error && err.name === 'ExitPromptError')
        return undefined
      throw err
    } finally {
      state.busy = false
      stdout.write(HIDE_CURSOR)
      // @inquirer leaves the answered prompt on screen; wipe it (and scrollback)
      // so prompts don't pile up above the TUI as you move between screens.
      // log-update's tracked line count is already 0 (cleared at prompt start),
      // so it redraws cleanly from the homed cursor.
      stdout.write(CLEAR_SCREEN)
      keys.resume()
      repaint()
    }
  }

  async function refreshSelectedProjectName() {
    if (!state.projectId) return
    const projects = await manager.listProjects()
    const match = projects.find((p) => p.projectId === state.projectId)
    state.projectName = match?.name ?? undefined
    if (!match) state.projectId = undefined
  }

  // --- actions -------------------------------------------------------------
  /** @param {string} projectId @param {string | undefined} name @param {() => any} after */
  async function leaveProjectFlow(projectId, name, after) {
    const ok = await withPrompt(() =>
      confirm(
        { message: `Leave "${name ?? shortId(projectId)}"?`, default: false },
        promptCtx,
      ),
    )
    if (ok) {
      await manager.leaveProject(projectId)
      if (state.projectId === projectId) {
        state.projectId = undefined
        state.projectName = undefined
      }
      after()
    } else {
      repaint()
    }
  }

  /**
   * Projects screen. In `manage` mode (the home Projects entry) ↵ opens a
   * per-project screen with the editable settings (name, description) plus
   * switch / create / leave actions. In the picker flows (sync/members/data with
   * no project selected) ↵ just switches to the highlighted project and runs
   * `onPick`.
   *
   * @param {(projectId: string) => any} onPick
   * @param {{ manage?: boolean }} [opts]
   */
  async function showProjects(onPick, { manage = false } = {}) {
    const projects = await manager.listProjects()
    /** @param {{ projectId: string, name?: string }} p */
    const switchTo = (p) => {
      state.projectId = p.projectId
      state.projectName = p.name
      config.data.lastProjectId = p.projectId
      void config.write().catch(() => {})
      onPick(p.projectId)
    }
    const reopen = () => void showProjects(onPick, { manage })
    const createNew = async () => {
      const name = await withPrompt(() =>
        input(
          { message: 'New project name', default: 'My Project' },
          promptCtx,
        ),
      )
      if (name) {
        const projectId = await manager.createProject({ name })
        switchTo({ projectId, name })
      } else {
        reopen()
      }
    }
    /** @param {any} p */
    const openProjectMenu = async (p) => {
      const project = await manager.getProject(p.projectId)
      const settings = /** @type {any} */ (await project.$getProjectSettings())
      const ps = { projectId: p.projectId, settings }
      state.projectSettings = ps
      const current = state.projectId === p.projectId
      showList({
        title: settings.name ?? '(unnamed)',
        subtitle: `id ${shortId(p.projectId)}`,
        header: 'select a field and press ↵ to edit',
        selectHint: 'select',
        items: [
          {
            kind: 'field',
            key: 'name',
            label: 'Name',
            message: 'Project name',
          },
          {
            kind: 'field',
            key: 'projectDescription',
            label: 'Description',
            message: 'Project description',
          },
          { separator: true },
          {
            kind: 'action',
            label: current
              ? 'Switch to this project (current)'
              : 'Switch to this project',
            run: () => switchTo(p),
          },
          {
            kind: 'action',
            label: 'Create a new project…',
            run: () => void createNew(),
          },
          {
            kind: 'action',
            danger: true,
            label: 'Leave project…',
            run: () =>
              void leaveProjectFlow(p.projectId, ps.settings.name, reopen),
          },
        ],
        render: (it) => {
          if (it.kind === 'action')
            return it.danger ? chalk.red(it.label) : it.label
          const v = ps.settings[it.key]
          return it.label.padEnd(14) + (v ? String(v) : chalk.dim('(empty)'))
        },
        onSelect: (it) => {
          if (it.kind === 'action') return void it.run()
          void editProjectSetting(it.key, it.message)
        },
        onBack: reopen,
      })
    }
    showList({
      title: 'Projects',
      subtitle: `${projects.length} project${projects.length === 1 ? '' : 's'}`,
      header: 'NAME'.padEnd(26) + 'ID'.padEnd(8) + 'STATUS',
      footer:
        manage && projects.length === 0 ? 'c create your first project' : '',
      items: projects,
      render: (p) =>
        (p.name ?? '(unnamed)').padEnd(26) +
        chalk.gray(shortId(p.projectId).padEnd(8)) +
        chalk.dim(p.status),
      onSelect: manage ? openProjectMenu : switchTo,
      onBack: backToMenu,
      extra: manage ? { c: () => void createNew() } : undefined,
    })
  }

  // --- device settings -----------------------------------------------------
  const DEVICE_TYPES = /** @type {const} */ ([
    'desktop',
    'mobile',
    'tablet',
    'selfHostedServer',
  ])
  /** Editable device settings as an arrow-nav list: ↵ on a field edits it. */
  function showDevice(onBack = backToMenu) {
    showList({
      title: 'Device settings',
      subtitle: `id ${shortId(manager.deviceId)}`,
      header: 'select a field and press ↵ to edit',
      selectHint: 'edit',
      items: [{ field: 'name' }, { field: 'type' }, { field: 'archive' }],
      render: (it) => {
        if (it.field === 'name')
          return 'Name'.padEnd(14) + config.data.deviceName
        if (it.field === 'type')
          return 'Type'.padEnd(14) + config.data.deviceType
        return (
          'Archive'.padEnd(14) +
          (manager.getIsArchiveDevice()
            ? chalk.green('on') + chalk.dim('  stores all media')
            : chalk.dim('off'))
        )
      },
      onSelect: (it) => {
        if (it.field === 'name') void renameDevice()
        else if (it.field === 'type') void chooseDeviceType()
        else toggleArchive()
      },
      onBack,
    })
  }
  async function renameDevice() {
    const name = await withPrompt(() =>
      input(
        { message: 'Device name', default: config.data.deviceName },
        promptCtx,
      ),
    )
    if (name && name !== config.data.deviceName) {
      await manager.setDeviceInfo({ name, deviceType: config.data.deviceType })
      config.data.deviceName = name
      await config.write()
    }
    repaint()
  }
  function toggleArchive() {
    try {
      manager.setIsArchiveDevice(!manager.getIsArchiveDevice())
    } catch {
      // setIsArchiveDevice throws only if the value didn't change; flipping always does.
    }
    repaint()
  }
  async function chooseDeviceType() {
    const deviceType = await withPrompt(() =>
      select(
        {
          message: 'Device type',
          default: config.data.deviceType,
          choices: DEVICE_TYPES.map((t) => ({ name: t, value: t })),
        },
        promptCtx,
      ),
    )
    if (deviceType && deviceType !== config.data.deviceType) {
      await manager.setDeviceInfo({ name: config.data.deviceName, deviceType })
      config.data.deviceType = deviceType
      await config.write()
    }
    repaint()
  }

  // --- project settings (edited inline from the projects drill-down) -------
  /** @param {'name' | 'projectDescription'} key @param {string} message */
  async function editProjectSetting(key, message) {
    const ps = state.projectSettings
    if (!ps) return
    const current = ps.settings[key] ?? ''
    const value = await withPrompt(() =>
      input({ message, default: current }, promptCtx),
    )
    // Skip the write (and the resulting sync churn) when nothing changed.
    if (value != null && value !== current) {
      const project = await manager.getProject(ps.projectId)
      await project.$setProjectSettings({ [key]: value })
      ps.settings = await project.$getProjectSettings()
      if (key === 'name') {
        if (state.projectId === ps.projectId) state.projectName = value
        if (state.list) state.list.title = value // keep the drill-down header fresh
      }
    }
    repaint()
  }

  /**
   * Open the sync screen in the stopped state (no connection, no data sync).
   * @param {string} projectId @param {string} [projectName]
   */
  async function enterSync(projectId, projectName) {
    const project = await manager.getProject(projectId)
    state.sync = runSync(manager, project)
    state.syncUnsub = state.sync.subscribe(scheduleRepaint)
    state.syncing = false
    state.projectId = projectId
    if (projectName) state.projectName = projectName
    state.screen = 'sync'
    repaint()
  }

  // Throughput sampler: once a second, derive blocks/s from the model's
  // completed-block total and keep a sparkline window. Runs only while syncing.
  const rate = {
    value: /** @type {number | undefined} */ (undefined),
    spark: '',
  }
  /** @type {NodeJS.Timeout | undefined} */
  let rateTimer
  /** @type {number[]} */
  let rateSamples = []
  let lastCompleted = 0
  function completedBlocks() {
    let total = 0
    for (const r of state.sync?.model.list() ?? []) {
      total +=
        r.initial.peakWanted -
        r.initial.wanted +
        (r.data.peakWanted - r.data.wanted)
    }
    return total
  }
  function startRateSampler() {
    stopRateSampler()
    lastCompleted = completedBlocks()
    rateSamples = []
    rate.value = 0
    rate.spark = ''
    rateTimer = setInterval(() => {
      if (!state.sync) return
      // Once caught up, stop sampling — no point repainting a flat zero each second.
      if (state.sync.model.isAllSynced()) {
        stopRateSampler()
        if (state.screen === 'sync') repaint()
        return
      }
      const c = completedBlocks()
      const delta = Math.max(0, c - lastCompleted)
      lastCompleted = c
      rateSamples.push(delta)
      if (rateSamples.length > 14) rateSamples.shift()
      rate.value = delta
      rate.spark = sparkline(rateSamples)
      if (state.screen === 'sync') repaint()
    }, 1000)
    rateTimer.unref?.()
  }
  function stopRateSampler() {
    if (rateTimer) clearInterval(rateTimer)
    rateTimer = undefined
    rate.value = undefined
    rate.spark = ''
  }

  /**
   * Toggle DATA-namespace sync (observations + media). Initial/presync runs on
   * its own whenever a peer is connected; connections are managed on the Network
   * screen, so this no longer touches discovery.
   */
  function toggleSync() {
    if (!state.sync) return
    if (state.syncing) {
      state.sync.stop()
      state.syncing = false
      stopRateSampler()
    } else {
      state.syncing = true
      startRateSampler()
      state.sync.start()
    }
    repaint()
  }

  function leaveSync() {
    stopRateSampler()
    state.syncUnsub?.()
    state.sync?.stop()
    state.sync?.dispose()
    state.sync = undefined
    state.syncUnsub = undefined
    state.syncing = false
    state.screen = 'menu'
    repaint()
  }

  async function startSync() {
    if (!state.projectId) {
      await showProjects((id) => enterSync(id))
      return
    }
    await enterSync(state.projectId, state.projectName)
  }

  // Members: read-only list of who can access the project + their role.
  async function showMembers() {
    if (!state.projectId) {
      await showProjects(() => void showMembers())
      return
    }
    const project = /** @type {any} */ (
      await manager.getProject(state.projectId)
    )
    const members = await project.$member.getMany()
    showList({
      title: 'Members',
      subtitle: state.projectName,
      header: 'DEVICE'.padEnd(20) + 'ID'.padEnd(8) + 'ROLE',
      items: members,
      render: (/** @type {any} */ m) =>
        (m.name ?? '(unknown)').padEnd(20) +
        chalk.gray(shortId(m.deviceId).padEnd(8)) +
        chalk.dim(m.role?.name ?? '') +
        (m.deviceId === manager.deviceId ? chalk.dim('  (you) ↵ edit') : ''),
      // Other members are read-only; opening your own device edits its settings.
      onSelect: (/** @type {any} */ m) => {
        if (m.deviceId === manager.deviceId)
          showDevice(() => void showMembers())
      },
      onBack: backToMenu,
    })
  }

  // Read-only data browse: datatype list → record list → raw record (all arrow-nav).
  const DATA_TYPES = ['observation', 'track', 'preset', 'field']
  /** @param {string} type */
  const plural = (type) => `${type}s`
  async function browseData() {
    if (!state.projectId) {
      await showProjects(() => void browseData())
      return
    }
    const project = /** @type {any} */ (
      await manager.getProject(state.projectId)
    )
    const groups = []
    for (const type of DATA_TYPES) {
      const dt = project[type]
      if (dt && typeof dt.getMany === 'function') {
        groups.push({ kind: 'group', type, items: await dt.getMany() })
      }
    }
    const actions = [
      { separator: true },
      { kind: 'action', label: 'Generate mock data…', run: generateMockData },
      { kind: 'action', label: 'Export data…', run: exportProject },
    ]
    showList({
      title: 'Data',
      subtitle: state.projectName,
      header: 'TYPE'.padEnd(18) + 'COUNT',
      items: [...groups, ...actions],
      render: (it) =>
        it.kind === 'action'
          ? chalk.cyan(it.label)
          : plural(it.type).padEnd(18) +
            chalk.bold(String(it.items.length).padStart(5)),
      onSelect: (it) => {
        if (it.kind === 'action') return void it.run()
        if (it.items.length > 0) showRecordList(it)
      },
      onBack: backToMenu,
    })
  }
  /** Resolve a center for mock data: geo-IP, else prompt for lat/lon. */
  async function pickCenter() {
    state.screen = 'message'
    state.messageBack = undefined
    state.message = { title: 'Mock data', body: 'Resolving a center location…' }
    repaint()
    const center = await resolveCenter({ geoip: true })
    if (center) return center
    const lat = await withPrompt(() =>
      number(
        { message: 'Center latitude (geo-IP failed)', default: 0 },
        promptCtx,
      ),
    )
    if (lat == null) return null
    const lon = await withPrompt(() =>
      number({ message: 'Center longitude', default: 0 }, promptCtx),
    )
    if (lon == null) return null
    return { lat, lon, source: 'provided' }
  }
  /** Generate synthetic observations/tracks into the current project (demo/testing). */
  async function generateMockData() {
    if (!state.projectId) return
    const observations = await withPrompt(() =>
      number(
        { message: 'How many observations?', default: 25, min: 0 },
        promptCtx,
      ),
    )
    if (observations == null) return void browseData()
    const tracks = await withPrompt(() =>
      number({ message: 'How many tracks?', default: 3, min: 0 }, promptCtx),
    )
    if (tracks == null) return void browseData()
    const center = await pickCenter()
    if (!center) return void browseData()
    state.screen = 'message'
    state.messageBack = () => void browseData()
    state.message = {
      title: 'Mock data',
      body: `Generating ${observations} observations and ${tracks} tracks near ${center.lat.toFixed(4)}, ${center.lon.toFixed(4)} (${center.source})…`,
    }
    repaint()
    try {
      const project = await manager.getProject(state.projectId)
      const result = await generateFixtures(project, {
        center,
        observations,
        tracks,
      })
      state.message = {
        title: 'Mock data',
        body: `Created ${result.observations.length} observations and ${result.tracks.length} tracks.`,
      }
    } catch (err) {
      state.message = { title: 'Mock data failed', body: describeError(err) }
    }
    repaint()
  }
  /** Export the current project to a folder as GeoJSON or a zip (incl. media). */
  async function exportProject() {
    if (!state.projectId) return
    const out = await withPrompt(() =>
      input(
        { message: 'Export to folder', default: './comapeo-export' },
        promptCtx,
      ),
    )
    if (!out) return void browseData()
    const format = await withPrompt(() =>
      select(
        {
          message: 'Export format',
          choices: [
            { name: 'GeoJSON', value: 'geojson' },
            { name: 'Zip (includes media)', value: 'zip' },
          ],
        },
        promptCtx,
      ),
    )
    if (!format) return void browseData()
    state.screen = 'message'
    state.messageBack = () => void browseData()
    state.message = { title: 'Export', body: `Exporting ${format}…` }
    repaint()
    try {
      // Core writes straight into the folder with createWriteStream, so it must
      // already exist — otherwise it fails with an opaque "Unable to export…".
      await fs.mkdir(out, { recursive: true })
      const project = /** @type {any} */ (
        await manager.getProject(state.projectId)
      )
      const path =
        format === 'zip'
          ? await project.exportZipFile(out, {})
          : await project.exportGeoJSONFile(out, {})
      const note = manager.getIsArchiveDevice()
        ? ''
        : '\n  Note: not an archive device — some original media may be missing.'
      state.message = {
        title: 'Export',
        body: `Wrote ${format} to\n  ${path}${note}`,
      }
    } catch (err) {
      state.message = { title: 'Export failed', body: describeError(err) }
    }
    repaint()
  }
  /** @param {{ type: string, items: any[] }} group */
  function showRecordList(group) {
    showList({
      title: `Data ▸ ${plural(group.type)}`,
      subtitle: `${group.items.length} records · read-only`,
      header: 'ID'.padEnd(9) + 'CREATED'.padEnd(15) + 'SUMMARY',
      items: group.items,
      render: (d) =>
        chalk.cyan(shortId(d.docId).padEnd(9)) +
        chalk.dim(
          (d.createdAt ? String(d.createdAt).slice(0, 10) : '').padEnd(15),
        ) +
        recordSummary(d),
      onSelect: (d) => {
        state.record = d
        state.recordBack = () => showRecordList(group)
        state.screen = 'record'
        repaint()
      },
      onBack: () => void browseData(),
    })
  }

  // Invite a nearby non-member device (from the sync screen [i]).
  async function inviteDevice() {
    if (!state.projectId) return
    const project = /** @type {any} */ (
      await manager.getProject(state.projectId)
    )
    const members = new Set(
      (await project.$member.getMany()).map(
        (/** @type {any} */ m) => m.deviceId,
      ),
    )
    const candidates = state.peers.filter(
      (p) => p.status === 'connected' && !members.has(p.deviceId),
    )
    showList({
      title: 'Invite a device',
      subtitle: state.projectName,
      header: 'nearby devices not yet in this project',
      items: candidates,
      render: (p) =>
        (p.name ?? shortId(p.deviceId)).padEnd(18) +
        chalk.gray(shortId(p.deviceId)) +
        chalk.dim(`  ${p.deviceType ?? ''}`),
      onSelect: (p) => pickRole(project, p),
      onBack: () => {
        state.screen = 'sync'
        repaint()
      },
    })
  }
  /** @param {any} project @param {import('@comapeo/core').PublicPeerInfo} peer */
  function pickRole(project, peer) {
    const ROLES = [
      { name: 'member', id: roles.MEMBER_ROLE_ID },
      { name: 'coordinator', id: roles.COORDINATOR_ROLE_ID },
    ]
    showList({
      title: `Invite ${peer.name ?? shortId(peer.deviceId)}`,
      subtitle: 'choose a role',
      items: ROLES,
      render: (r) => r.name,
      onSelect: (r) => void sendInvite(project, peer, r),
      onBack: () => void inviteDevice(),
    })
  }
  /** @param {any} project @param {import('@comapeo/core').PublicPeerInfo} peer @param {{ name: string, id: any }} role */
  async function sendInvite(project, peer, role) {
    const label = peer.name ?? shortId(peer.deviceId)
    state.screen = 'message'
    state.messageBack = undefined
    state.message = {
      title: 'Invite',
      body: `Inviting ${label} as ${role.name}…`,
    }
    repaint()
    let result
    try {
      result = String(
        await project.$member.invite(peer.deviceId, { roleId: role.id }),
      ).toLowerCase()
    } catch (err) {
      result = `failed: ${err instanceof Error ? err.message : String(err)}`
    }
    state.message = { title: 'Invite', body: `${label}: ${result}` }
    repaint()
  }

  // --- join: a live list of pending invites -------------------------------
  /** Refresh pending invites (resolving the invitor's name). */
  async function refreshInvites() {
    const peers = await manager.listLocalPeers()
    const nameOf = (/** @type {string} */ deviceId) =>
      peers.find((p) => p.deviceId === deviceId)?.name
    state.invites = manager.invite
      .getMany()
      .filter((/** @type {any} */ i) => i.state === 'pending')
      .map((/** @type {any} */ i) => ({
        ...i,
        from: nameOf(i.invitorDeviceId) ?? 'a device',
      }))
    state.inviteIndex = Math.min(
      state.inviteIndex,
      Math.max(0, state.invites.length - 1),
    )
    if (state.screen === 'join' || state.screen === 'menu') scheduleRepaint()
  }
  /** Invites arrive over connections opened on the Network screen, not here. */
  async function enterJoin() {
    state.screen = 'join'
    state.inviteIndex = 0
    repaint()
    await refreshInvites()
  }
  function leaveJoin() {
    state.screen = 'menu'
    repaint()
  }
  /** @param {any} invite */
  async function acceptInvite(invite) {
    state.screen = 'message'
    state.messageBack = undefined
    state.message = { title: 'Join', body: `Joining "${invite.projectName}"…` }
    repaint()
    try {
      const projectId = await manager.invite.accept({
        inviteId: invite.inviteId,
      })
      config.data.lastProjectId = projectId
      await config.write()
      await enterSync(projectId, invite.projectName)
    } catch (err) {
      state.message = {
        title: 'Join failed',
        body: `Could not join "${invite.projectName}": ${err instanceof Error ? err.message : String(err)}`,
      }
      repaint()
    }
  }
  /** @param {any} invite */
  async function rejectInvite(invite) {
    manager.invite.reject({ inviteId: invite.inviteId })
    await refreshInvites()
  }

  async function quit() {
    leaveSync()
    if (repaintTimer) clearTimeout(repaintTimer)
    manager.off('local-peers', onPeers)
    manager.invite.off('invite-received', onInvite)
    manager.invite.off('invite-updated', onInvite)
    unsubDevices()
    keys.stop()
    logUpdate.done()
    stdout.write(SHOW_CURSOR)
    await session.close() // also stops discovery
    resolveExit()
  }

  // --- live events ---------------------------------------------------------
  /** @param {import('@comapeo/core').PublicPeerInfo[]} peers */
  const onPeers = (peers) => {
    state.peers = peers
    if (state.screen !== 'sync') scheduleRepaint()
  }
  const onInvite = () => void refreshInvites()
  const onDevices = () => {
    state.devices = session.listDevices()
    if (state.screen === 'devices' || state.screen === 'menu') scheduleRepaint()
  }
  manager.on('local-peers', onPeers)
  manager.invite.on('invite-received', onInvite)
  manager.invite.on('invite-updated', onInvite)
  const unsubDevices = session.onDevicesChanged(onDevices)
  manager.listLocalPeers().then(onPeers)

  // Discovery (mDNS browser + local server) runs app-wide so devices and invites
  // surface on any screen; peers are dialed manually from the Network screen.
  await session.startDiscovery()
  state.devices = session.listDevices()

  // Home menu — drives both arrow-nav (visible selection) and letter hotkeys.
  const openDevices = () => {
    state.devices = session.listDevices()
    state.deviceIndex = 0
    state.screen = 'devices'
    repaint()
  }
  /** @type {Array<{ key: string, label: string | (() => string), run: () => void }>} */
  const MENU = [
    {
      key: 'j',
      label: () =>
        state.invites.length
          ? `Join a project ${chalk.yellow(`(${state.invites.length} pending invite${state.invites.length === 1 ? '' : 's'})`)}`
          : 'Join a project (accept an invite)',
      run: () => void enterJoin(),
    },
    {
      key: 'n',
      label: () => {
        const connected = state.peers.filter(
          (p) => p.status === 'connected',
        ).length
        return `Network — connect to nearby devices${connected ? chalk.dim(` (${connected} connected)`) : ''}`
      },
      run: openDevices,
    },
    {
      key: 's',
      label: () => `Sync${state.projectName ? ` "${state.projectName}"` : ''}`,
      run: () => void startSync(),
    },
    {
      key: 'd',
      label: 'Data — browse records · mock data · export',
      run: () => void browseData(),
    },
    {
      key: 'm',
      label: 'Members — who can access this project',
      run: () => void showMembers(),
    },
    {
      key: 'p',
      label: 'Projects — switch · settings · create',
      run: () => void showProjects(backToMenu, { manage: true }),
    },
    {
      key: 'e',
      label: 'Device — name · type · archive',
      run: () => showDevice(),
    },
    { key: 'q', label: 'Quit', run: () => void quit() },
  ]

  // --- key handling --------------------------------------------------------
  /**
   * @param {string | undefined} _str
   * @param {{ name?: string, ctrl?: boolean }} key
   */
  function onKey(_str, key) {
    if (state.busy) return
    if (key.ctrl && key.name === 'c') return void quit()
    const name = key.name

    if (state.screen === 'menu') {
      if (name === 'up') {
        state.menuIndex = Math.max(0, state.menuIndex - 1)
        repaint()
      } else if (name === 'down') {
        state.menuIndex = Math.min(MENU.length - 1, state.menuIndex + 1)
        repaint()
      } else if (name === 'return' || name === 'enter') {
        MENU[state.menuIndex].run()
      } else {
        const item = MENU.find((m) => m.key === name)
        if (item) item.run()
      }
    } else if (state.screen === 'list' && state.list) {
      const list = state.list
      // Step over non-selectable separator rows when navigating.
      const step = (/** @type {number} */ from, /** @type {number} */ dir) => {
        let i = from
        do {
          i = Math.max(0, Math.min(list.items.length - 1, i + dir))
        } while (list.items[i]?.separator && i > 0 && i < list.items.length - 1)
        return list.items[i]?.separator ? from : i
      }
      if (name === 'up') {
        list.index = step(list.index, -1)
        repaint()
      } else if (name === 'down') {
        list.index = step(list.index, 1)
        repaint()
      } else if (name === 'return' || name === 'enter') {
        const item = list.items[list.index]
        if (item && !item.separator) void list.onSelect(item)
      } else if (name === 'escape') {
        void list.onBack()
      } else if (name && list.extra?.[name])
        void list.extra[name](list.items[list.index])
    } else if (state.screen === 'record') {
      if (name === 'escape') {
        state.record = undefined
        const back = state.recordBack
        state.recordBack = undefined
        if (back) back()
        else backToMenu()
      }
    } else if (state.screen === 'peerDetail') {
      if (name === 'r') {
        state.raw = !state.raw
        repaint()
      } else if (name === 'escape') {
        state.peerDetail = undefined
        state.screen = 'sync'
        repaint()
      }
    } else if (state.screen === 'message') {
      if (name === 'escape') {
        const back = state.messageBack
        state.message = undefined
        state.messageBack = undefined
        if (back) back()
        else {
          state.screen = state.sync ? 'sync' : 'menu'
          repaint()
        }
      }
    } else if (state.screen === 'devices') {
      const rows = networkRows()
      if (name === 'up') {
        state.deviceIndex = Math.max(0, state.deviceIndex - 1)
        repaint()
      } else if (name === 'down') {
        state.deviceIndex = Math.min(
          Math.max(0, rows.length - 1),
          state.deviceIndex + 1,
        )
        repaint()
      } else if (name === 'return' || name === 'enter') {
        const row = rows[state.deviceIndex]
        if (row?.kind === 'device') session.connectDevice(row.device.name)
      } else if (name === 'c') {
        session.connectAllDevices()
      } else if (name === 'x') {
        void session.disconnectAll()
      } else if (name === 'escape') {
        backToMenu()
      }
    } else if (state.screen === 'join') {
      const invites = state.invites
      if (name === 'up') {
        state.inviteIndex = Math.max(0, state.inviteIndex - 1)
        repaint()
      } else if (name === 'down') {
        state.inviteIndex = Math.min(invites.length - 1, state.inviteIndex + 1)
        repaint()
      } else if (
        (name === 'return' || name === 'enter') &&
        invites[state.inviteIndex]
      ) {
        void acceptInvite(invites[state.inviteIndex])
      } else if (name === 'x' && invites[state.inviteIndex]) {
        void rejectInvite(invites[state.inviteIndex])
      } else if (name === 'escape') void leaveJoin()
    } else if (state.screen === 'sync') {
      if (name === 's') toggleSync()
      else if (name === 'r') {
        state.raw = !state.raw
        repaint()
      } else if (
        name === 'i' &&
        state.peers.some((p) => p.status === 'connected')
      )
        void inviteDevice()
      else if (name === 'up') {
        state.peerIndex = Math.max(0, state.peerIndex - 1)
        repaint()
      } else if (name === 'down') {
        const n = state.sync ? state.sync.model.list().length : 0
        state.peerIndex = Math.min(Math.max(0, n - 1), state.peerIndex + 1)
        repaint()
      } else if (name === 'return' || name === 'enter') {
        const rows = state.sync ? state.sync.model.list() : []
        const row = rows[state.peerIndex]
        if (row) {
          state.peerDetail = row
          state.screen = 'peerDetail'
          repaint()
        }
      } else if (name === 'escape') void leaveSync()
    }
  }

  // Clear the screen (and any first-run prompt / shell output) so the TUI opens
  // at the top of a fresh, full terminal window.
  stdout.write(CLEAR_SCREEN)
  stdout.write(HIDE_CURSOR)
  const keys = createKeyReader(onKey, stdin)
  repaint()

  await exited
}
