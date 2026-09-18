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

For a large archive collection, extract only the distribution packages you want, then install each complete package according to its author's README. Keep supplied PAK and PK3 files intact and preserve loose companion files. Retain the original package and README so its version and dependencies remain identifiable. Selecting one DLL, QVM, `progs.dat`, or BSP from a package can omit required assets.

For a map that uses the base game's rules, put a loose BSP in that game's `maps/` directory, with its companion assets in their authored locations. For example, `q1/id1/maps/example.bsp` or `q2/baseq2/maps/example.bsp`. Keep a Q3 map's complete PK3 in `q3a/baseq3/`; it can contain required textures, shaders, arena definitions, and bot navigation. Maps that require a mod belong with that mod. A BSP filename alone does not describe its gameplay dependencies.

For file-backed Q1/Q2 CD music, the recommended location is the selected game's or mod's `music/` directory, for example `q1/id1/music/track02.ogg` and `q2/baseq2/music/track02.ogg`. Numbered `02.ogg`, `track02.wav`, and `02.wav` are also recognized. Q3 uses the paths authored by its maps or music commands; retain the supplied files and paths. Having music files installed does not make every map request a soundtrack.

Writable content is separate by default:

```text
~/.local/share/quake-typescript/
  content/                        # downloads, add-ons, and per-product overrides
    q1/id1/maps/example.bsp
    q1/mymod/
    q1/homefix/                    # progs.dat, companion assets, weapon-behaviors.json
    q2/baseq2/
    q2/rerelease/q2eaks/           # author's game_x64.dll and companion files
    q3a/baseq3/
    q3a/homing-source-built/      # authored Q3 homing component and exact QVM profile
  saves/                          # application-managed saved games
  settings/                       # application-managed settings
```

The writable `content/` tree mirrors the game-data layout, including `rerelease/` where appropriate. Change that root with `--user-content-root /path/to/writable-content`. Mods can live there without changing the installed base data. Startup scripts such as `config.cfg` and `autoexec.cfg` are loaded from the selected content, so existing personal configs can affect a launch. LLM credentials and preferences use the separate executable-directory rules below.

The source checkout includes original QuakeC and QVM mod execution, separate map selection, declared QuakeC and QVM projectile behaviors, and an artifact-qualified native Faster rockets behavior. Homefix, Copper and early Instagib have passed bounded foreign-map play/save/load workflows. Native rerelease execution is available; its performance and broader compatibility remain under active work. An installed executable may lag the source checkout. See [current delivery and open targets](docs/execution-status.md#installed-executable-and-recent-fixes).

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

**Choosing a mod and map independently**

In **Play a game → Custom game → World**, choose the game or mod for its rules and **Map content** for the installed product that supplies the map. The command-line equivalent is `--game PRODUCT --map-game MAP_PRODUCT --map MAP`. Omitting `--map-game` uses the selected game's maps.

For example, an installed LRCTF Q3 module can run locally on Q2's `base1`:

```sh
./quake-typescript --game q3-classic-lrctf --map-game q2-classic-baseq2 \
  --map base1 --movement q3 --character q3 --mode deathmatch +set bot_enable 0
```

The selected module still owns its rules and authored entity interpretation. A map must supply the entities and objectives those rules need; changing geometry does not invent missing CTF flags or mission scripts. Native clients also need a map format their original engine supports. Compatibility limits for guest modules and independent components remain below.

QuakeC mods retain their source damage calculations, inventory constants, inline models, client messages, and saved state. Homefix and Copper have completed local launch, firing, save/load, and resumed play on Q2 geometry in source checks. These are bounded compatibility results; full campaign playthroughs remain open.

Early Q3 server modules can use an explicit, artifact-pinned SDK profile. See [mod compatibility](docs/mod-compatibility.md) for the declaration format and supported boundaries. A profile must match the module's actual bytes; a mod's filename does not establish its ABI.

**Mod projectile behaviors**

A declared QuakeC or QVM trajectory, or a supported native trajectory, can run on a selected Q1, Q2, or Q3 projectile launcher. Choose the arsenal under **Custom game → Combat → Weapons**, then choose **Equipment → Projectile trajectory**. The command-line behavior selector is `--weapon-behavior PRODUCT/BEHAVIOR_ID`. The source module controls the matching projectile's trajectory and scheduled callbacks; the selected launcher retains its ammo, damage, impact, model, and sound. Saved games retain the module identity, private state, pending callbacks, and projectile attachments.

The supported Q2Eaks v0.21 native artifact offers **Faster rockets**. Installing it under `q2/rerelease/q2eaks/` makes that behavior available without a QuakeC declaration. Selection enables the author's `g_faster_rockets` setting inside the private component. For example, launch from the source checkout with Q3 weapons:

```sh
bun run start --content-root /path/to/qfiles --game q3-baseq3 --map q3dm1 \
  --movement q3 --character q3 \
  --weapon-behavior q2-rerelease-q2eaks/native:rocket-trajectory
```

The base game data and the mod must both be installed. See [native component requirements](docs/mod-compatibility.md#native-projectile-components) for the exact supported artifact. Choose **Selected weapon default** to keep the launcher's own trajectory.

For older packages without declarations, inspect the mounted program first:

```sh
./quake-typescript weapon-behavior inspect q1-classic-homefix --content /path/to/qfiles
./quake-typescript weapon-behavior declare q1-classic-homefix --content /path/to/qfiles \
  --id homefix:rocket --role rocket --fire CheckHomingRocket --activate ActivateHoming \
  --title "Homefix homing rockets"
```

This example uses Homefix's actual callback names. Use the callbacks from the selected mod's source; inspection does not infer their purpose from their names. Declarations are written atomically to `weapon-behaviors.json` in the writable mod directory. They bind an exact module digest and do not modify installed packages. `--artifact` selects another mounted program path; `--user-content` changes the tooling command's writable content root. Run `weapon-behavior --help` for the complete syntax.

Mod authors can ship `weapon-behaviors.json` beside their QuakeC package. A declaration identifies the actual compiled program and callbacks; it does not supply replacement trajectory code. Rebuilding the program changes its digest and requires a matching declaration.

These component adapters support the built-in arsenals. They do not automatically extract arbitrary weapon, monster, or rule changes, and opaque primary game modules do not yet expose these projectile hooks. Whole-module execution and independent component composition have separate compatibility requirements.

The installed `homing-source-built` package contains a QVM built from Anup Shinde's unchanged authored homing source, its original archive/README, and an exact executable profile. It can steer a selected Q2 rocket launcher, including saved-flight continuation:

```sh
bun run start --content-root /path/to/qfiles --game q2-classic-baseq2 --map base1 \
  --movement q2 --character q2 \
  --weapon-behavior q3-classic-homing-source-built/qvm:anup-homing-constant
```

The QVM profile binds its digest, executable callbacks and private entity/client layout. To install a verified profile supplied with another package, use `weapon-behavior declare-qvm PRODUCT --profile PATH --content /path/to/qfiles`; `PATH` is mounted relative to that product. Profiles describe the author's executable behavior; they are not inferred from a mod name. See [QVM component requirements](docs/mod-compatibility.md#qvm-projectile-components).

**Original Quake saves**

`save NAME` writes the shared format, including mixed-game state. For an ordinary NetQuake source session, `save NAME v5` and `save NAME v6` export original Quake formats. Mixed compositions require shared saves because the original formats cannot retain their extra state. `load NAME` detects the format; if an original save matches several installed products, use `load NAME PRODUCT_ID` to select the intended source. `help save` and `help load` show the same syntax in the console.

**Selections and current limits**

The menu offers installed campaigns and starting maps, movement, character source and model, weapons, supported monster replacements, grapple placement, and offhand grenades. It resolves these choices through the same content and recipe system used by the application. Unsupported combinations can still fail preflight or return a runtime error to the menu.

- Independent base Q1, Q2, and Q3 arsenals have supported mixed-game paths. This does not mean every edition, expansion, or combination works.
- Pickups retain their authored placement and feed the selected arsenal through explicit supply mappings. Independent pickup replacement is not implemented.
- **Multiplayer > Find servers** offers LAN discovery, direct addresses, favorites, and connection controls. Native-protocol interoperability still has restrictions.
- Shared saves retain implemented Q1, Q2, Q3, and mixed simulation state. Original Q1 v5/v6 saves are supported for ordinary NetQuake sessions. Private guest state still requires the exact source module and declared layout.
- Audio, lighting, effects, and full gameplay parity remain under development.

Generated menu artwork is present in the source. The complete menu asset pack may not be available until the first release. Packaging it in a PK3 or another archive is planned; the format is not final.

**Current work**

The [shared functional task list](docs/functional-targets/status.md) records **22 of 23 targets accepted in source**. T19 progression and player services remains open because no compatible original GRank transport/provider is bundled. Shared lobby creation, readiness, launch, return, and next-match handling are implemented. Local progress and records, source arena progression, and provider-based ranking account/report handling are separate implemented features.

Recent source work adds original Q1 save export/import, native and QVM projectile components, authored travel and mode preflight, bot navigation/save continuation, source pickup preferences, binding reset, live per-seat language, and public recording/replay. The installed executable may lag these changes. Check [the installed build identity](docs/execution-status.md#installed-executable-and-recent-fixes) before comparing behavior.

Performance work reuses MD5 poses between passes, skips unused shadow color computation, and reduces native interpreter address-check cost while preserving output. The measured gains apply to those components. Native rerelease loads are still slow, and whole-game FPS remains unqualified. [Integration scope and evidence](docs/functional-targets/integration-20260918.md) records these limits and the actual mod/save workflows.

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
