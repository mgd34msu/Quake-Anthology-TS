# Changelog

Dates are tag dates. Each version links to its full release notes in
[docs/releases/](docs/releases/); this file is the short index. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) loosely, and versions are
`MAJOR.MINOR.PATCH` as in `package.json`.

## Unreleased

`package.json` and `--version` report 1.2.7-dev for this tree (a SemVer pre-release; the release
script refuses it, the build accepts it).

### Fixed
- Unified input: movement provider bounds are enforced at the input boundary (B1).
- Legacy translucent world surfaces draw after opaque entities (B2).
- HTTP downloads accept decoded gzip bodies and compare length only for identity encoding (B3).
- Quake pushers touch triggers before impact (B4).
- Rerelease Quake II `BoxEdicts` filters may link or unlink entities. Monsters that dodge from
  inside `M_CheckDodge` previously raised "Q2 BoxEdicts filter cannot modify world links" and
  ended the run (audit DOCS3-007).
- The 2026-11-01 audit remediation: fault containment (a peer fault drops the peer, a frame
  fault restarts the map, a dedicated server exits after repeated faults), network hardening
  (connection and flood limits, bounded inflate, rcon backoff, download limits), guest memory
  and file-write limits, LLM credential handling, crash-log redaction and many correctness
  fixes. See [the remediation status](docs/reviews/2026-11-01-full-audit/REMEDIATION.md).

### Performance
- Guest write observers are indexed by backing page (PERF1).
- Merged render geometry is retained by constituent identity (PERF2).
- PVS-invisible BSP subtrees are skipped through ancestor marks (PERF3).

### Documentation
- Added [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md), this changelog,
  [architecture](docs/architecture.md), [troubleshooting](docs/troubleshooting.md),
  [server guide](docs/server-guide.md), [save format](docs/save-format.md),
  [protocols](docs/protocol.md), [release process](docs/release-process.md) and one maintained
  [status page](docs/status.md). Corrected the dedicated-server example and the LLM credential
  location. Dated status, plan and comparison pages now carry a banner.

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
