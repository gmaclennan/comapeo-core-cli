#!/usr/bin/env node
import envPaths from 'env-paths'
import { hideBin } from 'yargs/helpers'
import yargs from 'yargs/yargs'

import comapeoCli from '../src/cli.js'

const { data: defaultStoragePath } = envPaths('CoMapeo')

const { storage, clean, port } = yargs(hideBin(process.argv))
  .option('storage', {
    alias: 's',
    type: 'string',
    description: 'Folder to store CoMapeo data',
    default: defaultStoragePath,
  })
  .option('clean', {
    alias: 'c',
    type: 'boolean',
    description: 'Remove all data from the storage folder',
    default: false,
  })
  .option('port', {
    alias: 'p',
    type: 'number',
    description: 'Port to run the CoMapeo server',
    default: 3456,
  })
  .parseSync()

comapeoCli({ storage, clean, port })
