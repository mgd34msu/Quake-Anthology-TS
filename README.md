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
    q1/rerelease/mymod/           # source files, companion assets, optional component declarations
    q2/baseq2/
    q2/rerelease/mymod/           # source module and companion files
    q3a/baseq3/
    q3a/mymod/                   # complete author package and any component declarations
  saves/                          # application-managed saved games
  settings/                       # application-managed settings
```

The writable `content/` tree mirrors the game-data layout, including `rerelease/` where appropriate. Change that root with `--user-content-root /path/to/writable-content`. Mods can live there without changing the installed base data. Startup scripts such as `config.cfg` and `autoexec.cfg` are loaded from the selected content, so existing personal configs can affect a launch. LLM credentials and preferences use the separate executable-directory rules below.

The source checkout includes original QuakeC and QVM mod execution, separate map selection, declared QuakeC, QVM, and API2023 native projectile behaviors. Homefix, Copper and early Instagib have passed bounded foreign-map play/save/load workflows. Native rerelease execution is available; its performance and broader compatibility remain under active work. The current Linux executable includes these source changes. See [current delivery and open targets](docs/execution-status.md#installed-executable-and-recent-fixes).

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

**Mod interoperability requirements**

General mod interoperability remains unfinished. The required behavior includes:

- A dedicated menu for mods that do not define the game type, with individual enable/disable controls.
- Multiple enabled mods running together in one session, including mods from different source games.
- Mods from Quake 1, Quake 2, Quake 3, their expansions, and their rereleases usable in any supported destination game or mixed-game configuration.
- Shared support for authored mod behavior across weapons, monsters and AI, items, rules, events, and other game systems.

The source game must not restrict a mod to that game's worlds or equipment. Homing rockets are one example for checking interoperability. Existing projectile adapters cover part of this work; they do not establish general mod compatibility.

In the current source, **Play a game → Custom game → Mods** opens a searchable list with each component's source and Enabled/Disabled state. Enable compatible components individually; conflicting selections report both names and retain the previous selection. The existing declared projectile components are connected to this menu. General gameplay adapters remain in progress, so the list does not yet expose arbitrary installed mod features. `--mod PRODUCT/COMPONENT_ID` can be repeated for compatible components. These menu changes are not yet in the installed executable.

Native Q3 mod inventories can use the module's original item table for weapon names, selection numbers, and ammo. Threewave 1.7 has a verified built-in declaration; other static tables can provide `qvm-items.json`. See [mod compatibility](docs/mod-compatibility.md#quake-iii-mod-inventories) for the format and current limits. This source change is not yet in the installed executable.

**Choosing a mod and map independently**

In **Play a game → Custom game → World**, choose the game or mod for its rules and **Map content** for the installed product that supplies the map. The command-line equivalent is `--game PRODUCT --map-game MAP_PRODUCT --map MAP`. Omitting `--map-game` uses the selected game's maps.

Select a movement family with `--movement q1`, `q2`, or `q3`, or an exact installed product such as `--movement q2-rerelease-baseq2`. `--movement qw` selects `q1-quakeworld`, including its command timing. For example:

```sh
./quake-typescript --game q1-classic-id1 --map e1m1 \
  --movement qw --character q3 --model ranger
```

These movement selectors are included in the current executable and use the same normalized selection as the menu and restored saves.

For example, an installed LRCTF Q3 module can run locally on Q2's `base1`:

```sh
./quake-typescript --game q3-classic-lrctf --map-game q2-classic-baseq2 \
  --map base1 --movement q3 --character q3 --mode deathmatch +set bot_enable 0
```

The selected module still owns its rules and authored entity interpretation. A map must supply the entities and objectives those rules need; changing geometry does not invent missing CTF flags or mission scripts. Native clients also need a map format their original engine supports. Compatibility limits for guest modules and independent components remain below.

QuakeC mods retain their source damage calculations, inventory constants, inline models, client messages, and saved state. Homefix and Copper have completed local launch, firing, save/load, and resumed play on Q2 geometry in source checks. These are bounded compatibility results; full campaign playthroughs remain open.

Early Q3 server modules can use an explicit, artifact-pinned SDK profile. See [mod compatibility](docs/mod-compatibility.md) for the declaration format and supported boundaries. A profile must match the module's actual bytes; a mod's filename does not establish its ABI.

**Independent mod components**

Packages can declare independent gameplay components in `gameplay-mods.json`, with each component referring to its own callback declaration. A missing or outdated declaration marks that component unavailable without hiding valid components in the same package. Game-type entries remain separate from additions. QuakeC, QVM, and declared Q2 native adapters bind original compiled functions to shared damage, actor, and inventory operations. Every enabled component owns separate source state, registrations, and checkpoints. Artifact and declaration changes are checked when loading a save; a missing mod checkpoint is rejected. Declared native components also retain their own allocated actors, scheduled updates, collision and source saves. Component sounds remain independent when several mods affect the same actor. Native owned-actor combat and inventory, custom effects, and remaining host services are under development. See [component declarations and limits](docs/mod-compatibility.md#independent-components) for the supported scope.

Use `modcmd PRODUCT/COMPONENT_ID <command>` to address one enabled component. Its commands, cvars and `exec` scripts use that component's source rules and files. Ordinary console input keeps the active world's behavior. Disabling a component removes its pending commands and aliases. See [component console commands](docs/mod-compatibility.md#component-console-commands) for source interfaces and declaration details.

Existing projectile components also appear in **Custom game → Mods**. Choose the launcher separately under **Combat → Weapons**. The component supplies the matching projectile's trajectory; the selected launcher retains ammo, damage, impact, model, and sound. Disable the component to restore the launcher's trajectory. See [QuakeC declarations](docs/mod-compatibility.md#quakec-projectile-components), [native declarations](docs/mod-compatibility.md#native-declarations), and [QVM declarations](docs/mod-compatibility.md#qvm-projectile-components) for the existing inspection and installation commands.

**Hook and offhand grenade controls**

In **Custom game → Equipment**, **Hook** selects **Off**, **Weapon slot**, or **Offhand**. **Hook style** selects the source implementation separately. The picker lists hook providers rather than every installed mod and combines classic/rerelease asset choices within each source-game style. **Offhand grenades** is a single **Off/On** feature; the engine selects the installed grenade assets internally.

The source picker contains Threewave for Q1, Q2 and Q3, LMCTF for Q2, and LRCTF for Q3. The Q3 adapters execute their original hook code, including pull behavior, models, sounds and saved continuation. Cross-runtime equipment integration is still being completed. These changes are not yet in the installed executable.

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

Q2 classic and rerelease movement now apply ground friction on Q1 maps. The shared collision adapter supplies ordinary surface metadata, so releasing movement keys stops the player in both Q1 editions.

Q1 colored lightmap offsets now address complete RGB samples. This fixes striped lighting in the rerelease and other Q1 maps with colored lighting, for both GL and CPU rendering.

The [shared functional task list](docs/functional-targets/status.md) records **20 of 23 targets accepted in source** after reopening T10 for the general mod interoperability requirements above. T10 is the first unfinished target. The dedicated mod menu is connected to existing components; general source adapters and simultaneous composition across game systems remain unfinished. Its existing native weapon declarations and component save/load workflow cover a narrower part of that requirement.

T12 is active again: supported expansion arsenals still need menu integration, and Team Arena weapon/supply mixing has unfinished backend paths. T19 progression and player services remains open because no compatible original GRank transport/provider is bundled. Shared lobby creation, readiness, launch, return, and next-match handling are implemented. Local progress and records, source arena progression, and provider-based ranking account/report handling are separate implemented features.

The Custom game summary adapts to its available space so its final field stays visible.

The current executable includes original Q1 save export/import, declared native and QVM projectile components, exact movement-product selection, the complete projectile behavior picker, and bounded collision-cache reuse. Its build/source guards and `--help` passed; the latest compiled gameplay check belongs to the preceding executable. See [installed identity and runtime evidence](docs/execution-status.md#installed-executable-and-recent-fixes) for the delivery and its qualification limits.

Performance work reuses MD5 poses between passes, skips unused shadow color computation, rejects off-camera MD3 preparation conservatively, removes redundant MD2 vertex wrappers, and reduces native interpreter address-check and instruction-fetch cost while preserving output. Q1 collision also reuses bounded, exact clip geometry for repeated queries; its recorded-query replay improved modestly without changing collision results. Newly qualified source also avoids redundant split classification using exact cell bounds and shares verified archive handles during mod discovery. Those changes reduced collision replay and discovery costs in their separate measured workloads. The measured gains apply to those components. Native rerelease loads are still slow, and whole-game FPS remains unqualified. [Integration scope and evidence](docs/functional-targets/integration-20260918.md) records these limits and the actual mod/save workflows.

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
