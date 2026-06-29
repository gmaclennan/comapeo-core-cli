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
 * Coordinator's TUI invites a nearby non-member device via [i]; the invitee
 * auto-accepts; assert the invite succeeds and the device joins. Exercises the
 * invite picker → role list → send flow across two managers in one process.
 */

/** @type {Array<() => Promise<void>>} */
const cleanups = []
after(async () => {
  for (const fn of cleanups.reverse()) await fn()
})

test(
  'coordinator TUI invites a nearby device, which joins',
  { timeout: 60_000 },
  async () => {
    const coordinator = await makeManager('coordinator', cleanups)
    const invitee = await makeManager('invitee', cleanups)

    const projectId = await coordinator.manager.createProject({
      name: 'Field Survey',
    })
    coordinator.config.data.lastProjectId = projectId
    await coordinator.config.write()
    const coordProject = await coordinator.manager.getProject(projectId)

    // The invitee auto-accepts any invite it receives.
    invitee.manager.invite.on('invite-received', (inv) => {
      invitee.manager.invite.accept({ inviteId: inv.inviteId }).catch(() => {})
    })

    await connectPeers([coordinator.manager, invitee.manager], cleanups)
    await waitForConnected([coordinator.manager, invitee.manager])

    const stdin = makeFakeStdin()
    const cap = makeCaptureStdout()
    const ui = startTui({
      io: { stdin, stdout: cap.stdout },
      session: {
        manager: coordinator.manager,
        config: coordinator.config,
        ...noopDiscovery,
        close: async () => {},
      },
    })

    await waitFor(() => cap.output().includes('CoMapeo'), { label: 'menu' })
    stdin.write('s') // open the sync screen (data sync off)
    await waitFor(() => cap.output().includes('Data sync is off'), {
      label: 'sync stopped',
    })
    stdin.write('s') // start data sync — the dashboard (with [i] invite) appears
    await waitFor(() => cap.output().includes('i invite'), {
      label: 'sync running',
    })

    stdin.write('i') // invite a device
    await waitFor(
      () =>
        cap.output().includes('Invite a device') &&
        cap.output().includes('invitee'),
      {
        label: 'invite picker lists the non-member device',
      },
    )

    stdin.write(KEY.enter) // pick the invitee (first row)
    await waitFor(() => cap.output().includes('choose a role'), {
      label: 'role list',
    })

    stdin.write(KEY.enter) // pick "member" (first role)
    await waitFor(() => /invitee:\s*accept/.test(cap.output()), {
      label: 'invite accepted',
    })

    const joined = await invitee.manager.listProjects()
    assert.ok(
      joined.some((p) => p.projectId === projectId),
      'invitee joined the project',
    )

    // Quiesce presync before teardown.
    await coordProject.$sync.waitForSync('initial', { timeoutMs: 20_000 })

    stdin.write(KEY.ctrlC)
    await ui
  },
)
