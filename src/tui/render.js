import chalk from 'chalk'

import { shortId } from '../core/format.js'

/**
 * Pure rendering helpers — `state → string`. No I/O, no color-dependent logic,
 * so they unit-test cleanly. Color is applied only at the edges (glyphs/labels).
 */

const FULL = '█'
const EMPTY = '░'

/**
 * A fixed-width progress bar from a 0..1 fraction.
 * @param {number} progress
 * @param {number} [width]
 */
export function bar(progress, width = 16) {
  const clamped = Math.max(0, Math.min(1, progress))
  const filled = Math.round(clamped * width)
  return FULL.repeat(filled) + EMPTY.repeat(width - filled)
}

/** @param {number} progress */
export function pct(progress) {
  return `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`.padStart(4)
}

const SPARK_TICKS = '▁▂▃▄▅▆▇█'
/**
 * A unicode sparkline of recent values, scaled to the max in the window.
 * @param {number[]} values
 * @param {number} [width]
 */
export function sparkline(values, width = 14) {
  const window = values.slice(-width)
  if (window.length === 0) return ''
  const max = Math.max(1, ...window)
  return window
    .map((v) => SPARK_TICKS[Math.min(7, Math.floor((v / max) * 7))])
    .join('')
}

/**
 * @param {import('../core/sync-model.js').PeerRow} row
 * @returns {{ glyph: string, label: string }}
 */
export function statusOf(row) {
  if (row.connection === 'disconnected') return { glyph: '✕', label: 'offline' }
  if (row.connection === 'connecting')
    return { glyph: '◌', label: 'connecting' }
  if (row.synced) return { glyph: '✓', label: 'done' }
  return { glyph: '●', label: 'syncing' }
}

/**
 * A single dashboard row as plain text (no color), suitable for tests.
 * @param {import('../core/sync-model.js').PeerRow} row
 * @param {object} [opts]
 * @param {number} [opts.nameWidth]
 * @param {number} [opts.barWidth]
 * @param {boolean} [opts.raw] Show want/wanted block counts instead of ↓/↑ totals
 */
export function peerLine(
  row,
  { nameWidth = 16, barWidth = 12, raw = false } = {},
) {
  const name = (row.name ?? shortId(row.deviceId))
    .slice(0, nameWidth)
    .padEnd(nameWidth)
  const { glyph, label } = statusOf(row)
  const init = `${bar(row.initial.progress, barWidth)} ${pct(row.initial.progress)}`
  const data = `${bar(row.data.progress, barWidth)} ${pct(row.data.progress)}`
  // raw: remaining blocks each way; default: cumulative transferred each way.
  const counters = raw
    ? `${row.initial.wanted + row.data.wanted}/${row.initial.want + row.data.want} left`
    : `↓${row.initial.downloaded + row.data.downloaded} ↑${row.initial.uploaded + row.data.uploaded}`
  return `${glyph} ${name}  ${label.padEnd(10)}  ${init}   ${data}   ${counters}`
}

/** Colorize a status glyph for display. */
function colorGlyph(/** @type {string} */ glyph) {
  switch (glyph) {
    case '✓':
      return chalk.green(glyph)
    case '●':
      return chalk.cyan(glyph)
    case '✕':
      return chalk.red(glyph)
    default:
      return chalk.dim(glyph)
  }
}

/**
 * The full sync dashboard frame.
 * @param {import('../core/sync-model.js').SyncModel} model
 * @param {object} ctx
 * @param {string} ctx.projectName
 * @param {number} [ctx.selectedIndex] Selected peer row (for ↵ drill-in)
 * @param {boolean} [ctx.raw] Show raw block counts instead of %
 * @param {number} [ctx.rate] Blocks/sec over the last sample
 * @param {string} [ctx.spark] Recent-throughput sparkline
 */
export function dashboard(
  model,
  { projectName, selectedIndex = 0, raw = false, rate, spark },
) {
  const rows = model.list()
  const header =
    chalk.bold('CoMapeo Sync') +
    chalk.dim(
      `   ${projectName}   ${rows.length} peer${rows.length === 1 ? '' : 's'}`,
    )

  // L0 aggregate bar (+ live rate/sparkline): "are we synced yet?" across all peers.
  const peak = rows.reduce(
    (s, r) => s + r.initial.peakWanted + r.data.peakWanted,
    0,
  )
  const left = rows.reduce((s, r) => s + r.initial.wanted + r.data.wanted, 0)
  const overall = peak === 0 ? 1 : (peak - left) / peak
  const activity =
    rate === undefined
      ? ''
      : chalk.yellow(`   ↓ ${rate}/s`) + (spark ? chalk.cyan(`  ${spark}`) : '')
  const overallBar = `  ${bar(overall, 28)} ${chalk.bold(pct(overall).trim())}${activity}`

  const cols = chalk.dim(
    `    ${'PEER'.padEnd(16)}  ${'STATUS'.padEnd(10)}  ${'INITIAL'.padEnd(16)}  ${'DATA'.padEnd(16)}  ${raw ? 'want/wanted' : '↓/↑'}`,
  )

  const body =
    rows.length === 0
      ? chalk.dim('  Waiting for peers…')
      : rows
          .map((row, i) => {
            const caret = i === selectedIndex ? chalk.cyan('❯ ') : '  '
            const line = peerLine(row, { raw }).replace(/^(.)/, (m) =>
              colorGlyph(m),
            )
            return caret + line
          })
          .join('\n')

  const footer = model.isAllSynced()
    ? chalk.green('  ✓ All connected peers are caught up.')
    : chalk.dim('  Syncing…')

  const keys = chalk.dim(
    '  ↑↓ select · ↵ peer detail · s pause · r raw · i invite · esc back',
  )

  return [header, overallBar, '', cols, body, '', footer, keys].join('\n')
}

/**
 * Read-only detail for one peer (from the sync model's public per-peer state).
 * @param {import('../core/sync-model.js').PeerRow} row
 * @param {{ raw?: boolean }} [opts]
 */
export function peerDetail(row, { raw = false } = {}) {
  const f = (/** @type {string} */ k, /** @type {string} */ v) =>
    `  ${chalk.dim(k.padEnd(13))}${v}`
  /** @param {import('../core/sync-model.js').GroupProgress} g */
  const grp = (g) =>
    raw
      ? `want ${g.want}  wanted ${g.wanted}  (peak ${g.peakWanted})`
      : `${bar(g.progress, 14)} ${pct(g.progress)}`
  return [
    chalk.bold('Peer') + chalk.dim(`   ${row.name ?? shortId(row.deviceId)}`),
    chalk.dim('  ' + '─'.repeat(58)),
    f('device', chalk.cyan(shortId(row.deviceId))),
    f('type', row.deviceType ?? '—'),
    f('connection', row.connection),
    f('initial', grp(row.initial)),
    f('data', grp(row.data)),
    chalk.dim('  ' + '─'.repeat(58)),
    chalk.dim('  r raw · esc back'),
  ].join('\n')
}

/** @param {unknown} v */
function fmtValue(v) {
  if (v === null || v === undefined) return chalk.dim('—')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/**
 * Indented lines for a doc reference (or array of them). Refs are
 * `{ docId, versionId }`; we show each id on its own line with short ids so
 * they're readable instead of a one-line JSON blob.
 * @param {any} ref
 */
function refLines(ref) {
  const refs = Array.isArray(ref) ? ref : [ref]
  const out = []
  for (const r of refs) {
    if (r && typeof r === 'object' && 'docId' in r) {
      out.push(
        `    ${chalk.dim('docId'.padEnd(11))}${chalk.cyan(shortId(r.docId))}`,
      )
      if (r.versionId)
        out.push(
          `    ${chalk.dim('versionId'.padEnd(11))}${chalk.cyan(shortId(r.versionId))}`,
        )
    } else {
      out.push(`    ${fmtValue(r)}`)
    }
  }
  return out
}

const RECORD_HIDDEN = new Set([
  'docId',
  'versionId',
  'originalVersionId',
  'schemaName',
  'createdAt',
  'updatedAt',
  'links',
  'forks',
  'deleted',
  'createdBy',
  'updatedBy',
])

/**
 * Read-only "raw" view of a stored record. Tags are flattened one level into an
 * indented list (matching the design). The TUI never edits records.
 *
 * @param {Record<string, any>} doc
 */
export function recordDetail(doc) {
  const f = (/** @type {string} */ k, /** @type {string} */ v) =>
    `  ${chalk.dim(k.padEnd(13))}${v}`
  const lines = [
    chalk.bold('Record') + chalk.dim(`   ${doc.schemaName ?? ''}`),
    chalk.dim('  ' + '─'.repeat(60)),
    f('docId', chalk.cyan(shortId(doc.docId))),
  ]
  if (doc.versionId)
    lines.push(f('versionId', chalk.cyan(shortId(doc.versionId))))
  if (doc.createdAt) lines.push(f('createdAt', String(doc.createdAt)))
  for (const [k, v] of Object.entries(doc)) {
    if (RECORD_HIDDEN.has(k)) continue
    if (k === 'tags' && v && typeof v === 'object') {
      lines.push(f('tags', ''))
      for (const [tk, tv] of Object.entries(v)) {
        lines.push(`    ${chalk.dim(tk.padEnd(11))}${fmtValue(tv)}`)
      }
    } else if (/Refs?$/.test(k) && v && typeof v === 'object') {
      lines.push(f(k, ''))
      lines.push(...refLines(v))
    } else {
      lines.push(f(k, fmtValue(v)))
    }
  }
  if (doc.createdBy)
    lines.push(f('createdBy', chalk.cyan(shortId(doc.createdBy))))
  lines.push(chalk.dim('  ' + '─'.repeat(60)))
  lines.push(chalk.dim('  esc back   ') + chalk.yellow('read-only'))
  return lines.join('\n')
}

/**
 * @typedef {{ kind: 'peer', peer: import('@comapeo/core').PublicPeerInfo }
 *   | { kind: 'device', device: import('../core/session.js').DiscoveredDevice }} NetworkRow
 */

/**
 * The Network screen: connected peers (from `listLocalPeers()`) above the
 * devices we've discovered but not yet dialed ("available"). `rows` is the flat
 * selectable list — connected first, then available — so the caret index maps
 * straight through. Connecting/connected devices fold into the peer rows because
 * the mDNS name can't be correlated to a deviceId before connection.
 *
 * @param {NetworkRow[]} rows
 * @param {{ selectedIndex?: number, listen?: { port: number, addresses: Array<{ iface: string, address: string }> } }} [opts]
 */
export function networkScreen(rows, { selectedIndex = 0, listen } = {}) {
  const connected = rows.filter((r) => r.kind === 'peer')
  const available = rows.filter((r) => r.kind === 'device')
  const lines = [
    chalk.bold('Network') +
      chalk.dim(
        `   ${connected.length} connected · ${available.length} available`,
      ),
  ]
  if (listen) {
    const where = listen.addresses.length
      ? listen.addresses.map((a) => `${a.address}:${listen.port}`).join('  ')
      : `port ${listen.port}`
    lines.push(chalk.dim(`  listening at ${where}`))
  }
  lines.push(chalk.dim('  ' + '─'.repeat(60)))
  if (rows.length === 0) lines.push(chalk.dim('  No devices nearby yet…'))
  let i = 0
  const caret = (/** @type {boolean} */ sel) => (sel ? chalk.cyan('❯ ') : '  ')
  if (connected.length) {
    lines.push(chalk.dim('  CONNECTED'))
    for (const r of connected) {
      const p = /** @type {{ kind: 'peer', peer: any }} */ (r).peer
      const name = (p.name ?? shortId(p.deviceId)).slice(0, 20).padEnd(20)
      lines.push(
        caret(i === selectedIndex) +
          chalk.green('● ') +
          name +
          chalk.dim((p.deviceType ?? '').padEnd(12)) +
          chalk.dim('connected'),
      )
      i++
    }
  }
  if (available.length) {
    lines.push(chalk.dim('  AVAILABLE'))
    for (const r of available) {
      const d = /** @type {{ kind: 'device', device: any }} */ (r).device
      const label = `device ${d.name.slice(0, 6)}`.padEnd(20)
      lines.push(
        caret(i === selectedIndex) +
          chalk.dim('○ ') +
          label +
          chalk.dim(`${d.address}:${d.port}`),
      )
      i++
    }
  }
  lines.push(
    chalk.dim('  ' + '─'.repeat(60)),
    chalk.dim(
      '  ↑↓ select · ↵ connect · a add by IP · c connect all · x disconnect all · esc back',
    ),
  )
  return lines.join('\n')
}
