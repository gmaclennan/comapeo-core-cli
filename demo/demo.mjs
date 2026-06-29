/**
 * Self-playing demo of the CoMapeo CLI TUI. Spins up a second ("coordinator")
 * device in-process, seeds it with 500 observations + 30 tracks, then drives the
 * real TUI — rendering to your actual terminal — through join → sync (with
 * visible progress) → browse → members → quit, navigating with the arrow keys so
 * the highlighted section is always clear. Run it while screen-recording.
 *
 *   npm run demo
 *
 * No network/mDNS: the two devices are connected over loopback in one process.
 */
import { roles } from '@comapeo/core'

import net from 'node:net'
import { Transform } from 'node:stream'

import { generateFixtures, resolveCenter } from '../src/core/fixtures.js'
import { startTui } from '../src/tui/app.js'
import { makeManager, noopDiscovery, waitForConnected } from '../test/helpers/managers.js'
import { KEY, makeFakeStdin } from '../test/helpers/tui-io.js'

const THROTTLE_BPS = Number(process.env.THROTTLE_BPS ?? 14_000) // cap the peer link so sync progress is watchable (~10s climb)

/**
 * A token-bucket bandwidth limiter whose rate is read live from `rate.bps`
 * (Infinity = pass-through). Burst is capped at one second of credit, but a
 * chunk is sent whenever any credit is available and the cost is taken as debt
 * (tokens may go negative) — so a chunk larger than `bps` still drains instead
 * of deadlocking. Setting `rate.bps` later engages the limit, which lets the
 * demo keep join/presync fast and throttle only the data sync.
 * @param {{ bps: number }} rate
 */
function throttle(rate) {
  let tokens = 0
  let last = Date.now()
  return new Transform({
    transform(chunk, _enc, cb) {
      const bps = rate.bps
      if (!Number.isFinite(bps)) {
        last = Date.now() // don't let idle time accrue into a burst when throttling engages
        return cb(null, chunk)
      }
      const step = () => {
        const now = Date.now()
        tokens = Math.min(bps, tokens + ((now - last) / 1000) * bps)
        last = now
        if (tokens > 0) {
          tokens -= chunk.length // debt is fine; it just delays the next chunk
          cb(null, chunk)
        } else {
          setTimeout(step, ((-tokens + 1) / bps) * 1000)
        }
      }
      step()
    },
  })
}

/**
 * Connect the joiner to the coordinator through a loopback proxy whose bandwidth
 * can be limited on demand. Returns the live `rate` handle (starts unthrottled);
 * set `rate.bps` to engage the limit. Noise/replication are end-to-end.
 *
 * @param {import('@comapeo/core').MapeoManager} coordinator
 * @param {import('@comapeo/core').MapeoManager} joiner
 * @param {Array<() => Promise<void>>} cleanups
 * @returns {Promise<{ bps: number }>}
 */
async function connectThrottled(coordinator, joiner, cleanups) {
  const rate = { bps: Infinity }
  const { name, port: coordPort } = await coordinator.startLocalPeerDiscoveryServer()
  await joiner.startLocalPeerDiscoveryServer() // core drops outbound dials if its server isn't listening
  const proxy = net.createServer((client) => {
    const upstream = net.connect(coordPort, '127.0.0.1')
    const close = () => {
      client.destroy()
      upstream.destroy()
    }
    client.on('error', close)
    upstream.on('error', close)
    client.pipe(throttle(rate)).pipe(upstream)
    upstream.pipe(throttle(rate)).pipe(client)
  })
  await new Promise((res) => proxy.listen(0, '127.0.0.1', () => res(undefined)))
  const proxyPort = /** @type {import('node:net').AddressInfo} */ (proxy.address()).port
  joiner.connectLocalPeer({ address: '127.0.0.1', name, port: proxyPort })
  cleanups.push(async () => {
    proxy.close()
    await Promise.all([
      coordinator.stopLocalPeerDiscoveryServer({ force: true }),
      joiner.stopLocalPeerDiscoveryServer({ force: true }),
    ])
  })
  return rate
}

const SPEED = 1 // playback pace for the scripted navigation (sync speed is set by THROTTLE_BPS)
/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * SPEED))
/** @param {() => unknown | Promise<unknown>} fn */
async function waitUntil(fn, { timeout = 60_000, interval = 150 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await fn()) return true
    await sleep(interval / SPEED)
  }
  return false
}

process.env.FORCE_COLOR ||= '3'
const out = (/** @type {string} */ s) => process.stdout.write(s)

/** @type {Array<() => Promise<void>>} */
const cleanups = []

async function main() {
  const coordinator = await makeManager('basecamp-srv', cleanups)
  const cli = await makeManager('my-laptop', cleanups)

  const projectId = await coordinator.manager.createProject({ name: 'Río Bravo Survey' })
  const coordProject = await coordinator.manager.getProject(projectId)
  const center = (await resolveCenter({ geoip: true })) ?? { lat: -3.1, lon: -60.02, source: 'demo' }

  // Seed in batches so there's visible progress during setup.
  out('CoMapeo CLI — demo\n')
  const TOTAL_OBS = 500
  for (let done = 0; done < TOTAL_OBS; done += 100) {
    await generateFixtures(coordProject, { center, observations: 100, tracks: 0, radius: 3 })
    out(`  seeding observations… ${done + 100}/${TOTAL_OBS}\n`)
  }
  await generateFixtures(coordProject, { center, observations: 0, tracks: 30, radius: 3 })
  out('  seeding tracks… 30/30\n  connecting devices…\n')

  const link = await connectThrottled(coordinator.manager, cli.manager, cleanups)
  await waitForConnected([coordinator.manager, cli.manager])

  // Launch the CLI's TUI: real stdout, scripted stdin, the cli device's session.
  out('\x1b[2J\x1b[3J\x1b[H') // clear so the TUI starts at the top
  const stdin = makeFakeStdin()
  const ui = startTui({
    io: { stdin, stdout: process.stdout },
    session: {
      manager: cli.manager,
      config: cli.config,
      // The demo wires the connection via the loopback proxy, so discovery is inert.
      ...noopDiscovery,
      close: async () => {},
    },
  })
  const type = (/** @type {string} */ k) => stdin.write(k)
  /** @param {string} key @param {number} [times] @param {number} [gap] */
  const press = async (key, times = 1, gap = 420) => {
    for (let i = 0; i < times; i++) {
      type(key)
      await sleep(gap)
    }
  }

  // --- the scripted walkthrough -------------------------------------------
  await sleep(2200) // home menu (Join highlighted)

  // Network screen: the coordinator is already connected (the demo wired the
  // link out-of-band), so it shows under "connected". Connections are managed
  // here now, independent of the sync screen.
  await press(KEY.down, 1) // Join → Network
  await sleep(700)
  type(KEY.enter) // open Network
  await sleep(2800)
  type(KEY.escape) // back to home menu
  await sleep(900)
  await press(KEY.up, 1) // Network → Join
  await sleep(700)
  type(KEY.enter) // open Join → "Waiting for an invite…"
  await sleep(2200)

  // Coordinator invites this device; the invite appears in the join list.
  coordProject.$member
    .invite(cli.manager.deviceId, { roleId: roles.MEMBER_ROLE_ID, roleName: 'Member' })
    .catch(() => {})
  await waitUntil(() => cli.manager.invite.getMany().some((i) => i.state === 'pending'))
  await sleep(2600) // the invite (project · role · from) is listed
  type(KEY.enter) // accept the selected invite → "Joining…" then the sync screen

  // Wait until we've actually joined (and the sync screen is up) before [s],
  // otherwise the keystroke lands on the transient "Joining…" screen.
  await waitUntil(() =>
    cli.manager.listProjects().then((ps) => ps.some((p) => p.projectId === projectId)),
  )
  await sleep(2000)

  // Sync screen (stopped) → start, then watch progress climb on the dashboard.
  // Engage the bandwidth limit now so the data sync (not the join) is what's paced.
  link.bps = THROTTLE_BPS
  type('s') // start sync
  coordProject.$sync.start()

  const cliProject = await cli.manager.getProject(projectId)
  await waitUntil(async () => (await cliProject.observation.getMany()).length >= TOTAL_OBS)
  await sleep(2600) // "caught up"

  // Now open a device to see its per-namespace detail, then come back.
  type(KEY.enter) // open the selected peer (basecamp-srv)
  await sleep(2600)
  type('r') // raw block counts
  await sleep(2200)
  type(KEY.escape) // back to the dashboard
  await sleep(1600)
  type(KEY.escape) // back to home menu

  // Browse the synced data, read-only — navigate by arrows.
  await sleep(1500)
  await press(KEY.down, 3) // Join → Network → Sync → Data
  await sleep(700)
  type(KEY.enter) // open Data
  await sleep(2000)
  type(KEY.enter) // observations
  await sleep(1800)
  await press(KEY.down, 6) // scroll the record list (windowed)
  await sleep(900)
  type(KEY.enter) // open a record
  await sleep(3000)
  type(KEY.escape) // → record list
  await sleep(900)
  type(KEY.escape) // → datatypes
  await sleep(700)
  type(KEY.escape) // → home menu

  // Members.
  await sleep(1300)
  await press(KEY.down, 1) // Data → Members
  await sleep(700)
  type(KEY.enter)
  await sleep(2800)
  type(KEY.escape) // → home menu

  // Quit.
  await sleep(1300)
  await press(KEY.down, 3) // Members → Projects → Device → Quit
  await sleep(900)
  type(KEY.enter)
  await ui
}

main()
  .catch((err) => {
    process.stderr.write(`\ndemo error: ${err?.stack || err}\n`)
    process.exitCode = 1
  })
  .finally(async () => {
    for (const fn of cleanups.reverse()) await fn().catch(() => {})
    process.stdout.write('\n✔ demo complete\n')
    process.exit(process.exitCode ?? 0) // core keeps handles open; force a clean exit so `npm run demo` returns
  })
