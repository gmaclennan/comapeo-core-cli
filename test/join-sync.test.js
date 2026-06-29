import { roles } from '@comapeo/core'

import assert from 'node:assert/strict'
import { after, test } from 'node:test'

import { waitForInvite } from '../src/core/invites.js'
import { runSync } from '../src/core/sync-runner.js'
import {
  connectPeers,
  makeManager,
  waitForConnected,
} from './helpers/managers.js'

/**
 * End-to-end exercise of the headline flow without a real second device: two
 * managers in one process, connected directly (no mDNS), one invites the other,
 * then they sync. Validates the core helpers the CLI commands wrap.
 */

/** @type {Array<() => Promise<void>>} */
const cleanups = []
after(async () => {
  for (const fn of cleanups.reverse()) await fn()
})

test(
  'coordinator invites a device, which joins and syncs data',
  { timeout: 60_000 },
  async () => {
    const { manager: coordinator } = await makeManager('coordinator', cleanups)
    const { manager: joiner } = await makeManager('joiner', cleanups)

    const projectId = await coordinator.createProject({ name: 'Field Survey' })
    const coordProject = await coordinator.getProject(projectId)

    // Seed data so the `data` namespace has something to replicate.
    const OBS_COUNT = 5
    for (let i = 0; i < OBS_COUNT; i++) {
      await coordProject.observation.create({
        schemaName: 'observation',
        lat: i,
        lon: i,
        tags: {},
        attachments: [],
        metadata: {},
      })
    }

    await connectPeers([coordinator, joiner], cleanups)
    await waitForConnected([coordinator, joiner])

    // Invite (resolves on the invitee's response) and accept concurrently.
    const [, joinedProjectId] = await Promise.all([
      coordProject.$member.invite(joiner.deviceId, {
        roleId: roles.MEMBER_ROLE_ID,
      }),
      (async () => {
        const invite = await waitForInvite(joiner, { timeout: 30_000 })
        assert.equal(invite.projectName, 'Field Survey')
        return joiner.invite.accept({ inviteId: invite.inviteId })
      })(),
    ])

    assert.equal(
      joinedProjectId,
      projectId,
      'joiner ends up in the same project',
    )

    // Sync data both ways and wait for the joiner to catch up.
    const joinerProject = await joiner.getProject(projectId)
    const coordRunner = runSync(coordinator, coordProject)
    const joinerRunner = runSync(joiner, joinerProject)
    coordRunner.start()
    joinerRunner.start()

    await Promise.all([
      coordRunner.waitForSync('full', 30_000),
      joinerRunner.waitForSync('full', 30_000),
    ])

    const synced = await joinerProject.observation.getMany()
    assert.equal(
      synced.length,
      OBS_COUNT,
      'all observations replicated to the joiner',
    )

    // The sync model the dashboard/NDJSON consume reports the peer caught up.
    assert.equal(joinerRunner.model.isAllSynced(), true)
    const coordRow = joinerRunner.model
      .list()
      .find((r) => r.deviceId === coordinator.deviceId)
    assert.ok(coordRow, 'coordinator appears as a peer row')
    assert.equal(coordRow.synced, true)
    assert.equal(coordRow.data.progress, 1)

    coordRunner.dispose()
    joinerRunner.dispose()
  },
)
