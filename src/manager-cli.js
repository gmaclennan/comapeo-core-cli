import { input, number, select } from '@inquirer/prompts'
import chalk from 'chalk'

// import fileSelector from 'inquirer-file-selector'
import { LocalDiscovery } from './local-discovery.js'

const DEFAULT_CONFIG_PATH = import.meta.resolve('@mapeo/default-config')

/** @typedef {'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'l' | 'm' | 'n' | 'o' | 'p' | 'q' | 'r' | 's' | 't' | 'u' | 'v' | 'w' | 'x' | 'y' | 'z' | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'} Key */

const COMMANDS =
  /** @satisfies {Array<{ key: Key, value: keyof ManagerCli, name?: string }>} */ ([
    { key: 'c', value: 'createProject', name: 'Create a new project' },
    { key: 'l', value: 'listProjects', name: 'List projects' },
    { key: 'o', value: 'openProject', name: 'Open a project' },
    {
      key: 'd',
      value: 'startDiscovery',
      name: 'Start local peer discovery',
    },
    { key: 'x', value: 'stopDiscovery', name: 'Stop local peer discovery' },
    { key: 'p', value: 'connectPeer', name: 'Manually connect to peer' },
  ])

export default class ManagerCli {
  #manager

  static COMMANDS = COMMANDS
  #discovery

  /**
   * @param {import('@comapeo/core').MapeoManager} manager
   */
  constructor(manager) {
    this.#manager = manager
    this.#discovery = new LocalDiscovery(manager)
  }

  /**
   * @param {object} options
   * @param {AbortSignal} options.signal
   */
  async createProject({ signal }) {
    const name = await input(
      {
        message: 'Project name',
        required: true,
        default: 'My Project',
      },
      { signal },
    )
    const projectId = await this.#manager.createProject({
      configPath: DEFAULT_CONFIG_PATH,
      name,
    })
    console.log(`Created project '${name}' with ID ${projectId}`)
  }

  async listProjects() {
    const projects = await this.#manager.listProjects()
    if (projects.length === 0) {
      console.log('No projects found')
      return
    }
    console.table(
      projects.map((p) => ({
        projectId: p.projectId.slice(0, 7) + '…',
        name: p.name,
        createdAt: new Date(p.createdAt || 0).toLocaleString(),
        updatedAt: new Date(p.updatedAt || 0).toLocaleString(),
      })),
    )
  }

  /**
   * @param {object} options
   * @param {AbortSignal} options.signal
   */
  async openProject({ signal }) {
    const projects = await this.#manager.listProjects()
    if (projects.length === 0) {
      console.log('No projects found')
      return
    }
    const projectId = await select(
      {
        message: 'Select a project',
        choices: projects.map((p) => ({
          name: p.name + chalk.dim(' (' + p.projectId.slice(0, 7) + '…)'),
          value: p.projectId,
        })),
      },
      { signal },
    )
    const project = await this.#manager.getProject(projectId)
    // TODO: Add ProjectCli class to handle project commands
    return project
  }

  async startDiscovery() {
    const nameAndPort = await this.#discovery.start()
    if (!nameAndPort) return
    const { name, port } = nameAndPort
    console.log('Discovery started:', { name, port })
  }

  async stopDiscovery() {
    await this.#discovery.stop()
    console.log('Discovery stopped')
  }

  /**
   * @param {object} options
   * @param {AbortSignal} options.signal
   */
  async connectPeer({ signal }) {
    const address = await input(
      { message: 'Peer address', required: true },
      { signal },
    )
    const port =
      (await number({ message: 'Peer port', required: true }, { signal })) || 0
    const name = await input(
      { message: 'Peer name', required: true },
      { signal },
    )

    const peer = await this.#manager.connectLocalPeer({ address, port, name })
    console.log('Peer:', peer)
  }
}
