import assert from 'node:assert/strict'
import { test } from 'node:test'

import { crockford, idMatches, shortId } from '../src/core/format.js'

test('crockford encodes bytes with the Crockford alphabet (no I/L/O/U)', () => {
  assert.equal(crockford(Buffer.from([0, 0, 0, 0, 0])), '00000000') // 40 bits → 8 chars
  assert.equal(crockford(Buffer.from([0xff])), 'zw') // 11111111 -> 11111 000 -> z, w
  assert.match(
    crockford(Buffer.from('deadbeef', 'hex')),
    /^[0-9a-hjkmnp-tv-z]+$/,
  )
})

test('shortId of a hex id is 5 Crockford chars, deterministic', () => {
  const hex = 'a8df7ee219fd33a47b0fd7d6bf1bf6cf913407e01fa23800fceaedfdfcecbdc6'
  const s = shortId(hex)
  assert.equal(s.length, 5)
  assert.match(s, /^[0-9a-hjkmnp-tv-z]{5}$/)
  assert.equal(shortId(hex), s, 'stable across calls')
})

test('shortId of an already-encoded (non-hex) id takes the first 5 chars', () => {
  const projectId = 'fkd7uaduatrpezxqwiii759o5h8k89w7zj5mb1mt6hgjjox4er3o'
  assert.equal(shortId(projectId), 'fkd7u')
})

test('different ids produce different short ids', () => {
  assert.notEqual(shortId('00'.repeat(32)), shortId('ff'.repeat(32)))
})

test('shortId of a versionId shortens the hash and keeps the index with @', () => {
  const hash =
    'a8df7ee219fd33a47b0fd7d6bf1bf6cf913407e01fa23800fceaedfdfcecbdc6'
  const s = shortId(`${hash}/12`)
  assert.equal(s, `${shortId(hash)}@12`)
  assert.match(s, /^[0-9a-hjkmnp-tv-z]{5}@12$/)
})

test('idMatches accepts the full id, a raw prefix, and the short form', () => {
  const hex = 'a8df7ee219fd33a47b0fd7d6bf1bf6cf913407e01fa23800fceaedfdfcecbdc6'
  assert.ok(idMatches(hex, hex), 'exact')
  assert.ok(idMatches(hex, 'a8df7'), 'raw hex prefix')
  assert.ok(idMatches(hex, shortId(hex)), 'short form')
  assert.ok(idMatches(hex, shortId(hex).slice(0, 3)), 'short-form prefix')
  assert.ok(idMatches(hex, shortId(hex).toUpperCase()), 'case-insensitive')
  assert.ok(!idMatches(hex, 'zzzzz'), 'non-match')
  assert.ok(!idMatches(hex, ''), 'empty query never matches')
})

test('idMatches works for an already-encoded base32 projectId', () => {
  const projectId = 'fkd7uaduatrpezxqwiii759o5h8k89w7zj5mb1mt6hgjjox4er3o'
  assert.ok(idMatches(projectId, projectId))
  assert.ok(idMatches(projectId, shortId(projectId)), 'short form is a prefix')
})
