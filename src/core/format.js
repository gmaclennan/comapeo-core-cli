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

/**
 * A short, friendly id for display: the first 5 chars of a Crockford base-32
 * encoding. Core hex ids (deviceId, docId, versionId) are decoded from hex and
 * re-encoded; ids that are already an encoded string (e.g. the base-32 projectId)
 * are truncated to their first 5 chars.
 *
 * @param {string} id
 * @returns {string}
 */
export function shortId(id) {
  if (id.length % 2 === 0 && /^[0-9a-f]+$/i.test(id)) {
    return crockford(Buffer.from(id, 'hex')).slice(0, 5)
  }
  return id.slice(0, 5)
}
