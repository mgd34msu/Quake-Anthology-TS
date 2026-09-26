# Quake Anthology

Quake, Quake II, and Quake III gameplay in one engine and executable, written in
strict TypeScript and run or compiled with Bun. Mix movement, characters, weapons,
monsters, and equipment while retaining each selected source's behavior.

The project is unfinished. Supported combinations work, but complete mod
interoperability, content coverage, rendering fidelity, and release qualification
remain in progress. Native DLL gameplay and saving remain the active performance
work; the [performance notes](docs/functional-targets/performance.md) distinguish current optimizations from measured improvements. See the [shared task list](docs/functional-targets/status.md)
and [installed build status](docs/execution-status.md#installed-executable-and-recent-fixes).

Classic Quake and Quake II components must preserve their original gameplay,
feedback, and presentation. Rerelease additions belong to the selected rerelease
component and must not appear in an all-classic setup. This is the fidelity
requirement; every combination has not yet been verified.

## Run on Linux

Install Bun 1.3.14 or newer, SDL2, OpenGL, FreeType, and libvorbisfile. Supply your
own game data in the layout below, then run from this repository:

```sh
bun install --frozen-lockfile
bun run start --content-root /path/to/qfiles
```

Starting without launch selections opens the menu. The default game-data root is
`~/Projects/qfiles`. To compile a standalone executable:

```sh
bun run build
```

The build prints its output directory. Run from that directory:

```sh
./quake-typescript --content-root /path/to/qfiles --menu --renderer gl
```

The executable includes Bun but still needs native libraries and game data.
See [setup and build instructions](docs/getting-started.md) for rendering options,
video dependencies, content discovery, and build records.

## Recommended content layout

Keep each game's original archives and companion files together. Keep classic
and rerelease data separate, including files with identical names.

```text
qfiles/
  q1/id1/                         # classic Quake
  q1/rerelease/id1/                # Quake rerelease
  q2/baseq2/                       # classic Quake II
  q2/rerelease/baseq2/             # Quake II rerelease
  q3a/baseq3/                      # Quake III Arena
  q3a/missionpack/                 # Team Arena
```

Writable add-ons mirror this layout under
`~/.local/share/quake-typescript/content/`. Saves and settings live in sibling
`saves/` and `settings/` directories. Use `--user-content-root PATH` to choose a
different writable content root.

The [full content layout](docs/content-layout.md) covers expansions, QuakeWorld,
mod packages, maps, music, and configuration files. Game data is not bundled.

## Play and customize

Choose an installed game or expansion under **Play a game**. Use
**Play a game → Custom game** to mix the world, movement, character, weapons,
monsters, and equipment. Under **World**, **Map content** selects maps
independently from the game or mod that supplies the rules.

**Custom game → Mods** enables or disables independent components individually.
Multiple compatible components can run together, including components from
different games. The project requires general cross-game mod composition;
installed packages still need supported source interfaces and dependencies.
Discovery alone does not establish compatibility.

Under **Equipment**, **Hook** selects **Off**, **Weapon slot**, or **Offhand**.
**Hook style** independently selects Threewave for Q1/Q2/Q3, LMCTF for Q2, or
LRCTF for Q3. **Offhand grenades** is one **Off/On** option.

Use **Options → Controls → Bindings (Player 1)** to edit keys and mouse buttons.
See [playing and selections](docs/playing.md) for command-line examples, equipment,
multiplayer, and saves, or [mod compatibility](docs/mod-compatibility.md) for
supported original interfaces and component declarations.

## Console and optional LLM

Use `find <text>` and `help <name>` in the console to inspect commands and settings.
Tab completes commands; Up/Down recalls history; PageUp/PageDown scrolls output.

**Options → LLM options** configures subscription or API access. The
[console and LLM guide](docs/console-and-llm.md) explains authentication, credential
locations, `llm_ask`, `llm_exec`, and command validation.

## Documentation and development

- [Documentation index](docs/README.md)
- [Functional targets and acceptance status](docs/functional-targets/status.md)
- [Remaining work](docs/remaining-work.md)
- [Gameplay tick and optimization targets](docs/tick-execution.md)
- [Installed executable and runtime evidence](docs/execution-status.md#installed-executable-and-recent-fixes)
- [Architecture contracts](docs/contracts.md)
- [Performance, caching rules, and fidelity](docs/functional-targets/performance.md)
- [Development checks](docs/getting-started.md#check-a-change)

Keep this README short. Put detailed setup, commands, and feature documentation
in `docs/`; keep implementation history and qualification evidence in the linked
status pages. Update the relevant guide when user-visible behavior changes.

## License

Engine code is licensed under GNU GPL version 2 or later; see [LICENSE](LICENSE).
Existing source headers retain attribution and applicable terms. Original game
data is separate and is not relicensed by this repository.
