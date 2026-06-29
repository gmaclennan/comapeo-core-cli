// Crockford base-32 alphabet (no I, L, O, U).
const CROCK = '0123456789abcdefghjkmnpqrstvwxyz'

/**
 * Crockford base-32 encode a byte buffer.
 * @param {Buffer | Uint8Array} bytes
 * @returns {string}
 */
export function crockford(bytes) {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += CROCK[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += CROCK[(value << (5 - bits)) & 31]
  return out
}

/** @param {string} s */
function isHex(s) {
  return s.length > 0 && s.length % 2 === 0 && /^[0-9a-f]+$/i.test(s)
}

/**
 * A short, friendly id for display: the first 5 chars of a Crockford base-32
 * encoding. Core hex ids (deviceId, docId) are decoded from hex and re-encoded;
 * ids that are already an encoded string (e.g. the base-32 projectId) are
 * truncated to their first 5 chars.
 *
 * A versionId is `<hex>/<index>`: we shorten the hash part and keep the index,
 * joined with `@` rather than `/` so it doesn't read as a path (e.g. `a1b2c@3`).
 *
 * @param {string} id
 * @returns {string}
 */
export function shortId(id) {
  if (typeof id !== 'string') return String(id)
  const slash = id.indexOf('/')
  if (slash !== -1) {
    const head = id.slice(0, slash)
    const index = id.slice(slash + 1)
    if (isHex(head)) {
      return crockford(Buffer.from(head, 'hex')).slice(0, 5) + '@' + index
    }
  }
  if (isHex(id)) return crockford(Buffer.from(id, 'hex')).slice(0, 5)
  return id.slice(0, 5)
}

/**
 * Does `query` identify `fullId`? Matches the raw id (exact or prefix) OR its
 * displayed short form (exact or prefix), so an operator can paste back either
 * the full id or the base-32 short id shown in the UI. Case-insensitive.
 *
 * @param {string} fullId
 * @param {string} query
 * @returns {boolean}
 */
export function idMatches(fullId, query) {
  if (!query) return false
  const q = query.toLowerCase()
  const full = fullId.toLowerCase()
  if (full === q || full.startsWith(q)) return true
  const short = shortId(fullId).toLowerCase()
  return short === q || short.startsWith(q)
}
