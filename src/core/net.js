import os from 'node:os'

/**
 * Non-internal IPv4 addresses of this host, so we can tell an operator where the
 * CLI is reachable (e.g. to dial it from another device or an emulator). Skips
 * loopback and link-local; returns `{ iface, address }` pairs, most-likely-LAN
 * first (private ranges before anything else).
 *
 * @returns {Array<{ iface: string, address: string }>}
 */
export function lanAddresses() {
  const out = []
  for (const [iface, infos] of Object.entries(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue
      if (info.address.startsWith('169.254.')) continue
      out.push({ iface, address: info.address })
    }
  }
  return out.sort(
    (a, b) => Number(isPrivate(b.address)) - Number(isPrivate(a.address)),
  )
}

/** @param {string} addr */
function isPrivate(addr) {
  return (
    addr.startsWith('10.') ||
    addr.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(addr)
  )
}
