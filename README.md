# comapeo

A terminal client for
[`@comapeo/core`](https://www.npmjs.com/package/@comapeo/core): join or create a
CoMapeo project, invite others, sync, read and export data. It runs as an
interactive terminal UI and as a set of scriptable subcommands.

![CLI demo recording](demo/demo.gif)

## Install and run

```bash
npx @comapeo/core-cli --help
```

or install globally:

```bash
npm install -g @comapeo/core-cli
comapeo --help
```

Running `comapeo` with no command in a terminal opens the interactive UI. Any
other invocation runs a scriptable subcommand and exits. `comapeo --help` lists
everything.

## Interactive UI

Launch it with a bare `comapeo` on a TTY:

- **Join** `[j]` — accept a pending invite (shows project · role · who it's
  from).
- **Network** `[n]` — see nearby devices and **connect** to them (one, or all).
  Connections are manual and persist across screens; "disconnect all" drops
  every connection at once (core has no per-peer disconnect).
- **Sync** `[s]` — the sync dashboard. Initial sync (project metadata) runs
  automatically once a peer is connected; press `[s]` to start/stop syncing the
  **data** (observations + media).
- **Data** `[d]` — browse synced records, read-only.
- **Members** `[m]`, **Projects** `[p]`, **Device** `[e]` — project members,
  project select/create/leave, and this device's name/type/archive setting.

A typical first run as a **joiner**: open **Network**, connect to the
coordinator's device → the coordinator invites you → the invite appears under
**Join** → accept → the **Sync** screen opens; press `[s]` to pull the data.

## :warning: Manual connection required

Unlike the apps, the CLI does not automatically connect to peers on the LAN. You must open **Network** and connect to each peer you want to sync with or receive an invite from. The CLI currently does not broadcast MDNS records, so it's invisible to the apps (the CLI must connect to an app, not the other way around). Two CLIs will not be able to discover each other.

## Scriptable commands

Every command accepts `--storage <dir>` and `--json`; errors exit non-zero with a typed code.

| Command                                                               | What it does                                                      |
| --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `comapeo device set --name <n> [--type <t>]` / `device info`          | Set or show this device's identity                                |
| `comapeo device archive [on\|off]`                                    | Show or set archive mode (store all original media)               |
| `comapeo projects ls [--include-left]` / `projects create --name <n>` | List or create projects                                           |
| `comapeo projects leave <id> [--yes]`                                 | Leave a project (remove it from this device)                      |
| `comapeo peers ls [--wait-connected]`                                 | List devices connected on the LAN                                 |
| `comapeo join [--auto-accept] [--from <name>]`                        | Wait for and accept an invite                                     |
| `comapeo invite <deviceId> [--role member\|coordinator]`              | Invite a connected device (coordinator side)                      |
| `comapeo sync [--once] [--full]`                                      | Sync with connected peers (streams NDJSON, or `--once` to exit)   |
| `comapeo members ls`                                                  | List a project's members and roles                                |
| `comapeo view <schema>`                                               | View `observation` / `track` / `preset` / `field` records         |
| `comapeo export --out <dir> [--zip]`                                  | Export GeoJSON, or a zip with attachments                         |
| `comapeo stats`                                                       | Recent activity (new records by week, last ~3 months)             |
| `comapeo fixtures …`                                                  | Generate synthetic data (dev/demo only — this one writes records) |

Most commands act on the last-used project; pass `--project <id-or-prefix>` to
pick another. `invite` takes a device id from `comapeo peers ls --json` (the
table shows a short id; the JSON gives the full one). Examples:

```bash
comapeo peers ls --json
comapeo invite 1a2b3c4d --role coordinator --project rio
comapeo sync --once --full
comapeo view observation --json | jq length
comapeo export --out ./export --zip
```

## Sync model

`@comapeo/core` splits sync into two groups. **Initial/presync** (auth, config,
blob index) runs automatically whenever a peer is connected and only stops when
you disconnect. **Data** (records + blobs) is what you opt into: the `[s]` key
in the UI, or `--full` for `comapeo sync`. On a non-archive device, "100%
synced" can still omit original media variants — `export` notes this.

## Storage and output

Data lives under your OS data dir (`env-paths('CoMapeo')`) unless you pass
`--storage <dir>`. One manager owns a storage dir at a time (a lockfile guards
it), so don't run two commands against the same dir concurrently. With `--json`,
machine-readable output goes to stdout and human messages go to stderr, so pipes
stay clean.

## Development

```bash
npm test          # node:test suite
npm run typecheck # tsc --noEmit (JSDoc types)
npm run lint      # eslint
```
