import { roles } from '@comapeo/core'

import assert from 'node:assert/strict'
import { after, test } from 'node:test'

import { startTui } from '../src/tui/app.js'
import {
  connectPeers,
  makeManager,
  noopDiscovery,
  waitForConnected,
} from './helpers/managers.js'
import {
  KEY,
  makeCaptureStdout,
  makeFakeStdin,
  waitFor,
} from './helpers/tui-io.js'

/**
 * Two peers in one process: drive the joiner's TUI (injected IO) to the join
 * screen, have the coordinator invite over the loopback connection, and assert
 * the joiner's TUI reacts (invite prompt → accept → sync screen). Exercises the
 * controller + the multi-TUI seam, not just the pure renderers.
 */

/** @type {Array<() => Promise<void>>} */
const cleanups = []
after(async () => {
  for (const fn of cleanups.reverse()) await fn()
})

test(
  'joiner TUI reacts to a coordinator invite and reaches sync',
  { timeout: 60_000 },
  async () => {
    const coordinator = await makeManager('coordinator', cleanups)
    const joiner = await makeManager('joiner', cleanups)

    const projectId = await coordinator.manager.createProject({
      name: 'Field Survey',
    })
    const coordProject = await coordinator.manager.getProject(projectId)

    await connectPeers([coordinator.manager, joiner.manager], cleanups)
    await waitForConnected([coordinator.manager, joiner.manager])

    // The joiner's TUI, with injected IO and a pre-wired session (no mDNS, no
    // first-run prompt). close() is a no-op — the test owns the managers.
    const stdin = makeFakeStdin()
    const cap = makeCaptureStdout()
    const ui = startTui({
      io: { stdin, stdout: cap.stdout },
      session: {
        manager: joiner.manager,
        config: joiner.config,
        // Connection is handled by connectPeers; discovery controls are no-ops.
        ...noopDiscovery,
        close: async () => {},
      },
    })

    await waitFor(() => cap.output().includes('CoMapeo'), { label: 'menu' })
    stdin.write('j')
    await waitFor(() => cap.output().includes('Waiting for an invite'), {
      label: 'join screen',
    })

    // Coordinator invites over the established connection.
    const invitePromise = coordProject.$member.invite(joiner.manager.deviceId, {
      roleId: roles.MEMBER_ROLE_ID,
      roleName: 'Member',
    })

    // The invite appears in the joiner's pending-invite list.
    await waitFor(
      () =>
        cap.output().includes('Field Survey') &&
        cap.output().includes('Member'),
      {
        label: 'invite listed on joiner TUI',
      },
    )
    stdin.write(KEY.enter) // accept the selected invite

    await invitePromise
    await waitFor(() => cap.output().includes('CoMapeo Sync'), {
      label: 'sync screen after accept',
    })

    // The joiner is now in the project; the sync screen opens stopped.
    const joined = await joiner.manager.listProjects()
    assert.ok(
      joined.some((p) => p.projectId === projectId),
      'joiner joined the project',
    )
    assert.match(
      cap.output(),
      /Data sync is off/,
      'sync opens with data sync off by default',
    )

    // Start sync from the TUI ([s]), then let it quiesce before teardown so
    // force-disconnect doesn't interrupt an in-flight ack.
    stdin.write('s')
    coordProject.$sync.start()
    await coordProject.$sync.waitForSync('full', { timeoutMs: 20_000 })

    stdin.write(KEY.ctrlC) // quit
    await ui
  },
)
