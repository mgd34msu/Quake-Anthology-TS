# Quake Anthology

Quake, Quake II, and Quake III Arena — plus their expansions, rerelease
editions, QuakeWorld, and supported mods — in one engine and one executable,
written in strict TypeScript. Play each game as itself, or mix rules,
movement, characters, weapons, monsters, maps, and equipment across games
while each selected source keeps its own behavior.

**Version 1.2.4** is available from
[GitHub Releases](https://github.com/mgd34msu/Quake-Anthology-TS/releases/tag/v1.2.4)
as a Linux x64 executable. See the [release notes](docs/releases/1.2.4.md).

Game data is **not** included. You need your own legally obtained copies of
whichever games you want to play. Classic components preserve original
gameplay, feedback, and presentation; rerelease additions belong to the
rerelease components and do not leak into an all-classic setup.

## Install (release executable)

You need a 64-bit Linux system with these native libraries installed
(usually already present on a gaming setup):

- SDL2
- OpenGL
- FreeType
- libvorbisfile (Ogg Vorbis music)
- libtheoradec (OGV video cutscenes)

Download `quake-anthology-1.2.4-linux-x64.tar.gz` from the
[release page](https://github.com/mgd34msu/Quake-Anthology-TS/releases/tag/v1.2.4),
extract it anywhere, and run the executable:

```sh
tar -xzf quake-anthology-1.2.4-linux-x64.tar.gz
./quake-typescript
```

That opens the menu. The next section explains how your game data is found.

## Point it at your games

Games are recognized by the base directory every install ships: `id1`
(Quake), `baseq2` (Quake II), `baseq3` (Quake III Arena). The folder
*containing* that directory is treated as the game folder, and expansions,
rerelease data (in its `rerelease/` subfolder), and mods are found as its
siblings. Folder names and letter case do not matter.

### Steam

Nothing to set up. If the games are installed through Steam (native,
Flatpak, or an extra library folder), they are found automatically:

```sh
./quake-typescript
```

Use `--steam` to search *only* Steam libraries. Nightdive add-ons
downloaded inside the rereleases (under Steam's Saved Games) are picked up
too, below any local copies.

### GOG, original media, or any other layout

Pass `--content-root` once, pointing at a folder that contains your games
in any of these shapes — all work:

```text
games/                  <- --content-root games
  Quake/Id1/…
  Quake 2/baseq2/…
  Quake 3 Arena/baseq3/…
```

```sh
./quake-typescript --content-root /path/to/games
```

Pointing `--content-root` directly at a single game's folder (the one
containing `id1`, `baseq2`, or `baseq3`) also works. If your games live in
unrelated places (say Quake from Steam and Quake II from GOG), put links to
their folders in one place instead of copying anything:

```sh
mkdir -p ~/quake-games
ln -s ~/.local/share/Steam/steamapps/common/Quake ~/quake-games/
ln -s "/path/to/Quake II" ~/quake-games/
./quake-typescript --content-root ~/quake-games
```

Check what was found before playing:

```sh
./quake-typescript --content-root /path/to/games --list-content
```

Without `--content-root`, the executable searches its own folder, then the
folder above it, then Steam, and stops at the first folder holding a game —
so dropping the executable (or a link to it) next to your game folders also
works. Note the search stops at the first matching root; if your games are
split across several roots, gather them (or links to them) under one root
as above.

Writable add-ons, saves, and settings live under
`~/.local/share/quake-typescript/` by default; installed game folders are
never written to. See the [content layout guide](docs/content-layout.md)
for expansions, mods, maps, and music placement.

## Play

From the menu, **Play a game** lists everything discovered.
**Play a game → Custom game** mixes components on one screen: the map set
is chosen independently from the game supplying the rules, so (for example)
Quake II rules can run on Quake or Quake III maps, with any game's
movement, character, weapons, and monsters. Character appearance (Q1
colors, Q2/Q3 model and skin) has a live preview under **Character**.
**Custom game → Mods** toggles installed mod components individually,
including components from different games. Under **Kit** you can add a
grappling hook (Threewave, LMCTF, or LRCTF style) and hand grenades.
Settings persist as you change them.

Command-line launches work too:

```sh
# Quake II rules and movement on a Quake III map
./quake-typescript --game q2-classic-baseq2 --map-game q3-baseq3 --map q3dm17 \
  --movement q2 --character q2 --mode deathmatch

# Dedicated server, no window
./quake-typescript --content-root /path/to/games --game q1-classic-id1 \
  --map e1m1 --mode deathmatch --dedicated
```

`--renderer` selects `gl` (default) or the `cpu` software renderer;
`--gamma 0.5…3` adjusts brightness. Run with `--help` for every option,
including multiplayer hosting/joining and protocol selections. The
[playing guide](docs/playing.md) has more examples, and
[mod compatibility](docs/mod-compatibility.md) documents which original
mod interfaces (QuakeC, Q2 DLLs, QVM) are supported.

Use `find <text>` and `help <name>` in the console to inspect commands and
settings. An optional LLM assistant can answer console questions and run
validated commands — see the [console and LLM guide](docs/console-and-llm.md).

## Build from source

Requires [Bun](https://bun.sh) 1.3.14 or newer plus the native libraries
above.

```sh
bun install --frozen-lockfile
bun run start --content-root /path/to/games   # run from source
bun run build                                 # compile a standalone executable
```

The build typechecks and policy-checks an immutable source snapshot,
compiles the runtime, and prints its output directory
(`dist/runtime.json` records the details). The compiled executable still
needs the native libraries and your game data. See
[setup and build instructions](docs/getting-started.md).

Checks for a change: `bun run typecheck`, `bun run policy`, and
`bun test` (some tests need game data via `QTS_TEST_CORPUS`).

## Documentation

- [Documentation index](docs/README.md)
- [Set up, run, and build](docs/getting-started.md)
- [Organize game data, mods, maps, and music](docs/content-layout.md)
- [Playing and selections](docs/playing.md)
- [Mod compatibility](docs/mod-compatibility.md)
- [Console and LLM](docs/console-and-llm.md)
- [Functional targets and acceptance status](docs/functional-targets/status.md)
- [Architecture contracts](docs/contracts.md)

## License

Engine code is licensed under GNU GPL version 2 or later; see
[LICENSE](LICENSE). Existing source headers retain attribution and
applicable terms. Original game data is separate and is not relicensed by
this repository.
