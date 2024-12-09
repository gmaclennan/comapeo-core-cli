import { MapeoManager } from '@comapeo/core'
import { confirm } from '@inquirer/prompts'
import chalk from 'chalk'
import { deleteAsync } from 'del'
import createFastify from 'fastify'
import { JSONFilePreset } from 'lowdb/node'
import { makeDirectory } from 'make-dir'

import { randomBytes } from 'node:crypto'
import fsPromises from 'node:fs/promises'
import path from 'node:path'

import listPrompt from './interactive-select-prompt.js'
import ManagerCli from './manager-cli.js'

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
 * @typedef {Awaited<ReturnType<MapeoManager['getProject']>>} MapeoProject
 */
/**
 * @typedef {{
 *   type: 'manager'
 * } | {
 *   type: 'managerCommand', command: keyof ManagerCli
 * } | {
 *   type: 'project', project: MapeoProject
 * } | {
 *   type: 'projectCommand', command: keyof MapeoProject, project: MapeoProject
 * } | {
 *   type: 'invite', invite: { projectName: string, inviteId: string }
 * }} Context
 */

/**
 * @param {object} options
 * @param {string} options.storage
 * @param {boolean} options.clean
 * @param {number} options.port
 */
export default async function comapeoCli({ storage, clean, port }) {
  console.log(`Storage folder: ${chalk.dim(storage)}`)
  if (clean) {
    const isConfirmed = await confirm({
      message: `Are you sure you want to delete all existing data?`,
      default: false,
    })
    if (isConfirmed) {
      await deleteAsync(storage, { force: true })
    }
  }
  const dbFolder = path.join(storage, 'db')
  const coreStorage = path.join(storage, 'core')
  const rootKeyFile = path.join(storage, 'root-key')
  const configFile = path.join(storage, 'config.json')
  await Promise.all([makeDirectory(dbFolder), makeDirectory(coreStorage)])
  const db = await JSONFilePreset(configFile, { deviceName: 'comapeo-cli' })

  /** @type {Buffer} */
  let rootKey
  try {
    rootKey = await fsPromises.readFile(rootKeyFile)
    // eslint-disable-next-line no-unused-vars
  } catch (_error) {
    rootKey = randomBytes(16)
    await fsPromises.writeFile(rootKeyFile, rootKey)
  }
  console.log(
    `Root key: ${chalk.dim(rootKey.toString('hex').slice(0, 7) + '…')}`,
  )

  const fastify = createFastify()

  const comapeo = new MapeoManager({
    dbFolder,
    coreStorage,
    rootKey,
    projectMigrationsFolder,
    clientMigrationsFolder,
    fastify,
  })
  await comapeo.setDeviceInfo({
    name: db.data.deviceName,
    deviceType: 'desktop',
  })

  await fastify.listen({ port })

  console.log(`Server listening on port ${port}`)

  const managerCli = new ManagerCli(comapeo)

  let ac = new AbortController()

  /** @type {Context[]} */
  const context = [{ type: 'manager' }]

  process.stdin.on('keypress', (str, key) => {
    if (key.name === 'escape') {
      context.pop()
    } else if (key.name === 'q') {
      context.splice(0)
    } else {
      return
    }
    ac.abort()
    ac = new AbortController()
  })
  comapeo.invite.on('invite-received', (invite) => {
    context.push({ type: 'invite', invite })
    ac.abort('invite')
    ac = new AbortController()
  })

  async function inquire() {
    const current = context.at(-1)
    if (!current) throw new Error('Unexpected empty context')

    switch (current.type) {
      case 'manager': {
        const command = await listPrompt(
          {
            message: 'What do you want to do?',
            choices: ManagerCli.COMMANDS,
          },
          { signal: ac.signal },
        )
        context.push({ type: 'managerCommand', command })
        break
      }
      case 'managerCommand': {
        await managerCli[current.command]({ signal: ac.signal })
        // if (result instanceof MapeoProject) {
        //   context.push({ type: 'project', project: result })
        // }
        context.pop()
        break
      }
      case 'invite': {
        console.log(current.invite)
        break
      }
      case 'project':
        break
      case 'projectCommand':
        break
    }
  }

  while (true) {
    try {
      await inquire()
    } catch (e) {
      if (!(e instanceof Error)) throw e
      if (e.name !== 'AbortPromptError') throw e
      // passthrough prompt aborts
    }
    if (!context.length) break
  }

  console.log(chalk.red('Exiting...'))
  await managerCli.stopDiscovery()
  await fastify.close()
}
