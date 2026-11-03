# Project status

A summary of what Quake Anthology supports today and where it falls short. When this page and
the code disagree, the code is right.

## Version

- Latest tagged release: **1.2.6** ([release notes](releases/1.2.6.md)).
- The tree on `main` is ahead of it and reports **1.2.7-dev** (`package.json`,
  `src/version.ts`, `--version`). A `-dev` build never claims to be a tagged release: `bun run build`
  accepts it and `bun run release` refuses it. See the [changelog](../CHANGELOG.md) for what
  has changed since 1.2.6.
- Platform: 64-bit Linux, on Bun 1.3.14 or newer. The release executable and the build tooling
  target Linux x64 only. Game data is not included.

## What works

Products the catalog recognizes (`src/content/catalog/products.ts`; `--list-content` shows
which are installed on your machine):

| Family | Classic | Rerelease |
| --- | --- | --- |
| Quake | Quake, Scourge of Armagon, Dissolution of Eternity, Threewave CTF, Dimension of the Past, Dimension of the Machine, Dawn of the Machine, Quake 64 | Quake and the same expansions, Capture the Flag, Quake 64 |
| QuakeWorld | QuakeWorld and the expansions above | - |
| Quake II | Quake II, The Reckoning, Ground Zero, CTF, Loki's Minions CTF, Call of the Machine, Quake II 64 | The same |
| Quake III | Quake III Arena, Team Arena, restricted demo content | - |

Supported behavior:

- **Playing each game as itself**, and **mixing** rules, movement, characters, weapons,
  monsters, maps and kit across games in the custom-game builder or with command-line
  selections ([playing.md](playing.md)).
- **Mods**: QuakeC `progs.dat`, Quake II game DLLs (classic and rerelease) run in a software
  x86/x64 CPU emulator, Quake III QVM bytecode, and, with `--vm-game 0`, a mod's native
  Quake III `qagame` module (Windows PE or Linux ELF). Independent mod components can be
  toggled individually. See [mod-compatibility.md](mod-compatibility.md). A mod's
  interface, assets and authored gameplay still decide whether it runs; discovery alone is
  not a compatibility claim.
- **Renderers**: OpenGL (default) and a CPU software renderer (`--renderer cpu`).
- **Networking** over UDP: NetQuake (protocols 15, 666, 999), QuakeWorld (28), Quake II
  (34, 35, 36, 1038, 2023, 4038), Quake III (68), IPX, and the program's own mixed-game
  `qts://` transport. Details in [protocol.md](protocol.md); hosting in
  [server-guide.md](server-guide.md).
- **Saves**: the shared `QTSAVE5` format, import of original Quake saves, export of
  NetQuake `v5`/`v6` saves ([save-format.md](save-format.md)). Native Q3 guest modules save
  their memory with the checkpoint.
- **Optional LLM console assistant** with a validated command batch
  ([console-and-llm.md](console-and-llm.md)).
- **Fault containment**: a fault from one network peer drops that peer; a frame fault
  restarts the map on a dedicated server and returns a graphical client to the menu; a
  dedicated server exits after more than three frame faults in 60 seconds.

Acceptance of a game or mod here is a judgement from source and tests on specific builds. It
is not a claim that every original game, mod, device or campaign works.

## Known limitations

- Linux x64 only; no Windows or macOS build.
- Quake VCR streams (`-record`/`-playback` of VCR files) and the Quake III event and config
  journal are not implemented.
- The Quake III message-of-the-day service (`getmotd`) is not implemented. The `g_motd`
  configstring works.
- LMCTF referee selection by vote is not implemented; the vote menu offers skip-to-next-map
  and yes/no only.
- No retail online services: no Nightdive, Bethesda, Steam or Epic lobbies, matchmaking or
  cross-play. Only the UDP game traffic and the native KEX LAN protocol are spoken
  ([protocol.md](protocol.md)).
- Quake III key authorization is off unless `cl_authorizeKey` is set.
- Saves are refused while hosting or joined to a network game, in deathmatch (except
  server-administration saves), and during intermission. Foreign Tag, LMCTF and DeathBall
  sessions refuse to save rather than write a partial save. Original Quake II rerelease
  saves that record client or level state cannot be restored; only transition-shaped saves can.
- On a map from another game, DeathBall and LMCTF synthesize their entities from
  deathmatch spawns. Horde is the exception: on a Quake or Quake II map it needs an authored
  `horde_manager` and monster spawn points.
- Native Quake III modules run through the same trap table as bytecode and are tested on
  authored PE and ELF modules. Quake Live modules load, but using one as the server game is
  refused.
- MD3 level-of-detail registration is not implemented; only MD4 models select a level of
  detail.
- Quake III authoring tools (map compiler, QVM assembler, SDK and archive tools) are not part
  of this runtime. `tools/navigation/aas.ts` covers the AAS compile step.
- Traffic is not encrypted, as in the original games; see [SECURITY.md](../SECURITY.md) for
  what that means when hosting.
- `load` of a file outside the save directory is accepted only from the local console unless
  the server is started with `--allow-load-paths`.

## How to check a change

```sh
bun run typecheck
bun run policy        # slow
bun run test:unit     # no game data needed; data-dependent tests skip
```

`bun run check` runs those three plus the format, SPDX and event-codec checks.
`bun run test:corpus` (needs `QTS_TEST_CORPUS`) and `bun run test:gl` (adds native
window and renderer tests) run the data-dependent tiers.

## Where to look

| Question | Page |
| --- | --- |
| How do I run it? | [getting-started.md](getting-started.md), [playing.md](playing.md) |
| What does it support from mods? | [mod-compatibility.md](mod-compatibility.md) |
| How is the source organized? | [architecture.md](architecture.md) |
| Something broke | [troubleshooting.md](troubleshooting.md) |
| Running a server | [server-guide.md](server-guide.md) |
| What changed in a version? | [../CHANGELOG.md](../CHANGELOG.md), [releases/](releases/) |
| Is it safe to run third-party content? | [../SECURITY.md](../SECURITY.md) |
