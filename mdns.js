import { createPrompt, useKeypress } from '@inquirer/core'
import { select } from '@inquirer/prompts'
import mdns from 'mdns'

const browser = mdns.createBrowser(mdns.tcp('comapeo'))

/** @type {Array<{ name: string, value: { host: string, port: number }, disabled: boolean }>} */
const devices = []
let ac = new AbortController()

browser.on('serviceUp', (service) => {
  if (!service.name) return
  const host = service.addresses.find(isIP4Address)
  if (!host) return
  const port = service.port
  const existingDevice = devices.find((d) => d.name === service.name)
  if (existingDevice) {
    existingDevice.disabled = false
    existingDevice.value = { host, port }
  } else {
    devices.push({
      name: service.name,
      value: { host, port },
      disabled: false,
    })
  }
  ac.abort()
  ac = new AbortController()
})
browser.on('serviceDown', (service) => {
  const existingDevice = devices.find((d) => d.name === service.name)
  if (existingDevice) {
    existingDevice.disabled = true
  }
  ac.abort()
  ac = new AbortController()
})
browser.start()

/** @type {import('@inquirer/type').Prompt<boolean, { message: string, helperText: string }>} */
const waitingPrompt = createPrompt((config, done) => {
  useKeypress((key) => {
    if (key.name === 'q') {
      done(true)
    }
  })
  return [`? ${config.message}`, `${config.helperText}`]
})

process.on('beforeExit', async () => {
  console.log('beforeExit')
  await new Promise((res) => setTimeout(res, 1000))
  console.log('exiting')
})

while (true) {
  try {
    const availableDevices = devices.filter((d) => !d.disabled)
    if (availableDevices.length === 0) {
      await waitingPrompt(
        { message: 'No devices found', helperText: 'Press q to quit' },
        { signal: ac.signal },
      )
      break
    } else {
      const device = await select(
        {
          message: 'Select a device',
          choices: devices,
        },
        { signal: ac.signal },
      )
      console.log(device)
    }
  } catch (e) {
    console.error(e)
  }
}

/**
 * @param {string} value
 */
function isIP4Address(value) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(value)
}
