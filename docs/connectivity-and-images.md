# Investigation notes

Two open questions from the CLI additions work. Neither has shipped code beyond
the manual connect / listen-address commands; these are the findings that inform
what (if anything) to build next.

## 1. Connecting the CLI to the app in the Android emulator

The emulator's default QEMU SLIRP networking puts each instance behind its own
virtual NAT on `10.0.2.0/24`. mDNS depends on multicast to `224.0.0.251:5353`,
and SLIRP drops those packets. So by default mDNS reaches **neither** other
emulators **nor** the host — discovery between the CLI (host) and the app
(emulator) silently finds nothing in either direction.

Reference: https://github.com/gmaclennan/android-emulator-mdns-test. Important
nuance: that repo does **not** show SLIRP forwarding mDNS — it gets
emulator‑to‑emulator mDNS working by adding a _second_ virtual NIC on a QEMU
`socket,mcast=...` backend, i.e. a shared L2 Ethernet segment that joins the
emulators to each other. That segment is emulator‑only; it does **not** include
the host network. So there is no multicast path to the host in either setup, and
the workaround in that repo doesn't help the host↔emulator case at all.

The practical bridge for host↔emulator is to skip mDNS entirely and dial a known
address+port. The new `peers connect <address> <port>` command and the Network
screen's "a add by IP" affordance exist for exactly this. Two routings:

- **App (emulator) dials the CLI (host).** From inside the emulator the host is
  reachable at the special alias `10.0.2.2`. So if the CLI reports
  `peers address` → listening on port `P`, the app connects to `10.0.2.2:P`.
  This needs the app to expose a "connect by IP" entry point too.

- **CLI (host) dials the app (emulator).** Forward a host port into the emulator
  with `adb forward tcp:<hostPort> tcp:<guestPort>`, where `<guestPort>` is the
  app's local‑peer discovery server port inside the guest. Then
  `comapeo peers connect 127.0.0.1 <hostPort>`. Alternatively `adb reverse
tcp:<port> tcp:<port>` makes the emulator's `localhost:<port>` map back to the
  host, so the app can dial `localhost:<port>` and reach the CLI.

Both directions require knowing the other side's listening port. The CLI now
prints its own via `comapeo peers address`; the app would need to surface the
equivalent (and core would need a "connect to this address" API on the app side —
it already has `connectLocalPeer` internally, which is what the CLI uses).

Recommendation: manual IP+port connect (now shipped) is the unblock. A nicer
follow‑up would be a small `comapeo emulator` helper that runs the right
`adb forward`/`reverse` and then dials, but it can't fully work until the app
also offers a manual‑connect entry point.

## 2. Images / attachments in the terminal

Options, roughly in order of portability:

- **OSC 8 hyperlinks (recommended first step).** Emit a clickable link that opens
  the attachment in the browser / default viewer:
  `\x1b]8;;file:///abs/path\x1b\\label\x1b]8;;\x1b\\`. Widely supported (iTerm2,
  kitty, WezTerm, GNOME Terminal, Windows Terminal, recent VTE). Degrades to plain
  text where unsupported. Point it at a `file://` path for a local export, or at
  the Fastify media server URL the manager already runs (`http://127.0.0.1:<port>/…`)
  for a live attachment. This is cheap and universal — the right default for the
  data view's `attachments` field.

- **Inline image protocols (richer, terminal‑specific).** Actually render the
  pixels in the terminal:
  - iTerm2 inline images — `\x1b]1337;File=...:<base64>\x1b\\`.
  - kitty graphics protocol — `\x1b_G...\x1b\\` (also WezTerm, Ghostty).
  - Sixel — supported by xterm (compiled in), mlterm, foot, WezTerm.
    These need per‑terminal detection and fallback; a library like `term-img` /
    `terminal-image` (iTerm2) or `chafa` (sixel/ansi blocks, external binary) wraps
    the detection. More work, and useless over plain SSH / CI logs.

**Implemented:** the TUI record detail now renders each `attachments` entry as an
OSC 8 hyperlink to its media‑server URL (`project.$blobs.getUrl`, `original`
variant), so clicking opens the file in the browser. Capability is detected in
`src/core/terminal.js` (`supportsHyperlinks` — honors `NO_COLOR`/`FORCE_HYPERLINK`,
requires a TTY and a known terminal); where unsupported, the URL is printed
plainly so it can still be copied. True inline pixel rendering (iTerm2/kitty/Sixel)
remains a possible future enhancement behind a flag, not the default.
