import { FastifyController, MapeoManager } from '@comapeo/core'
import createFastify from 'fastify'
import { JSONFilePreset } from 'lowdb/node'

import { randomBytes } from 'node:crypto'
import fsPromises from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
// @mapeo/default-config's main is a binary `.comapeocat` file, not a JS module —
// resolve its path and hand it to the manager as the default config to import.
const defaultConfigPath = require.resolve('@mapeo/default-config')

const comapeoCoreMainFile = import.meta.resolve('@comapeo/core')
const projectMigrationsFolder = new URL(
  '../drizzle/project/',
  comapeoCoreMainFile,
).pathname
const clientMigrationsFolder = new URL(
  '../drizzle/client/',
  comapeoCoreMainFile,
).pathname

/**
 * @typedef {'desktop' | 'mobile' | 'tablet' | 'selfHostedServer'} DeviceType
 * @typedef {object} ConfigData
 * @property {string} deviceName
 * @property {DeviceType} deviceType
 * @property {string} [lastProjectId]
 * @property {boolean} [configured] Whether the user has completed first-run setup
 */

/**
 * @typedef {object} Bootstrapped
 * @property {MapeoManager} manager
 * @property {FastifyController} fastifyController
 * @property {import('lowdb').Low<ConfigData>} config
 * @property {() => Promise<void>} close
 */

/**
 * Bring up a MapeoManager against core 7.x with the storage layout, persisted
 * root key, single-writer lockfile, and Fastify media server controller.
 *
 * @param {object} options
 * @param {string} options.storage Folder to store all CoMapeo data
 * @param {number} [options.port] Media server port (0 = ephemeral)
 * @returns {Promise<Bootstrapped>}
 */
export async function bootstrap({ storage, port = 0 }) {
  const dbFolder = path.join(storage, 'db')
  const coreStorage = path.join(storage, 'core')
  const rootKeyFile = path.join(storage, 'root-key')
  const configFile = path.join(storage, 'config.json')
  const lockFile = path.join(storage, 'comapeo.lock')

  // The manager does not create these itself.
  await fsPromises.mkdir(dbFolder, { recursive: true })
  await fsPromises.mkdir(coreStorage, { recursive: true })

  const releaseLock = await acquireLock(lockFile)

  try {
    const config = await JSONFilePreset(
      configFile,
      /** @type {ConfigData} */ ({
        deviceName: 'comapeo-cli',
        deviceType: 'desktop',
      }),
    )

    const rootKey = await loadOrCreateRootKey(rootKeyFile)

    const fastify = createFastify()
    const fastifyController = new FastifyController({ fastify })

    const manager = new MapeoManager({
      rootKey,
      dbFolder,
      coreStorage,
      projectMigrationsFolder,
      clientMigrationsFolder,
      fastify,
      defaultConfigPath,
      // A CLI/server device keeps all original media (backup/export oriented).
      defaultIsArchiveDevice: true,
    })

    await manager.setDeviceInfo({
      name: config.data.deviceName,
      deviceType: config.data.deviceType,
    })

    await fastifyController.start({ host: '127.0.0.1', port })

    let closed = false

    // Release the single-writer lock on interruption (e.g. Ctrl-C during a
    // blocking `join`/`sync`), so the next run isn't blocked by a stale lock. A
    // second signal falls through to Node's default hard exit.
    /** @param {NodeJS.Signals} sig */
    const onSignal = async (sig) => {
      await close().catch(() => {})
      process.exit(sig === 'SIGINT' ? 130 : 143)
    }

    const close = async () => {
      if (closed) return
      closed = true
      process.off('SIGINT', onSignal)
      process.off('SIGTERM', onSignal)
      // Manager#close does not close Fastify; stop the server first.
      await fastifyController.stop()
      await manager.close()
      await releaseLock()
    }

    process.once('SIGINT', onSignal)
    process.once('SIGTERM', onSignal)

    return { manager, fastifyController, config, close }
  } catch (err) {
    await releaseLock()
    throw err
  }
}

/**
 * @param {string} rootKeyFile
 * @returns {Promise<Buffer>}
 */
async function loadOrCreateRootKey(rootKeyFile) {
  try {
    return await fsPromises.readFile(rootKeyFile)
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') throw err
    const rootKey = randomBytes(16)
    await fsPromises.writeFile(rootKeyFile, Uint8Array.from(rootKey), {
      flag: 'wx',
    })
    return rootKey
  }
}

/**
 * Single-writer guard: only one manager may open a storage dir at a time
 * (sqlite + hypercore are single-writer).
 *
 * @param {string} lockFile
 * @returns {Promise<() => Promise<void>>} release function
 */
async function acquireLock(lockFile) {
  try {
    await fsPromises.writeFile(lockFile, String(process.pid), { flag: 'wx' })
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'EEXIST') {
      throw new Error(
        `Storage is already in use by another CoMapeo process (lock: ${lockFile}). ` +
          `If no other process is running, delete the lock file and retry.`,
      )
    }
    throw err
  }
  return async () => {
    await fsPromises.rm(lockFile, { force: true })
  }
}
