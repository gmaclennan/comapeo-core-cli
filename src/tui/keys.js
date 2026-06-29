import readline from 'node:readline'

/**
 * Own the terminal's raw-mode keypress stream. Exactly one owner at a time: call
 * `pause()` before running an @inquirer prompt (which takes over stdin) and
 * `resume()` afterwards. This baton-pass avoids two libraries fighting over
 * stdin/raw-mode.
 *
 * @param {(str: string | undefined, key: { name?: string, ctrl?: boolean }) => void} onKey
 * @param {NodeJS.ReadableStream & { isTTY?: boolean, setRawMode?: (mode: boolean) => unknown }} [stdin]
 * @returns {{ pause: () => void, resume: () => void, stop: () => void }}
 */
export function createKeyReader(onKey, stdin = process.stdin) {
  // A lone Esc is ambiguous with the start of an escape sequence (arrow keys,
  // etc.), so readline holds it until either the rest of a sequence arrives or
  // `escapeCodeTimeout` elapses. The default 500ms makes Esc-to-go-back feel
  // laggy; 50ms keeps it snappy while still coalescing real sequences, which
  // arrive in a single chunk on a local terminal.
  readline.emitKeypressEvents(
    stdin,
    /** @type {any} */ ({ escapeCodeTimeout: 50 }),
  )

  let active = false
  const resume = () => {
    if (active) return
    active = true
    if (stdin.isTTY) stdin.setRawMode?.(true)
    stdin.on('keypress', onKey)
    stdin.resume()
  }
  const pause = () => {
    if (!active) return
    active = false
    stdin.off('keypress', onKey)
    if (stdin.isTTY) stdin.setRawMode?.(false)
  }
  const stop = () => {
    pause()
    stdin.pause()
  }

  resume()
  return { pause, resume, stop }
}
