import mdns from 'mdns'

export class LocalDiscovery {
  #comapeo
  /** @type {mdns.Advertisement | undefined} */
  #ad
  /** @type {mdns.Browser | undefined} */
  #browser
  /**
   * @param {import('@comapeo/core').MapeoManager} comapeo
   */
  constructor(comapeo) {
    this.#comapeo = comapeo
  }

  async start() {
    if (this.#ad || this.#browser) return
    this.#browser = mdns.createBrowser(mdns.tcp('comapeo'))
    const { name, port } = await this.#comapeo.startLocalPeerDiscoveryServer()
    this.#ad = mdns.createAdvertisement(mdns.tcp('comapeo'), port, {
      name,
    })
    this.#ad.on('error', console.error)
    this.#browser.on('serviceUp', (service) => {
      const address = service.addresses.find(isIP4Address)
      if (!address) return
      const port = service.port
      const name = service.name
      if (!name) return
      this.#comapeo.connectLocalPeer({ address, port, name })
    })
    this.#browser.start()
    this.#ad.start()
    return { name, port }
  }

  async stop() {
    await this.#comapeo.stopLocalPeerDiscoveryServer()
    if (this.#ad) {
      this.#ad.stop()
      this.#ad = undefined
    }
    if (this.#browser) {
      this.#browser.stop()
      this.#browser = undefined
    }
  }
}

/**
 * @param {string} value
 */
function isIP4Address(value) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(value)
}
