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

Copy your game installations into the [recommended content layout](content-layout.md).
Preserve original archives and loose companion files, including music.

## Run from source

From the repository:

```sh
bun install --frozen-lockfile
bun run start --content-root /path/to/qfiles
```

Without launch selections, startup opens the menu. Use `--menu` to request the
menu explicitly. The default game-data root is `~/Projects/qfiles`.

List products discovered under the installed content root or inspect launch options:

```sh
bun run start --content-root /path/to/qfiles --list-content
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
./quake-typescript --content-root /path/to/qfiles --menu --renderer gl --gamma 1.3
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
