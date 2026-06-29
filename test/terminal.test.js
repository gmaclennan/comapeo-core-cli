import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hyperlink, supportsHyperlinks } from '../src/core/terminal.js'

test('hyperlink wraps a label in an OSC 8 sequence', () => {
  const out = hyperlink('https://example.com/a.jpg', 'photo')
  assert.equal(
    out,
    '\x1b]8;;https://example.com/a.jpg\x1b\\photo\x1b]8;;\x1b\\',
  )
})

test('supportsHyperlinks honors FORCE_HYPERLINK and NO_COLOR', () => {
  const tty = { isTTY: true }
  assert.equal(supportsHyperlinks(tty, { FORCE_HYPERLINK: '1' }), true)
  assert.equal(
    supportsHyperlinks(tty, { TERM_PROGRAM: 'iTerm.app', NO_COLOR: '1' }),
    false,
    'NO_COLOR wins',
  )
})

test('supportsHyperlinks requires a TTY and a known terminal', () => {
  assert.equal(
    supportsHyperlinks({ isTTY: false }, { TERM_PROGRAM: 'iTerm.app' }),
    false,
    'non-TTY never gets links',
  )
  assert.equal(
    supportsHyperlinks({ isTTY: true }, { TERM_PROGRAM: 'iTerm.app' }),
    true,
  )
  assert.equal(
    supportsHyperlinks({ isTTY: true }, { TERM: 'xterm-kitty' }),
    true,
  )
  assert.equal(
    supportsHyperlinks({ isTTY: true }, { TERM: 'xterm-256color' }),
    false,
    'unknown terminal stays plain',
  )
})
