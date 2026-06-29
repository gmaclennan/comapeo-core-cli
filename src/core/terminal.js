/**
 * OSC 8 terminal hyperlinks. Lets us print a clickable label that opens a URL
 * (e.g. an attachment in the browser) in terminals that support it, and degrade
 * to plain text everywhere else.
 */

const ESC = '\x1b'
const ST = `${ESC}\\` // string terminator

/**
 * Wrap `label` in an OSC 8 hyperlink to `url`. The caller decides whether the
 * terminal supports it (see {@link supportsHyperlinks}) — this just builds the
 * sequence `ESC ] 8 ; ; <url> ST <label> ESC ] 8 ; ; ST`.
 *
 * @param {string} url
 * @param {string} label
 * @returns {string}
 */
export function hyperlink(url, label) {
  return `${ESC}]8;;${url}${ST}${label}${ESC}]8;;${ST}`
}

/**
 * Best-effort detection of OSC 8 hyperlink support. Conservative: only returns
 * true for terminals known to render them, so unsupported terminals never show
 * raw escape bytes. Honors `NO_COLOR` (off) and `FORCE_HYPERLINK` (on).
 *
 * @param {{ isTTY?: boolean }} [stream] Defaults to `process.stdout`
 * @param {NodeJS.ProcessEnv} [env] Defaults to `process.env`
 * @returns {boolean}
 */
export function supportsHyperlinks(stream = process.stdout, env = process.env) {
  if (env.FORCE_HYPERLINK && env.FORCE_HYPERLINK !== '0') return true
  if (env.NO_COLOR || env.TERM === 'dumb') return false
  if (!stream || !stream.isTTY) return false
  if (env.WT_SESSION) return true // Windows Terminal
  if (env.TERM === 'xterm-kitty') return true // kitty
  switch (env.TERM_PROGRAM) {
    case 'iTerm.app':
    case 'WezTerm':
    case 'ghostty':
    case 'vscode':
    case 'Hyper':
      return true
  }
  // GNOME Terminal & other VTE terminals expose VTE_VERSION; OSC 8 since 0.50.
  if (env.VTE_VERSION && Number(env.VTE_VERSION) >= 5000) return true
  return false
}
