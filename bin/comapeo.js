#!/usr/bin/env node
import envPaths from 'env-paths'
import { hideBin } from 'yargs/helpers'
import yargs from 'yargs/yargs'

import { CliError } from '../src/script/output.js'

const { data: defaultStoragePath } = envPaths('CoMapeo')

/**
 * Lazily import a handler so a scriptable command doesn't pay for loading the
 * whole TUI (and vice versa).
 * @param {() => Promise<(args: any) => Promise<void>>} load
 */
function run(load) {
  /** @param {any} argv */
  return async (argv) => {
    try {
      const handler = await load()
      await handler(argv)
    } catch (err) {
      const code = err instanceof CliError ? err.code : 1
      process.exitCode = code
      process.stderr.write(
        (err instanceof Error ? err.message : String(err)) + '\n',
      )
    }
  }
}

yargs(hideBin(process.argv))
  .scriptName('comapeo')
  .usage(
    '$0 [command] [options]\n\n' +
      'Run `comapeo` with no command in a terminal to open the interactive UI.\n' +
      'Every action is also a scriptable subcommand below.',
  )
  .option('storage', {
    alias: 's',
    type: 'string',
    description: 'Folder to store CoMapeo data',
    default: defaultStoragePath,
    global: true,
  })
  .option('json', {
    type: 'boolean',
    description: 'Machine-readable output',
    default: false,
    global: true,
  })
  // Default command: launch the interactive TUI on a terminal, else show help.
  .command(
    '$0',
    'Launch the interactive CoMapeo terminal UI',
    () => {},
    run(async () => {
      if (!process.stdout.isTTY || !process.stdin.isTTY) {
        throw new CliError(
          'No terminal detected. Run a subcommand (see `comapeo --help`), ' +
            'or run `comapeo` in an interactive terminal.',
          2,
        )
      }
      const { startTui } = await import('../src/tui/app.js')
      return startTui
    }),
  )
  .command('device', 'Manage this device', (y) =>
    y
      .command(
        'info',
        'Show this device’s identity and name',
        () => {},
        run(async () => (await import('../src/script/device.js')).deviceInfo),
      )
      .command(
        'set',
        'Set this device’s name',
        (y2) =>
          y2
            .option('name', {
              type: 'string',
              demandOption: true,
              describe: 'Device name',
            })
            .option('type', {
              type: 'string',
              choices: ['desktop', 'mobile', 'tablet', 'selfHostedServer'],
              default: 'desktop',
            }),
        run(async () => (await import('../src/script/device.js')).deviceSet),
      )
      .command(
        'archive [state]',
        'Show or set archive mode (store all original media)',
        (y2) =>
          y2.positional('state', {
            type: 'string',
            choices: ['on', 'off'],
            describe:
              'Turn archive mode on or off (omit to show the current value)',
          }),
        run(
          async () => (await import('../src/script/device.js')).deviceArchive,
        ),
      )
      .demandCommand(1, 'Specify a device subcommand'),
  )
  .command('projects', 'List and create projects', (y) =>
    y
      .command(
        ['ls', 'list'],
        'List projects',
        (y2) =>
          y2.option('include-left', {
            type: 'boolean',
            default: false,
            describe: 'Include projects you have left',
          }),
        run(
          async () => (await import('../src/script/projects.js')).projectsList,
        ),
      )
      .command(
        'create',
        'Create a new project',
        (y2) => y2.option('name', { type: 'string', demandOption: true }),
        run(
          async () =>
            (await import('../src/script/projects.js')).projectsCreate,
        ),
      )
      .command(
        'leave <id>',
        'Leave a project (removes it from this device)',
        (y2) =>
          y2
            .positional('id', {
              type: 'string',
              describe: 'Project id or unique prefix',
            })
            .option('yes', {
              type: 'boolean',
              default: false,
              describe: 'Skip the confirmation prompt',
            }),
        run(
          async () => (await import('../src/script/projects.js')).projectsLeave,
        ),
      )
      .demandCommand(1, 'Specify a projects subcommand'),
  )
  .command('peers', 'Discover and list local peers', (y) =>
    y
      .command(
        ['ls', 'list'],
        'List peers on the local network',
        (y2) =>
          y2
            .option('wait-connected', {
              type: 'boolean',
              default: false,
              describe: 'Wait until at least one peer connects',
            })
            .option('timeout', {
              type: 'number',
              default: 30_000,
              describe: 'ms to wait when --wait-connected',
            }),
        run(async () => (await import('../src/script/peers.js')).peersList),
      )
      .demandCommand(1, 'Specify a peers subcommand'),
  )
  .command(
    'join',
    'Join a project by accepting an invite from a coordinator on the LAN',
    (y) =>
      y
        .option('auto-accept', {
          type: 'boolean',
          default: false,
          describe: 'Accept the first matching invite without prompting',
        })
        .option('from', {
          type: 'string',
          describe: 'Only accept an invite from this device name',
        })
        .option('timeout', {
          type: 'number',
          default: 120_000,
          describe: 'ms to wait for an invite',
        })
        .example(
          'comapeo join --auto-accept',
          'Join headlessly, accepting the first invite',
        ),
    run(async () => (await import('../src/script/join.js')).join),
  )
  .command(
    'fixtures',
    'Generate synthetic observations/tracks for demos and testing',
    (y) =>
      y
        .option('project', {
          type: 'string',
          describe: 'Project id or unique prefix',
        })
        .option('observations', {
          type: 'number',
          default: 25,
          describe: 'How many observations',
        })
        .option('tracks', {
          type: 'number',
          default: 3,
          describe: 'How many tracks',
        })
        .option('lat', {
          type: 'number',
          describe: 'Center latitude (else geo-IP)',
        })
        .option('lon', {
          type: 'number',
          describe: 'Center longitude (else geo-IP)',
        })
        .option('radius', {
          type: 'number',
          default: 2,
          describe: 'Spread radius in km',
        })
        .option('geoip', {
          type: 'boolean',
          default: true,
          describe:
            'Use a geo-IP lookup for the center when --lat/--lon are omitted',
        }),
    run(async () => (await import('../src/script/fixtures.js')).fixtures),
  )
  .command(
    'sync',
    'Sync a project with connected peers',
    (y) =>
      y
        .option('project', {
          type: 'string',
          describe: 'Project id or unique prefix',
        })
        .option('once', {
          type: 'boolean',
          default: false,
          describe: 'Converge once and exit',
        })
        .option('full', {
          type: 'boolean',
          default: false,
          describe: 'Sync data, not just initial',
        })
        .option('timeout', {
          type: 'number',
          default: 60_000,
          describe: 'Inactivity timeout in ms',
        })
        .example(
          'comapeo sync --once --full',
          'Sync all data once and exit (cron-friendly)',
        ),
    run(async () => (await import('../src/script/sync.js')).sync),
  )
  .command('members', 'List the members of a project', (y) =>
    y
      .command(
        ['ls', 'list'],
        'List members and their roles',
        (y2) =>
          y2.option('project', {
            type: 'string',
            describe: 'Project id or unique prefix',
          }),
        run(async () => (await import('../src/script/members.js')).membersList),
      )
      .demandCommand(1, 'Specify a members subcommand'),
  )
  .command(
    'invite <deviceId>',
    'Invite a connected device into a project (coordinator side)',
    (y) =>
      y
        .positional('deviceId', {
          type: 'string',
          describe:
            'Device id (full or unique prefix) to invite — see `comapeo peers ls --json`',
        })
        .option('project', {
          type: 'string',
          describe: 'Project id or unique prefix',
        })
        .option('role', {
          type: 'string',
          choices: ['member', 'coordinator'],
          default: 'member',
          describe: 'Role to grant the invited device',
        })
        .option('timeout', {
          type: 'number',
          default: 60_000,
          describe: 'ms to wait for the device to connect',
        })
        .example(
          'comapeo invite 1a2b3c --role coordinator',
          'Invite a device as a coordinator',
        ),
    run(async () => (await import('../src/script/invite.js')).invite),
  )
  .command(
    'view <schema>',
    'View records of a data type (read-only)',
    (y) =>
      y
        .positional('schema', {
          type: 'string',
          choices: ['observation', 'track', 'preset', 'field'],
          describe: 'Data type to view',
        })
        .option('project', {
          type: 'string',
          describe: 'Project id or unique prefix',
        })
        .option('lang', {
          type: 'string',
          describe: 'Language code for translated preset/field names',
        })
        .example(
          'comapeo view observation --json',
          'Print all observations as JSON',
        ),
    run(async () => (await import('../src/script/view.js')).view),
  )
  .command(
    'export',
    'Export a project as GeoJSON or a zip (incl. attachments)',
    (y) =>
      y
        .option('project', {
          type: 'string',
          describe: 'Project id or unique prefix',
        })
        .option('out', {
          type: 'string',
          demandOption: true,
          describe: 'Folder to write the export into',
        })
        .option('zip', {
          type: 'boolean',
          default: false,
          describe: 'Export a zip with attachments instead of a GeoJSON file',
        })
        .option('lang', {
          type: 'string',
          describe: 'Language code for translated names',
        })
        .example(
          'comapeo export --out ./out --zip',
          'Export a zip with media to ./out',
        ),
    run(async () => (await import('../src/script/export.js')).exportData),
  )
  .command(
    'stats',
    'Show recent project activity (new records by week, last ~3 months)',
    (y) =>
      y.option('project', {
        type: 'string',
        describe: 'Project id or unique prefix',
      }),
    run(async () => (await import('../src/script/stats.js')).stats),
  )
  .strict()
  .demandCommand(0)
  .example('comapeo', 'Open the interactive terminal UI')
  .example('comapeo peers ls --json', 'List peers on the LAN as JSON')
  .example(
    'comapeo invite <deviceId> --role coordinator',
    'Invite a device (coordinator side)',
  )
  .epilogue(
    'Joining is connection-bound: a coordinator on the same LAN must invite this device ' +
      'while `join` (or the interactive Join screen) is running — there is no invite URL. ' +
      'See README.md for the full guide.',
  )
  .help()
  .alias('help', 'h')
  .wrap(Math.min(100, process.stdout.columns || 100))
  .parse()
