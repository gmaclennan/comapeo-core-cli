import { openSession } from '../core/session.js'
import { runSync } from '../core/sync-runner.js'
import { CliError, info, printNdjson } from './output.js'
import { pickProjectId } from './resolve-project.js'

/**
 * Build a compact, machine-friendly snapshot of the current sync model.
 * @param {import('../core/sync-model.js').SyncModel} model
 */
function snapshot(model) {
  return {
    type: 'sync',
    allSynced: model.isAllSynced(),
    peers: model.list().map((r) => ({
      deviceId: r.deviceId,
      name: r.name,
      connection: r.connection,
      initial: Number(r.initial.progress.toFixed(3)),
      data: Number(r.data.progress.toFixed(3)),
      wanted: r.initial.wanted + r.data.wanted,
      want: r.initial.want + r.data.want,
      synced: r.synced,
    })),
  }
}

/**
 * @param {object} args
 * @param {string} args.storage
 * @param {string} [args.project] Project id or unique prefix
 * @param {boolean} [args.once] Converge once and exit
 * @param {boolean} [args.full] Sync data (not just initial/presync)
 * @param {boolean} [args.json] Emit NDJSON snapshots to stdout
 * @param {number} [args.timeout] Inactivity timeout in ms (default 60000)
 */
export async function sync({
  storage,
  project,
  once,
  full,
  json,
  timeout = 60_000,
}) {
  const session = await openSession({ storage, discovery: true })
  const { manager, config } = session
  /** @type {ReturnType<typeof runSync> | undefined} */
  let runner
  try {
    const projectId = await pickProjectId(manager, { project, json })

    const projectInstance = await manager.getProject(projectId)
    runner = runSync(manager, projectInstance)
    if (full) runner.start()

    const type = full ? 'full' : 'initial'
    if (!json) info(`Syncing ${type === 'full' ? 'all data' : 'initial data'}…`)

    const emit = () => {
      if (json && runner) printNdjson(snapshot(runner.model))
    }
    // `--once` converges quietly and prints only the final summary; the default
    // (streaming) mode emits a snapshot on every sync-state tick.
    const unsubscribe = once ? () => {} : runner.subscribe(emit)
    if (!once) emit()

    try {
      await runner.waitForSync(type, timeout)
    } catch (e) {
      throw new CliError(
        `Sync did not complete: ${e instanceof Error ? e.message : String(e)}`,
        1,
      )
    } finally {
      unsubscribe()
    }

    const final = snapshot(runner.model)
    if (json) {
      printNdjson({ type: 'sync-complete', peers: final.peers.length })
    } else {
      info(`Caught up with ${final.peers.length} peer(s).`)
      if (!manager.getIsArchiveDevice()) {
        info(
          'Note: this device does not archive media; some attachments may be missing.',
        )
      }
    }

    // Persist as the last-used project for future invocations.
    config.data.lastProjectId = projectId
    await config.write()
  } finally {
    if (runner) {
      runner.dispose()
      if (full) runner.stop()
    }
    await session.close()
  }
}
