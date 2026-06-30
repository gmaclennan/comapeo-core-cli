/**
 * Framework-agnostic model of sync progress. Combines a project's `'sync-state'`
 * events with the manager's `'local-peers'` events into a stable, renderable list
 * of per-peer rows keyed by deviceId.
 *
 * The public sync state exposes only `want`/`wanted` (remaining work), no totals,
 * so progress is derived from the peak `wanted` observed per peer per namespace
 * group — the denominator grows as we learn what's available, then drains to 0.
 *
 * `remoteDeviceSyncState` is keyed by peerId, which equals deviceId
 * (`peerId = keyToId(remotePublicKey)`, and the noise key is the device identity),
 * so it joins directly with `listLocalPeers()` peer info.
 *
 * Both the TUI dashboard and `comapeo sync --json` consume this same model.
 *
 * @typedef {import('@comapeo/core').MapeoManager} MapeoManager
 */

/**
 * @typedef {object} GroupProgress
 * @property {boolean} isSyncEnabled
 * @property {number} want    Blocks the peer wants from us (our remaining upload)
 * @property {number} wanted  Blocks we want from the peer (our remaining download)
 * @property {number} peakWanted Highest `wanted` seen, used as the progress denominator
 * @property {number} peakWant Highest `want` seen, used to derive uploaded totals
 * @property {number} progress 0..1, `(peak - wanted) / peak`; 1 when nothing was ever wanted
 * @property {number} downloaded Blocks transferred from the peer to us (`peakWanted - wanted`)
 * @property {number} uploaded Blocks transferred from us to the peer (`peakWant - want`)
 */

/**
 * @typedef {object} PeerRow
 * @property {string} deviceId
 * @property {string} [name]
 * @property {string} [deviceType]
 * @property {'connecting' | 'connected' | 'disconnected'} connection
 * @property {GroupProgress} initial
 * @property {GroupProgress} data
 * @property {boolean} synced True once both groups have nothing left in either direction
 */

/** @returns {GroupProgress} */
function emptyGroup() {
  return {
    isSyncEnabled: false,
    want: 0,
    wanted: 0,
    peakWanted: 0,
    peakWant: 0,
    progress: 1,
    downloaded: 0,
    uploaded: 0,
  }
}

/**
 * @param {GroupProgress} prev
 * @param {{ isSyncEnabled: boolean, want: number, wanted: number }} next
 * @returns {GroupProgress}
 */
function updateGroup(prev, next) {
  const peakWanted = Math.max(prev.peakWanted, next.wanted)
  const peakWant = Math.max(prev.peakWant, next.want)
  const progress =
    peakWanted === 0 ? 1 : (peakWanted - next.wanted) / peakWanted
  return {
    isSyncEnabled: next.isSyncEnabled,
    want: next.want,
    wanted: next.wanted,
    peakWanted,
    peakWant,
    progress,
    downloaded: peakWanted - next.wanted,
    uploaded: peakWant - next.want,
  }
}

/**
 * @param {GroupProgress} g
 * @returns {boolean}
 */
function groupDone(g) {
  return g.want === 0 && g.wanted === 0
}

export function createSyncModel() {
  /** @type {Map<string, PeerRow>} */
  const rows = new Map()
  /** Local device enable flags from the last sync-state. */
  let local = {
    initial: { isSyncEnabled: false },
    data: { isSyncEnabled: false },
  }

  /**
   * @param {string} deviceId
   * @returns {PeerRow}
   */
  function ensureRow(deviceId) {
    let row = rows.get(deviceId)
    if (!row) {
      row = {
        deviceId,
        connection: 'connecting',
        initial: emptyGroup(),
        data: emptyGroup(),
        synced: false,
      }
      rows.set(deviceId, row)
    }
    return row
  }

  return {
    /**
     * Apply a `'sync-state'` event payload.
     * @param {ReturnType<Awaited<ReturnType<MapeoManager['getProject']>>['$sync']['getState']>} state
     */
    applySyncState(state) {
      local = { initial: state.initial, data: state.data }
      for (const [deviceId, remote] of Object.entries(
        state.remoteDeviceSyncState,
      )) {
        const row = ensureRow(deviceId)
        row.initial = updateGroup(row.initial, remote.initial)
        row.data = updateGroup(row.data, remote.data)
        row.synced = groupDone(row.initial) && groupDone(row.data)
      }
    },

    /**
     * Apply a `'local-peers'` event payload (or `listLocalPeers()` result).
     * @param {Array<{ deviceId: string, name?: string, deviceType?: string, status: string }>} peers
     */
    applyPeers(peers) {
      for (const peer of peers) {
        const row = ensureRow(peer.deviceId)
        row.name = peer.name
        row.deviceType = peer.deviceType
        if (
          peer.status === 'connected' ||
          peer.status === 'disconnected' ||
          peer.status === 'connecting'
        ) {
          row.connection = peer.status
        }
      }
    },

    /** Local device sync-enabled flags. */
    get local() {
      return local
    },

    /**
     * Rows sorted by name then deviceId. Disconnected peers sort last.
     * @returns {PeerRow[]}
     */
    list() {
      return [...rows.values()].sort((a, b) => {
        if (a.connection === 'disconnected' && b.connection !== 'disconnected')
          return 1
        if (b.connection === 'disconnected' && a.connection !== 'disconnected')
          return -1
        return (a.name || a.deviceId).localeCompare(b.name || b.deviceId)
      })
    },

    /**
     * True when there is at least one connected peer and every connected peer is
     * synced. Mirrors the project-wide notion of "caught up".
     * @returns {boolean}
     */
    isAllSynced() {
      const connected = [...rows.values()].filter(
        (r) => r.connection === 'connected',
      )
      return connected.length > 0 && connected.every((r) => r.synced)
    },
  }
}

/** @typedef {ReturnType<typeof createSyncModel>} SyncModel */

/**
 * Split sync rows into peers that belong to the project (members, by deviceId)
 * and connected peers that don't — the latter are invite candidates, not part
 * of the sync set. Members are kept even when disconnected (so you can see who's
 * in the project but offline); non-member peers are only kept while connected.
 * `ordered` is the flat selectable list (in-project first) so a caret index maps
 * straight through a sectioned render.
 *
 * @param {PeerRow[]} rows
 * @param {Set<string>} [memberIds]
 * @returns {{ inProject: PeerRow[], others: PeerRow[], ordered: PeerRow[] }}
 */
export function partitionSyncRows(rows, memberIds = new Set()) {
  const inProject = []
  const others = []
  for (const row of rows) {
    if (memberIds.has(row.deviceId)) inProject.push(row)
    else if (row.connection !== 'disconnected') others.push(row)
  }
  return { inProject, others, ordered: [...inProject, ...others] }
}
