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
 * Drive the Network screen with an injected session whose device list and
 * connection controls are controllable, so connect / connect-all / disconnect-all
 * are exercised deterministically without real mDNS.
 */

/** @type {Array<() => Promise<void>>} */
const cleanups = []
after(async () => {
  for (const fn of cleanups.reverse()) await fn()
})

test(
  'Network screen connects a discovered device and disconnects all',
  { timeout: 30_000 },
  async () => {
    const { manager, config } = await makeManager('solo', cleanups)

    /** @type {import('../src/core/session.js').DiscoveredDevice[]} */
    let devices = []
    /** @type {(() => void) | undefined} */
    let notify
    const calls = {
      connect: /** @type {string[]} */ ([]),
      connectAll: 0,
      disconnectAll: 0,
    }

    const stdin = makeFakeStdin()
    const cap = makeCaptureStdout()
    const ui = startTui({
      io: { stdin, stdout: cap.stdout },
      session: {
        manager,
        config,
        ...noopDiscovery,
        listDevices: () => devices,
        connectDevice: (name) => void calls.connect.push(name),
        connectAllDevices: () => void calls.connectAll++,
        disconnectAll: async () => void calls.disconnectAll++,
        onDevicesChanged: (cb) => {
          notify = cb
          return () => (notify = undefined)
        },
        close: async () => {},
      },
    })

    await waitFor(() => cap.output().includes('CoMapeo'), { label: 'menu' })
    stdin.write('n') // open the Network screen
    await waitFor(() => cap.output().includes('No devices nearby yet'), {
      label: 'empty network',
    })

    // A device appears on the LAN.
    devices = [
      { name: 'a1b2c3d4', address: '192.168.1.5', port: 4321, dialed: false },
    ]
    notify?.()
    await waitFor(
      () =>
        cap.output().includes('AVAILABLE') &&
        cap.output().includes('192.168.1.5'),
      {
        label: 'device listed as available',
      },
    )

    stdin.write(KEY.enter) // connect the selected (only) available device
    await waitFor(() => calls.connect.length === 1, {
      label: 'connectDevice called',
    })
    assert.equal(
      calls.connect[0],
      'a1b2c3d4',
      'connects the discovered device by its mDNS name',
    )

    stdin.write('c') // connect all
    await waitFor(() => calls.connectAll === 1, { label: 'connectAll called' })

    stdin.write('x') // disconnect all
    await waitFor(() => calls.disconnectAll === 1, {
      label: 'disconnectAll called',
    })

    stdin.write(KEY.ctrlC) // quit
    await ui
  },
)
