import { openSession } from '../core/session.js'
import { info, printJson } from './output.js'

/**
 * @param {object} args
 * @param {string} args.storage
 * @param {boolean} [args.json]
 */
export async function deviceInfo({ storage, json }) {
  const session = await openSession({ storage })
  try {
    const deviceInfo = session.manager.getDeviceInfo()
    const out = { ...deviceInfo, deviceId: session.manager.deviceId }
    if (json) printJson(out)
    else {
      info(`Device ID:   ${out.deviceId}`)
      info(`Name:        ${out.name ?? '(unset)'}`)
      info(`Device type: ${out.deviceType ?? '(unset)'}`)
    }
  } finally {
    await session.close()
  }
}

/**
 * @param {object} args
 * @param {string} args.storage
 * @param {string} args.name
 * @param {'desktop' | 'mobile' | 'tablet' | 'selfHostedServer'} [args.type]
 * @param {boolean} [args.json]
 */
export async function deviceSet({ storage, name, type = 'desktop', json }) {
  const session = await openSession({ storage })
  try {
    await session.manager.setDeviceInfo({ name, deviceType: type })
    // Persist so the next process bootstraps with the same identity info.
    session.config.data.deviceName = name
    session.config.data.deviceType = type
    await session.config.write()
    if (json) printJson({ name, deviceType: type })
    else info(`Device name set to "${name}" (${type})`)
  } finally {
    await session.close()
  }
}

/**
 * Show or set archive mode. An archive device stores all original media (the
 * CLI default); a non-archive device skips originals to save space. Core
 * persists this setting itself.
 *
 * @param {object} args
 * @param {string} args.storage
 * @param {'on' | 'off'} [args.state] Omit to just show the current value
 * @param {boolean} [args.json]
 */
export async function deviceArchive({ storage, state, json }) {
  const session = await openSession({ storage })
  const { manager } = session
  try {
    if (state === 'on' || state === 'off') {
      const want = state === 'on'
      // setIsArchiveDevice throws if the value is unchanged; only set on a change.
      if (manager.getIsArchiveDevice() !== want)
        manager.setIsArchiveDevice(want)
    }
    const archived = manager.getIsArchiveDevice()
    if (json) printJson({ isArchiveDevice: archived })
    else
      info(
        `Archive device: ${archived ? 'on (stores all original media)' : 'off'}`,
      )
  } finally {
    await session.close()
  }
}
