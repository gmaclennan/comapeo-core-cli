/**
 * Output helpers for scriptable commands. stdout carries data (JSON/NDJSON/table);
 * stderr carries human chrome. Keep these the only place that writes to stdout so
 * piped output stays clean.
 */

/** @param {unknown} obj */
export function printJson(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n')
}

/** @param {unknown} obj One NDJSON record. */
export function printNdjson(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

/** @param {string} message */
export function info(message) {
  process.stderr.write(message + '\n')
}

/**
 * An error with an explicit process exit code, thrown by command handlers and
 * caught by the top-level CLI runner.
 */
export class CliError extends Error {
  /**
   * @param {string} message
   * @param {number} [code]
   */
  constructor(message, code = 1) {
    super(message)
    this.name = 'CliError'
    this.code = code
  }
}

/**
 * Print a simple aligned table of rows to stderr (human output).
 * @param {Array<Record<string, string | number | undefined>>} rows
 */
export function printTable(rows) {
  if (rows.length === 0) return
  const columns = Object.keys(rows[0])
  /** @param {string | number | undefined} v */
  const cell = (v) => (v === undefined || v === null ? '' : String(v))
  const widths = columns.map((col) =>
    Math.max(col.length, ...rows.map((r) => cell(r[col]).length)),
  )
  /** @param {Array<string | number | undefined>} cells */
  const line = (cells) =>
    cells.map((c, i) => cell(c).padEnd(widths[i])).join('  ')
  info(line(columns))
  info(widths.map((w) => '─'.repeat(w)).join('  '))
  for (const row of rows) info(line(columns.map((col) => row[col])))
}
