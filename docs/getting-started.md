# Set up, run, and build

The current executable build target is Linux. Game data is not included.

## Install dependencies

Install Bun 1.3.14 or newer and these native libraries:

- SDL2
- OpenGL
- FreeType
- libvorbisfile for Ogg Vorbis audio
- libtheoradec for OGV video playback

A compiled executable includes the Bun runtime. It still needs the native
libraries used by the selected renderer and media, plus your game data.

No copying is required: existing Steam installations are found
automatically, and `--content-root` accepts any folder containing your
game folders (GOG, original media, or a hand-made collection — see the
[content layout guide](content-layout.md)). Wherever the data lives,
preserve original archives and loose companion files, including music.

## Run the release executable

Download the Linux x64 tarball from
[GitHub Releases](https://github.com/mgd34msu/Quake-Anthology-TS/releases),
extract it, and run `./quake-typescript`. Steam installs are detected
automatically; for anything else pass `--content-root /path/to/games`
(see [content discovery](content-layout.md)). Verify detection with
`--list-content`.

## Run from source

From the repository:

```sh
bun install --frozen-lockfile
bun run start --content-root /path/to/games
```

Without launch selections, startup opens the menu. Use `--menu` to request the
menu explicitly. Without `--content-root`, the game-data root is found by
searching the executable's own folder (the working directory from source), then
the folder above it, then the default Steam library locations; `--steam`
searches only the Steam locations. Games are recognized by their `id1`,
`baseq2`, and `baseq3` base directories under any parent folder names.

List products discovered under the installed content root or inspect launch options:

```sh
bun run start --content-root /path/to/games --list-content
bun run start --help
```

Discovery does not prove that a mod's executable interface and gameplay are
supported. See [mod compatibility](mod-compatibility.md) before mixing components.

## Build an executable

From the repository:

```sh
bun run build
```

The build runs TypeScript and source-policy checks on an immutable source
snapshot, compiles the runtime, and checks that its inputs stayed unchanged.
It prints the output directory. `dist/runtime.json` records the executable
location, source identity, and checksums.

Run from the printed directory:

```sh
./quake-typescript --content-root /path/to/games --menu --renderer gl --gamma 1.3
```

Use `--renderer cpu` for software rendering. Gamma defaults to `1`; higher
values brighten the final image. The accepted range is `0.5` through `3`.

The [playing guide](playing.md) covers explicit game, map, and movement selections.
The [installed-build record](execution-status.md#installed-executable-and-recent-fixes)
identifies the local delivered executable and its verification limits. Building
current source does not by itself qualify every game or platform.

## Check a change

Use checks appropriate to the changed code:

```sh
bun run typecheck
bun run policy
bun test path/to/relevant.test.ts
```

The project enforces strong typing and source boundaries, including restrictions
on unsafe casts and `any`. Some tests need installed game data or native libraries.
A focused passing check does not establish full gameplay compatibility.

Update the relevant user guide when commands, settings, features, or directory
requirements change. Keep implementation evidence in the
[status documents](functional-targets/status.md), and keep the main README concise.
