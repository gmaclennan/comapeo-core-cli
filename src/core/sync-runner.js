import { createSyncModel } from './sync-model.js'

/**
 * Wire a project's sync to a {@link createSyncModel} and the manager's peer list.
 * Returns a controller used by both the TUI dashboard and `comapeo sync`.
 *
 * @param {import('@comapeo/core').MapeoManager} manager
 * @param {Awaited<ReturnType<import('@comapeo/core').MapeoManager['getProject']>>} project
 * @returns {{
 *   model: import('./sync-model.js').SyncModel,
 *   subscribe: (cb: () => void) => () => void,
 *   start: () => void,
 *   stop: () => void,
 *   waitForSync: (type?: 'initial' | 'full', timeoutMs?: number) => Promise<void>,
 *   dispose: () => void,
 * }}
 */
export function runSync(manager, project) {
  const model = createSyncModel()
  /** @type {Set<() => void>} */
  const subscribers = new Set()
  const notify = () => {
    for (const cb of subscribers) cb()
  }

  /** @param {any} state */
  const onSyncState = (state) => {
    model.applySyncState(state)
    notify()
  }
  /** @param {any} peers */
  const onPeers = (peers) => {
    model.applyPeers(peers)
    notify()
  }

  project.$sync.on('sync-state', onSyncState)
  manager.on('local-peers', onPeers)

  // Seed from current state so the first render isn't empty.
  model.applySyncState(project.$sync.getState())
  manager.listLocalPeers().then(onPeers)

  return {
    model,
    subscribe(cb) {
      subscribers.add(cb)
      return () => subscribers.delete(cb)
    },
    start() {
      project.$sync.start()
    },
    stop() {
      project.$sync.stop()
    },
    waitForSync(type = 'full', timeoutMs) {
      return project.$sync.waitForSync(type, timeoutMs ? { timeoutMs } : {})
    },
    dispose() {
      project.$sync.off('sync-state', onSyncState)
      manager.off('local-peers', onPeers)
      subscribers.clear()
    },
  }
}
