# Quake Anthology

Quake Anthology brings Quake, Quake II, and Quake III gameplay into one engine and executable, written in strict TypeScript and run or compiled with Bun. Movement, characters, weapons, monsters, and equipment share the same world and actor systems, with source-specific behavior retained where it matters.

This is an unfinished engine project. Mixed configurations work, but complete interoperability, content coverage, rendering fidelity, and release qualification are still in progress. This repository is not a finished replacement for every original game or mod.

**Run on Linux**

Install Bun 1.3.14 or newer and the native runtime libraries: SDL2, OpenGL, FreeType, and libvorbisfile. A compiled executable includes the Bun runtime; it still needs those native libraries and your game data.

From the repository:

```sh
bun install --frozen-lockfile
bun run start --content-root /path/to/qfiles
```

Starting without launch selections opens the selection menu. It does not immediately start Quake II. Use `--menu` to request the menu explicitly. The default game-data root is `~/Projects/qfiles`.

**Recommended content layout**

Game files are not bundled. Point `--content-root` at one directory containing the following game directories. Keep the original archive names and all companion files from each installation, including patches, models, textures, sounds, and music. Only install entries you own; missing products remain unavailable.

```text
qfiles/
  quake-typescript                 # optional: compiled executable
  q1/
    id1/                          # classic Quake: pak0.pak, pak1.pak
    hipnotic/                     # classic Scourge of Armagon
    rogue/                        # classic Dissolution of Eternity
    qw/                           # QuakeWorld content, including qwprogs.dat
    mymod/                        # a classic Q1 mod, kept in its own directory
    rerelease/
      id1/                        # Quake rerelease base data
      hipnotic/
      rogue/
      dopa/                       # Dimension of the Past
      mg1/                        # Dimension of the Machine
      mg3/                        # Dawn of the Machine
      ctf/
      q64/                        # Quake 64 add-on
      mymod/                      # a Q1 rerelease mod
  q2/
    baseq2/                       # classic Quake II, including loose players/
    xatrix/                       # classic The Reckoning
    rogue/                        # classic Ground Zero
    ctf/
    lmctf/
    mymod/                        # a classic Q2 mod
    rerelease/
      baseq2/                     # rerelease data, including bundled campaigns
      mymod/                      # a Q2 rerelease mod
  q3a/
    baseq3/                       # Quake III Arena: retain all installed PK3s
    missionpack/                  # Team Arena
    mymod/                        # a Q3 mod, including its PK3s and/or vm/
```

Q2 rerelease expansions use the rerelease `baseq2` content here; they do not use the classic `xatrix` and `rogue` directories. Keep classic and rerelease files separate even when their filenames match. A mod directory contains the author's package contents directly: avoid accidentally creating `mymod/mymod/` when unpacking it. Preserve dependencies and the mod's directory structure.

For a map that uses the base game's rules, put a loose BSP in that game's `maps/` directory, with its companion assets in their authored locations. For example, `q1/id1/maps/example.bsp` or `q2/baseq2/maps/example.bsp`. Keep a Q3 map's complete PK3 in `q3a/baseq3/`; it can contain required textures, shaders, arena definitions, and bot navigation. Maps that require a mod belong with that mod. A BSP filename alone does not describe its gameplay dependencies.

For file-backed Q1/Q2 CD music, the recommended location is the selected game's or mod's `music/` directory, for example `q1/id1/music/track02.ogg` and `q2/baseq2/music/track02.ogg`. Numbered `02.ogg`, `track02.wav`, and `02.wav` are also recognized. Q3 uses the paths authored by its maps or music commands; retain the supplied files and paths. Having music files installed does not make every map request a soundtrack.

Writable content is separate by default:

```text
~/.local/share/quake-typescript/
  content/                        # downloads, add-ons, and per-product overrides
    q1/id1/maps/example.bsp
    q1/mymod/
    q2/baseq2/
    q3a/baseq3/
  saves/                          # application-managed saved games
  settings/                       # application-managed settings
```

The writable `content/` tree mirrors the game-data layout, including `rerelease/` where appropriate. Change that root with `--user-content-root /path/to/writable-content`. Mods can live there without changing the installed base data. Startup scripts such as `config.cfg` and `autoexec.cfg` are loaded from the selected content, so existing personal configs can affect a launch. LLM credentials and preferences use the separate executable-directory rules below.

Directory discovery does not establish full mod compatibility. QuakeC, QVM, native modules, rerelease interfaces, and independently mixed mod components are tracked under T10. Inspect discovery and available options with:

```sh
bun run start --content-root /path/to/qfiles --list-content
bun run start --help
```

**Build an executable**

```sh
bun run build
```

The Linux build runs type and source-policy checks against an immutable source snapshot, compiles the runtime, and checks that its inputs stayed unchanged. It prints the output directory; `dist/runtime.json` records the executable location and checksums.

Run `quake-typescript` from that output directory:

```sh
./quake-typescript --content-root /path/to/qfiles --menu --renderer gl --gamma 1.3
```

Use `--renderer cpu` for software rendering. Gamma defaults to 1; higher values brighten the final image.

**Controls, console, and LLM setup**

Open **Options → Controls → Bindings (Player 1)** before starting a map. One searchable, scrollable table shows each action and its current keys. Select a key to capture its replacement directly; use **Add** for another binding. Existing profile bindings are preserved. Right mouse is `MOUSE2`; middle mouse is `MOUSE3`.

**Options → Controls** shows numeric slider values, including overall sensitivity and horizontal/vertical multipliers. Invert mouse is separate. In the console, `bind mouse2` shows its current command and `bindlist` lists bindings. Startup control edits persist and settings scroll. See [execution status](docs/execution-status.md#installed-executable-and-recent-fixes) for the installed build and its verification limits.

In the console, Tab/Shift+Tab completes commands and inserts `/`. Use `find <text>` and `help <name>`. Up/Down recalls history; PageUp/PageDown scrolls output.

Under **Options > LLM options**, choose **ChatGPT Subscription**, **ChatGPT API**, or **Other API**. Subscription uses **Sign in with ChatGPT** in your browser; API providers use **Paste API key**. Open **Model** to choose from the provider’s paginated list, choose a supported **Reasoning effort** (or **Model default**), then **Save settings**. **Refresh models** reloads the list; signing in or saving an API key loads it automatically. A subscription may supply a recommended default; API model selection is explicit. Other API also needs **Base URL** and uses OpenAI-compatible Chat Completions.

Files live beside the compiled executable, or in the working directory when running source. `chatgpt.key` independently stores the API key and OAuth credentials, including refresh credentials. `other.key` stores the other provider's key; `other.service` is JSON containing `baseUrl`, `model`, and `transport`. `llm.json` stores preferences.

Use `llm_ask "How do I change mouse sensitivity?"` to print an answer in your console. Use `llm_exec "Set mouse sensitivity to 4"` to request console commands. `llm_cancel` cancels the pending request in your console. The request includes the available command and setting documentation. The complete returned batch is validated before any command runs; the console prints the commands and their results in the invoking seat's context. Structurally invalid or unknown commands reject the whole batch before execution. Normal command handlers still validate their arguments and permissions; an execution error does not roll back commands that already ran.

Only direct local console input can start LLM requests. Scripts, aliases, key bindings, game modules, and server commands cannot trigger them. Closing the session cancels pending requests. API requests use the selected provider and may incur that provider's charges.

**Selections and current limits**

The menu offers installed campaigns and starting maps, movement, character source and model, weapons, supported monster replacements, grapple placement, and offhand grenades. It resolves these choices through the same content and recipe system used by the application. Unsupported combinations can still fail preflight or return a runtime error to the menu.

- Independent base Q1, Q2, and Q3 arsenals have supported mixed-game paths. This does not mean every edition, expansion, or combination works.
- Pickups retain their authored placement and feed the selected arsenal through explicit supply mappings. Independent pickup replacement is not implemented.
- **Multiplayer > Find servers** offers LAN discovery, direct addresses, favorites, and connection controls. Native-protocol interoperability still has restrictions.
- Shared save support includes implemented Q1, Q2, and Q3 simulation paths. Original save-format interoperability and complete provider coverage remain part of T16.
- Audio, lighting, effects, and full gameplay parity remain under development.

Generated menu artwork is present in the source. The complete menu asset pack may not be available until the first release. Packaging it in a PK3 or another archive is planned; the format is not final.

**Current work**

The [shared functional task list](docs/functional-targets/status.md) is the completion authority: **9 of 23 targets are complete; T10 is active**. Recent accepted work includes mixed-game networking, server discovery and administration, persistent controls/profiles, and startup command routing. Installed executable `3ef462f` includes the accepted T07/T09 changes; its final-binary check covered `--help`, not a new full playthrough.

T10 work in progress covers shared execution of mods, rerelease module interfaces, independently selectable weapon behavior, and community-map compatibility. Sample mods and maps are used to find general defects. They do not establish arbitrary-mod compatibility, and unpublished integration work is not included in the installed executable. Full gameplay parity, performance, and the remaining functional targets are still open.

**Development**

```sh
bun run typecheck
bun run policy
bun test path/to/relevant.test.ts
```

User-visible feature, command, configuration, and directory changes should update this README in the same delivery. Keep implementation progress and qualification details in the linked task/status documents.

The project enforces strong typing and source boundaries, including restrictions on unsafe casts and `any`. Some tests need installed game data or native platform libraries. Use checks appropriate to the code you change; a passing focused test does not establish full game compatibility.

**License**

The engine code is licensed under GNU GPL version 2 or later; see [LICENSE](LICENSE). Existing source headers retain attribution and any applicable terms. Original game data is separate and is not relicensed by this repository.
