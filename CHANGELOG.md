# Changelog

Dates are tag dates. Each version links to its full release notes in
[docs/releases/](docs/releases/); this file is the short index. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) loosely, and versions are
`MAJOR.MINOR.PATCH` as in `package.json`.

## Unreleased

`package.json` and `--version` report 1.2.7-dev for this tree (a SemVer pre-release; the release
script refuses it, the build accepts it).

### Added
- `--vm-game 0` runs a mod's native Quake III `qagame` module (Windows `.dll` or Linux `.so`) as
  the server game instead of its bytecode, falling back to `vm/qagame.qvm` when the mod ships
  none. Native module state, heap and fiber-local storage are saved with the game.
- `--lan-only` makes NetQuake and Quake II KEX LAN hosts ignore every datagram from a
  non-private address.
- `--allow-load-paths` lets scripts, game modules and remote clients `load` a save from outside
  the save directory.
- `cl_http_package_downloads` (default 1) turns off HTTP package downloads (`pak`, `pkz`, `pk3`)
  while keeping other downloads.
- Quake II native downloads that are interrupted resume from a `.part` file once its length and
  SHA-256 still match.
- Quake Live table-style game modules expose their full export table.

### Changed
- Security limits on untrusted input:
  - Servers cap connections per address, gate connectionless-packet floods, expire challenges
    after 30 seconds, bound decompression, and back off after repeated wrong rcon passwords.
  - Server-supplied downloads are limited to asset types and sizes, and HTTP download servers on
    private hosts are refused unless the game server is private too.
  - Quake II game modules can run only a short list of console commands, and their file writes
    and memory use are capped.
  - `llm_exec` rejects more commands (quit, connect, map changes, chat, file writes and similar)
    and cvars whose values run as commands.
  - `load` of a file outside the save directory is accepted only from the local console.
  - LLM credentials move to `~/.local/share/quake-typescript/settings/` with mode 0600, and the
    crash log is mode 0600 with passwords and tokens redacted.
- A fault caused by one network peer drops that peer; a frame fault restarts the map on a
  dedicated server or returns a graphical client to the menu; a dedicated server exits after
  repeated faults.
- Quake III ladder climbing stays on by default; `pmove_ladders 0` disables it.
- The Quake III server runs its first-admission settle frames, so the first user commands carry
  real elapsed time.

### Fixed
- Unified input: movement provider bounds are enforced at the input boundary.
- Legacy translucent world surfaces draw after opaque entities.
- HTTP downloads accept decoded gzip bodies, and compare length only for identity encoding.
- Quake pushers touch triggers before impact.
- Rerelease Quake II `BoxEdicts` filters may link or unlink entities. Monsters that dodge from
  inside `M_CheckDodge` previously ended the run with "Q2 BoxEdicts filter cannot modify world
  links".
- No old world survives a map change, in graphical or headless runs.
- A secondary Quake II seat waits for the primary seat's world before loading, so it no longer
  captures stale content or fails to rebind after map travel.
- Restored Quake II trains keep their wait.
- Native game profiles for the 1998 Xatrix (The Reckoning) release, and rerelease Gekk water
  movement.
- A program in a product's user content folder now satisfies its required programs (for example a
  user `qwprogs.dat` beside an installed mod).

### Performance
- Guest write observers are indexed by backing page.
- Merged render geometry is retained by constituent identity.
- PVS-invisible BSP subtrees are skipped through ancestor marks.

### Documentation
- Added [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md), this changelog,
  [architecture](docs/architecture.md), [troubleshooting](docs/troubleshooting.md),
  [server guide](docs/server-guide.md), [save format](docs/save-format.md),
  [protocols](docs/protocol.md), [release process](docs/release-process.md) and a
  [status page](docs/status.md). Corrected the dedicated-server example and the LLM credential
  location.

## 1.2.6 - 2026-10-26
Tossed items, most visibly Quake monster backpacks, no longer hang in mid-air against walls and
corners. [Notes](docs/releases/1.2.6.md)

## 1.2.5 - 2026-10-25
Retained model geometry feeds stable batches into the GL pack cache; the CPU rasterizer stops
re-validating each draw; final title art. [Notes](docs/releases/1.2.5.md)

## 1.2.4 - 2026-10-23
Lit model geometry is retained across frames when every shading input is unchanged.
[Notes](docs/releases/1.2.4.md)

## 1.2.3 - 2026-10-23
`quit`, `connect` and `disconnect` work from every console; shared settings resolve on dedicated
servers; performance. [Notes](docs/releases/1.2.3.md)

## 1.2.2 - 2026-10-23
Faster bot navigation construction on foreign maps and GL model preparation.
[Notes](docs/releases/1.2.2.md)

## 1.2.1 - 2026-10-23
Every TypeScript source can host every authored map family; Q3-authored maps play on Q1 and Q2
primaries; unified hosting; CPU renderer worker threads (`QTS_CPU_WORKERS`).
[Notes](docs/releases/1.2.1.md)

## 1.2.0 - 2026-10-22
Behavior-preserving performance release (pose caches, allocation-free Quake II lighting).
[Notes](docs/releases/1.2.0.md)

## 1.1.10 - 2026-10-22
Selected enemies, campaign travel and custom guest programs work across every world program.
Also shipped without a note: foreign movement and characters on native Quake II worlds and shared CTF
on every world. `--version` reported 1.1.9 for this tag. [Notes](docs/releases/1.1.10.md)

## 1.1.9 - 2026-10-21
QuakeWorld and Quake III mod guests take the full custom-game matrix in local play.
[Notes](docs/releases/1.1.9.md)

## 1.1.8 - 2026-10-21
Foreign arsenals play on every guest execution kind; guests without a qualified primary interface
run as black boxes. [Notes](docs/releases/1.1.8.md)

## 1.1.7 - 2026-10-21
Any arsenal plays on any QuakeC program; the weapon stage is derived from the program.
[Notes](docs/releases/1.1.7.md)

## 1.1.6 - 2026-10-20
An undecodable optional companion file behaves like an absent one instead of refusing the map.
[Notes](docs/releases/1.1.6.md)

## 1.1.5 - 2026-10-20
Loki's Minions CTF and Rogue DeathBall on every game; retail rerelease saves restored; first
performance pass. [Notes](docs/releases/1.1.5.md)

## 1.1.4 - 2026-10-19
Edition and mode matrix completed; 40 catalog products; Horde in every game.
[Notes](docs/releases/1.1.4.md)

## 1.1.3 - 2026-10-17
One-page custom-game builder, character turntable, cross-game play in Quake III worlds.
[Notes](docs/releases/1.1.3.md)

## 1.1.2 - 2026-10-15
LLM subscription model list refreshed. [Notes](docs/releases/1.1.2.md)

## 1.1.1 - 2026-10-15
LLM subscription sign-in callback runs on its own worker; LLM settings move to the shared
settings folder. [Notes](docs/releases/1.1.1.md)

## 1.1.0 - 2026-10-14
One shared foundation under the whole engine; automatic game-data discovery; crash log.
[Notes](docs/releases/1.1.0.md)

## 1.0.0 - 2026-09-26
First release. [Notes](docs/releases/1.0.0.md)
