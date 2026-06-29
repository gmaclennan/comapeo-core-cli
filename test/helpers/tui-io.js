import stripAnsi from 'strip-ansi'

import { PassThrough, Writable } from 'node:stream'

/** Common key byte sequences a terminal delivers. */
export const KEY = {
  enter: '\r',
  escape: '\x1b',
  ctrlC: '\x03',
  up: '\x1b[A',
  down: '\x1b[B',
}

/**
 * A readable stream that `readline` + `keys.js` treat as a raw-mode TTY.
 * Write byte sequences to it to drive the TUI.
 */
export function makeFakeStdin() {
  const stdin = /** @type {any} */ (new PassThrough())
  stdin.isTTY = true
  stdin.setRawMode = () => stdin
  return stdin
}

/**
 * A capturing stdout. `output()` returns all writes so far, ANSI-stripped, so
 * tests can assert which frames were rendered.
 */
export function makeCaptureStdout({ columns = 100, rows = 30 } = {}) {
  /** @type {string[]} */
  const writes = []
  const stdout = /** @type {any} */ (
    new Writable({
      write(chunk, _enc, cb) {
        writes.push(chunk.toString('utf8'))
        cb()
      },
    })
  )
  stdout.columns = columns
  stdout.rows = rows
  stdout.isTTY = true
  // @inquirer ends the output stream on prompt cleanup; neuter end() so later
  // log-update writes don't throw ERR_STREAM_WRITE_AFTER_END in tests.
  stdout.end = (/** @type {any[]} */ ...args) => {
    const cb = args.find((a) => typeof a === 'function')
    if (cb) cb()
    return stdout
  }
  return {
    stdout,
    /** All output so far, ANSI-stripped. */
    output: () => stripAnsi(writes.join('')),
  }
}

/**
 * Poll until `pred()` is truthy or timeout.
 * @param {() => boolean | Promise<boolean>} pred
 * @param {{ timeout?: number, interval?: number, label?: string }} [opts]
 */
export async function waitFor(
  pred,
  { timeout = 8000, interval = 20, label = '' } = {},
) {
  const start = Date.now()
  for (;;) {
    if (await pred()) return
    if (Date.now() - start > timeout) {
      throw new Error(`waitFor timed out${label ? `: ${label}` : ''}`)
    }
    await new Promise((r) => setTimeout(r, interval))
  }
}
