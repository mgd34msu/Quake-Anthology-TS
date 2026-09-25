# Quake Anthology

Quake Anthology brings Quake, Quake II, and Quake III gameplay into one engine and executable, written in strict TypeScript and run or compiled with Bun. Movement, characters, weapons, monsters, and equipment share the same world and actor systems, with source-specific behavior retained where it matters.

This is an unfinished engine project. Mixed configurations work, but complete interoperability, content coverage, rendering fidelity, and release qualification are still in progress. This repository is not a finished replacement for every original game or mod.

Quake and Quake II **Classic** components must preserve their original gameplay, feedback, and presentation. Rerelease additions belong to the selected rerelease component; sharing engine code must not enable them in an all-classic setup. Mixed games retain each selected component's behavior. This is a fidelity requirement, not a claim that every path has already been verified.

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
    ctf/                          # original Threewave CTF, including the Morning Star
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

**Play a game → Custom game → Mods** opens a searchable list with each component's source and Enabled/Disabled state. Enable compatible components individually; conflicting selections report both names and retain the previous selection. The existing declared projectile components are connected to this menu. General gameplay adapters remain in progress, so the list does not yet expose arbitrary installed mod features. `--mod PRODUCT/COMPONENT_ID` can be repeated for compatible components. This menu is included in the installed executable.

Native Q3 mod inventories can use the module's original item table for weapon names, selection numbers, and ammo. Threewave 1.7 has a verified built-in declaration; other static tables can provide `qvm-items.json`. See [mod compatibility](docs/mod-compatibility.md#quake-iii-mod-inventories) for the format and current limits. This is included in the installed executable.

**Choosing a mod and map independently**

In **Play a game → Custom game → World**, choose the game or mod for its rules and **Map content** for the installed product that supplies the map. The command-line equivalent is `--game PRODUCT --map-game MAP_PRODUCT --map MAP`. Omitting `--map-game` uses the selected game's maps.

Current source preserves a native QuakeWorld or Q3 mod's movement and character defaults when opening the custom-game menu. Explicit component selections stay selected, and the native source remains available in the picker. Classic Q1 and Q2 defaults remain classic. This menu correction is newer than installed `0bc6e85`.

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

Packages can declare independent gameplay components in `gameplay-mods.json`, with each component referring to its own callback declaration. A missing or outdated declaration marks that component unavailable without hiding valid components in the same package. Game-type entries remain separate from additions. QuakeC, QVM, and declared Q2 native adapters bind original compiled functions to shared damage, actor, and inventory operations. Every enabled component owns separate source state, registrations, and checkpoints. Artifact and declaration changes are checked when loading a save; a missing mod checkpoint is rejected. Declared native components also retain their own allocated actors, scheduled updates, collision and source saves. Component sounds remain independent when several mods affect the same actor. Declared native owned actors receive shared attacks through their original damage routines. Native components now bind declared client inventory fields and original client lifecycle calls. Owned native armor preserves original damage calculations and saved state. Declared native inventory capacities are also installed: original count and capacity changes commit together when the destination inventory owns mutable limits. Fixed-limit source owners remain unsupported. Complete original movement/weapon loops, custom effects, and remaining host services are under development. See [component declarations and limits](docs/mod-compatibility.md#independent-components) for the supported scope.

QVM components can keep their own output files under the user-content directory at `.mods/PRODUCT/COMPONENT_ID/` (each name is URL-encoded). Reads, scripts and file lists see that component's output before its installed files; other components and original packages remain separate. Saved file handles resume through the existing QVM file service. This file support is included in the installed executable.

Declared QVM components connect to actual player identities, userinfo changes, accepted input, and disconnects. Private source client numbers stay separate from destination players; targeted messages retain their recipient through networking and demos. Saved commands and source client state survive loading. Original LRCTF callbacks were exercised in a Q1 world with Q2 movement and Q3 Ranger. QuakeC components now share player lifecycle, userinfo and targeted messages through explicit original callbacks, with private client state preserved in saves. Native API3/API2023 components now also use original client admission, userinfo, command and disconnect calls. Rejected clients retain their physical source row until disconnect, preventing reuse while collision still refers to it. These client integrations are included in the installed executable. Declared component callbacks on applied input are also installed.

The installed shared input service exposes input as movement actually applies it across the five shared movement profiles, including source timing and command subdivisions. Source commit `0808144` additionally observes original Q2 classic and rerelease input execution, preserves changes to the actual moving body, and safely retires a player removed during a callback. Source commit `06ba62f` also observes actual LRCTF and Threewave QVM movement, including retained commands and safe client removal. Both source input adapters are installed. Internal spawn-settling movement is excluded. Other module profiles remain in progress. Source commit `23b3a90` adds declared QuakeC, QVM and native component callbacks before or after actual command and movement-slice execution. It supplies current aim, buttons, duration and ground state, preserves nested source calls, and cleans up removed players. Original Copper, Threewave and both native Q2 interfaces passed focused checks. Full replacement of movement or weapon loops still requires each source routine's remaining services.

QuakeWorld components now route original sound, particles, muzzle flashes and signon messages through destination clients and visibility. A disconnected recipient's queued messages cannot reach a player who reuses its slot. These changes are installed. Original QuakeWorld aiming and shotgun firing also work against destination collision, with source team and `noaim` behavior retained. Full weapon and protocol compatibility remain separate work.

The installed executable shares one Q1 punch vector between addon shake and weapon recoil across movement selections. It decays once, survives saves, and composes with native Q2 and Q3 camera behavior. Screenshake view-roll cleanup now updates the selected source view field without clearing punch or changing input.

Source input callbacks can now change or consume controls before the selected movement and weapon systems use them. Declarations identify original handler decisions, changed input fields, or original command storage; received input stays unchanged for replay. This works through shared movement and the qualified original native/QVM client boundaries. Original Hipnotic and Threewave jump decisions and native classic/rerelease held-fire loops have focused runtime checks. Complete source player/weapon composition and component client effects remain in progress. These changes are committed and installed in `af904e4`. The exact executable passed original Threewave GL movement, firing, armor, save/load and normal quit. The original native loops and mixed-profile input changes have separate source runtime checks; full campaigns remain unqualified.

Regular armor and powered protection have independent owners. Current source lets declared QuakeC, QVM and native components provide either or both through their original absorption routines. The original mod decides savings and debits on every hit, including live changes to its rules; the engine does not substitute a fixed protection percentage. Different components may supply the two layers. Replacing a primary game's layer requires an explicit declaration; a competing component cannot silently take it over. Disabling a component reveals the primary's current armor. Qualified source damage stages preserve original health, momentum and reactions. Selected equipment protection now runs at the shared damage boundary, including original QC, QVM and native calls, after mod damage transformations. Its original protection rule controls rejection; blocked hits do not execute the underlying damage function. Rerelease Bandolier, Ammo Pack and accepted ammo grants also run the original automatic power-armor check against the retained native cell supply. Classic pickup rules remain separate. Native Q2 movement now accepts equipment speed changes and fixed invulnerability poses, including expiry back to normal movement.

Native module memory access now reuses checked views and avoids temporary arrays for accesses within one mapping. A bounded original Q2 rerelease loading sample fell from 5.537 to 5.091 seconds; this does not establish gameplay frame rates or complete map-transition performance. This source change is newer than the installed executable.

Selected Q3 and Team Arena equipment now runs in qualified original native Q2 and Threewave worlds. Medkits, teleporters and persistent items keep their original equipment behavior while the world supplies player health, spawn selection and objective drops. Invulnerability changes movement without stopping weapon input. Guard armor grants preserve existing armor ownership and use the destination's authored armor type when starting empty. Queued item use survives saves. The native inventory includes these items and declared component items even when keeping the world's original weapons. Ordinary use/drop commands call the item owner's original functions; component weapons retain their existing source selection rules. Authored item names and icons survive saves and remote transport, and colliding names resolve through explicit item IDs or the native world's admitted item owner. These source changes are newer than the installed executable.

Saves remain `QTSAVE3`, with a provider record preserving hidden engine-owned primary armor. Original modules keep their own source saves. Version-2 saves still load, while older executables cannot read new saves. Current source negotiates `qts:snapshot-v7` with frame version 9 for component presentation, cameras, native HUDs and source-owned item icons; captured frame versions 2–8 still decode. Native game protocols are unchanged. See [mod compatibility](docs/mod-compatibility.md#independent-components) for qualified source layouts, declaration rules and remaining limits. Installed `af904e4` includes this regular/powered integration and original QuakeC/QVM/native stages. The exact compiled build passed original Threewave movement, firing, armor and save/load; public cross-game mod startup and save/load were checked separately through the Application. Full source player/weapon composition remains unfinished.

Source checkpoint `c8d45da` corrects the original Threewave armor points and tier fields, including its mode-dependent protection. Qualified QVM HUD armor now comes from the combat binding. Existing saves migrate only when their old projection exactly matches the restored original module; new saves retain strict mismatch checks. This correction is included in the installed `af904e4` executable.

QVM integration now supports observing committed memory writes from the interpreter and migrated host services through one allocation owner. Observers receive detached before/after bytes for requested ranges, including writes through previously borrowed views. Retired modules reject further writes, and restore/restart invalidate old observations. This write tracking is included in installed `af904e4`. Armor composition uses the same committed stores to preserve nested hits and changes to both armor layers.

QuakeC components can also declare original per-client frame calls. Retained controls drive original held-fire code; declared source think deadlines advance private weapon state and survive saves. This change is installed in `7bd9461`. Full source physics ordering remains separate work.

Newer source lets QuakeC components add their own weapons and ammo, or explicitly replace primary inventory entries. Ordinary `use`, weapon cycling and the existing weapon list select those weapons. The original mod controls firing, ammo consumption, animation and refusal to switch; a committed attack finishes before another source takes over. Saves preserve source inventory, hidden primary entries and pending switches. Original Copper was exercised in a Q2 Application through selection, firing and save/load during a shot. Declared native component item adapters are also installed. Further source artifacts and behaviors require matching declarations. See [source-owned items and weapons](docs/mod-compatibility.md#source-owned-items-and-weapons).

Newer source also tracks each component's presentation lifetime. Disabling it removes its static models, ambient voices and persistent overrides, while delayed media loads cannot publish into a replacement activation. Saves retain that ownership. Unified peers negotiate snapshot version 8; captured versions 2–7 remain readable. Older saves with ambiguous primary/component persistent output report the missing ownership information. See [presentation ownership and legacy limits](docs/mod-compatibility.md#component-presentation-ownership). This change is included in the installed executable.

Declared QuakeC, QVM and native components can supply original pickup functions for armor and admitted inventory items. Their original code decides acceptance, tier changes and limits; the map keeps its feedback, targets and respawning. A pickup can change several admitted ammo counts, limits and protection channels in one original operation. Full-set ownership is checked before execution; Xatrix Bandolier/Pack pickups and save/load are qualified. Additional native item adapters and pickup kinds remain unfinished. Qualified original Q3 and Threewave primary games now route these grants through their original pickup callers, with canonical weapon/ammo inventory backed by original VM storage. A public Threewave game check covers physical armor/ammo touches, save/load and older-save migration. Original classic id1 armor and ammo callers now retain their feedback, targets and respawn timing while using selected mod grants. Public dedicated save/load preserves the item and grant state. Qualified original Xatrix and Q2 rerelease primary callers also route armor/ammo grants through the same admission, while shared inventory reads and writes their live source counts and capacities. Public checks cover physical pickups and save/load in both original DLLs; older native inventory saves migrate from source storage. Other QuakeC pickup kinds/artifacts, additional native artifacts and additional foreign item catalogs still need integration. See [declarations and remaining limits](docs/mod-compatibility.md#original-pickup-operations). The original-primary QVM, QuakeC and native caller additions are installed in `f96d9a9`.

Declared QVM components run their original client code for player-event sounds and effects. Each viewing seat keeps separate mod client state; source models, shaders, lights and sounds join the selected world. Source frame routines control effect lifetimes, and retiring one mod leaves other mods' sound channels intact. Current source also supports declared original scene snapshots, HUD output, client commands, writable mod files, owned music cues, cinematic traps and unified remote component presentation. See [original component presentation](docs/mod-compatibility.md#original-qvm-component-sounds-and-effects) for the qualified interfaces and remaining limits. Remote presentation and saved client continuation are included in installed `55c82c88`.


The installed `55c82c88` executable applies original mod shader remaps using the mod's own images while retaining the destination map's lightmaps. Disabling a mod restores the surviving shader owner; restoring a save retains the accepted remap order. Pending loads cannot apply after their client or source retires. Local player removal also closes that player's presentation and input without redirecting another player's controls. The compiled build passed an original Threewave session covering movement, firing, armor and save/load. It also includes the classic Q2 damage-feedback correction described below.

Cinematic continuation has exact decoder, movie-handle and owned-audio checkpoints, checked against original RoQ and OGV playback. New shared saves also preserve original component client memory, resource handles, fonts, scripts and clocks without replaying client initialization. Active component fullscreen movies resume their saved frame, audio and pause state; completion uses their own current `nextmap` once. Loading stages these clients and movies before publishing them. Older saves without client checkpoints rebuild presentation and explain that limitation. Native campaign movie saves and remote client saves retain their existing restrictions.

Unified multiplayer now sends admitted original component state to each viewer, whose original mod client draws its own HUD and effects. Delayed frames wait for the matching source identity and reliable updates; disconnecting or disabling a mod retires its clients and pending commands. Component scripts retain their own cvars and files, while engine commands such as `bind`, `unbind` and movement buttons reach the actual input handler. An original Threewave two-viewer transport check passed; a full foreground multiplayer playthrough remains unverified. These changes are included in installed `55c82c88`.

The installed `434a4d3e` executable admits selected Q1/Q2/Q3 arsenals in the qualified original Threewave game, including expansion weapons. Original movement and game rules stay active while selected weapons retain firing, ammo, switching, saves, death drops and respawn. The original client controls weapon/HUD visibility and supplies the held-weapon attachment and powerup effects. Other original server artifacts still need matching source contracts. Qualified Xatrix and retail rerelease primary arsenals are also installed, as described below. See [selected arsenals in original games](docs/mod-compatibility.md#selected-arsenals-in-original-games).

Native rerelease components can also draw their original world text and debug shapes. Each component keeps its own content, source timing and lifetime; disabling one clears its drawings without removing another's. These changes are included in installed `434a4d3e`. Its compiled original Threewave GL movement/fire/armor/save-load-save/quit check passed; the selected-arsenal and drawing checks are separate source-level Application/ABI evidence.

Source now transfers qualified original mod body materials onto the selected character: shader passes reuse its current pose, invisibility controls the base model, and disabling a mod removes only its own effects. Original Xatrix and retail Q2 pickup callers also retain weapon-stay and respawn rules while exposing source-decided weapon/ammo supply to selected arsenals. These changes and the qualified native-primary arsenal integration are installed in `ab3e3adf`.

Declared native API3 and API2023 components can now add source-owned items and weapons to the shared inventory and weapon selection. Original code controls ammo, firing, queued attacks, switching and refusal. Saves retain pending switches and source state; disabling a mod during an attack retires its ownership safely. Multiple items may share an original ammo-capacity field. Original Xatrix and q2eaks checks cover these paths. Other DLLs need declarations for their exact artifacts. Qualified original native Q2 worlds now run selected Q1/Q2/Q3 arsenals. This change is installed in `ab3e3adf`.

Newer source connects those selected arsenals to the original Q2 inventory controls. Navigation, use and drops retain original eligibility rules, while names, counts and selected icons describe the actual selected items. Classic keeps its original inventory layout; rerelease keeps its own layout and selected-name timeout. Dropped weapons and ammo retain their exact identity through saves and re-pickup. Classic drop/save/re-pickup is checked; rerelease return-map cargo remains unverified. Selected equipment and general component item actions are still being integrated.

Native component cameras now preserve original view offsets, kick, field of view, visibility and edition-specific blends. Local and remote players use the same source camera policy; ordinary predicted movement remains smooth between source updates. Classic Q2 cameras do not gain rerelease damage blend. Source no-world views hide world geometry without hiding their authored models. Original Xatrix and q2eaks end-frame checks pass. Native component HUD transport now retains each recipient's original source stats, configstrings, layout and inventory. Native camera and HUD transport are installed in `ab3e3adf`. Newer source also draws rerelease localized layouts, score tables, health bars and inventory using the source clock. Classic retains its own layout rules.

Mod weapons can declare their third-person model and grip, or explicitly have no held model. QuakeC, QVM and native component item declarations use the same definition, retained through saves and networking. Native Q2 characters use their original animated attachment, including Classic MD2 and rerelease skeleton/LOD behavior. Custom weapon and carrier models supply source-mounted declarations; the engine does not guess a held model from first-person geometry. See [mod held models](docs/mod-held-models.md). Held declarations are installed in `ab3e3adf`. Newer source also sends other players' selected held-weapon metadata to remote viewers without sending their first-person pose. Native inventory selection remains in progress.

Qualified original Xatrix and retail Quake II rerelease worlds can now run selected Q1, Q2 or Q3 arsenals. Original code retains movement, attack eligibility, powerup modifiers, respawn, cheat permission and drop rules. Selected ammo and weapons survive saves and map travel. Native HUD ammo and icons follow the selected arsenal in the original layout; original health and armor remain intact. Native inventory navigation/display and qualification of further DLLs remain in progress. This change is installed in `ab3e3adf`.

Use `modcmd PRODUCT/COMPONENT_ID <command>` to address one enabled component. Its commands, cvars and `exec` scripts use that component's source rules and files. Ordinary console input keeps the active world's behavior. Disabling a component removes its pending commands and aliases. See [component console commands](docs/mod-compatibility.md#component-console-commands) for source interfaces and declaration details.

Existing projectile components also appear in **Custom game → Mods**. Choose the launcher separately under **Combat → Weapons**. The component supplies the matching projectile's trajectory; the selected launcher retains ammo, damage, impact, model, and sound. Disable the component to restore the launcher's trajectory. See [QuakeC declarations](docs/mod-compatibility.md#quakec-projectile-components), [native declarations](docs/mod-compatibility.md#native-declarations), and [QVM declarations](docs/mod-compatibility.md#qvm-projectile-components) for the existing inspection and installation commands.

Newer source adds explicit component HUD and camera controls. Native Q2 mods can overlay their original layout or replace the status display; QuakeC components can supply health/armor and source camera messages. Conflicting replacements are rejected before startup. Camera targets retain actor identity across saves and entity reuse, and disabling a component retires its pending HUD media. Original Xatrix HUD output in a Q1 world and original Quake camera save/load passed the integrated checks. QVM components can also draw declared original HUD calls, using actual fonts, pictures and model icons. Qualified native cameras and remote component HUD transport are installed. Rerelease layout drawing is also implemented in current source. Broader source artifact coverage remains in progress. This change is included in installed `0dc86b6`. See [component client presentation](docs/mod-compatibility.md#component-client-presentation).

Original id1 worlds now also support selected Q1 and Q2 arsenals in current source. Original map pickups, damage reactions, powerups and respawning continue to run, while the selected arsenal owns its weapons and expansion inventory. Saves and level travel preserve source state, including MG3's independent ammo limits. Actual Hipnotic, Rogue, MG3, classic Q2 Rogue and rerelease Q2 combinations passed focused gameplay checks. Qualified original QuakeWorld also admits selected arsenals while retaining its original deathmatch pickups, weapons-stay and powerup rules. Actual QW network command, firing, physical pickup and map travel passed. Public network saves remain unavailable; an existing server-cvar checkpoint limitation is documented. Additional QC artifacts and broader combinations remain unfinished. Qualified original Threewave, Xatrix and retail Q2 rerelease primary arsenals are also installed. This change is included in installed `0dc86b6`.

**Hook and offhand grenade controls**

In **Custom game → Equipment**, **Hook** selects **Off**, **Weapon slot**, or **Offhand**. **Hook style** selects the source implementation separately. The picker lists hook providers rather than every installed mod and combines classic/rerelease asset choices within each source-game style. **Offhand grenades** is a single **Off/On** feature; the engine selects the installed grenade assets internally.

The source picker contains Threewave for Q1, Q2 and Q3, LMCTF for Q2, and LRCTF for Q3. The Q3 adapters execute their original hook code, including pull behavior, models, sounds and saved continuation. Cross-runtime equipment integration is still being completed. These controls are included in the installed executable.

Declared original QVM components now supply weapons through the shared inventory and normal weapon selection. The original executable owns firing, ammo changes, switching and temporary-entity cleanup; its cgame renders the view weapon. Pending switches and source state survive save/load. Original Threewave in a Q1 world passed the combined Application check. Original Threewave cgame initialization and declared HUD output are now qualified separately. Graphical seat retirement is fixed. Additional artifact and equipment qualifications remain open. This change is included in installed `0dc86b6`. See [original QVM weapons](docs/mod-compatibility.md#original-qvm-items-and-weapons).

Component music follows request order across source games and local seats. Saved cues retain their activation owner, including explicit silence; disabling a mod reveals the surviving cue. Music traps run locally and are excluded from server replication. Cinematic loading now leaves shared audio untouched until the current destination activates it; retired movies cannot stop a replacement or advance its map. Exact cinematic continuation across saves and component cinematic traps are also installed. These changes are included in installed `0dc86b6`.

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

The installed executable includes these recent fixes:

- Q2 character aiming updates every frame, and Q2 weapon recoil returns to rest, including the BFG.
- Foreign monsters retain authored Quake 1 teleport encounters through map travel and saves.
- Rocket-jump knockback uses the projectile's position instead of the map bounds.
- Stock Q3 hooks attach, pull, save and release in mixed worlds. The cable uses the active character's eye height.
- Long collision traces avoid reconstructing geometry beyond an earlier wall, removing the reproduced multi-second end-map stalls without reducing collision detail.

The installed executable selects the original Morning Star and its three chain links for Threewave CTF (Quake 1), independently of the destination world. Install the original Threewave server and client packages in `q1/ctf`. Threewave 4.0 uses the 3.01 client `pak0.pak`, the 4.0 client `pak1.pak`, and the 4.0 server programs. Saved rerelease selections retain their original package. The selected Q3 cable now anchors to the current character's eye height. Both visual corrections are included in the installed executable.

Q1 colored lightmap offsets now address complete RGB samples. This fixes striped lighting in the rerelease and other Q1 maps with colored lighting, for both GL and CPU rendering.

The [shared functional task list](docs/functional-targets/status.md) records **21 of 23 targets accepted in source**. T19 is accepted with the project owner's explicit ranking-backend exception; T10 and T12 remain open. T10 is the first unfinished target. The dedicated mod menu is connected to existing components; general source adapters and simultaneous composition across game systems remain unfinished. Declared native components now route shared attacks into their original damage routines and retain owned-actor callbacks and deferred damage across saves. QVM components can consume their own declared entity additions and resume the exact parser position through saves. Native client fields, lifecycle and owned armor are connected. Qualified original QuakeC and QVM damage stages now accept borrowed powered armor while preserving original regular armor, momentum and reactions. The installed build also composes borrowed regular armor, applies original mod control changes, and runs original native held-fire loops. Original QVM client frame callbacks now run after actor updates, independently of input commands, so authored timed effects can expire correctly. Newer source also runs original component cgame snapshots for entity effects, loops and player events, with cached source publications, continuous render timing and save restoration without replay. Source item groups and declared QuakeC weapon owners now share ordinary selection and saved inventory. Persistent component output retains activation ownership; disabling a mod retires its models, ambient sound and overrides. Remaining player/weapon services, HUD/camera, QVM media services, pickup kinds and artifact layouts still need work; these integrations do not establish arbitrary mod compatibility.

T12 remains active. The selected Team Arena backend now runs original nails, proximity mines, chaingun and holdables in mixed worlds, including their models, sounds, teleportation, invulnerability and save state. Public Use reaches the selected arsenal before any weapon change. Reverse Team Arena pickups can supply selected Q1/Q2 weapons. The installed source also runs base-Q3 holdables and imports existing base-Q3 projectile saves without replacing actors or restarting explosions and fuses. Team Arena persistent pickups retain their original map item; Guard regeneration, Scout movement and base Q1/Q2 ammo regeneration use the active source and destination owners. Original Team Arena damage and firing-rate effects now apply to selected Q1/Q2 weapons, including expansion attack deadlines and saved Q2 firing progress. Custom Game now exposes supported expansion arsenals. Base-Q3 and Team Arena can select each other’s weapons while keeping the actual equipment owner, and expansion ammo pools have independent original-rule regeneration timers that survive saves. Original id1 QuakeC now runs selected Q3/Team Arena arsenals with original pickups, backpack cargo, combat reactions, equipment, saves, campaign travel and cooperative respawn. Qualified original id1 and QuakeWorld now also admit selected Q1/Q2 arsenals. Additional QC artifacts and original QVM/native primary combinations remain unfinished. T19 progression and player services is accepted with a replaceable ranking-service interface. The ranking backend is the **only permitted stub in the project**, explicitly approved for a future service; see [how that service plugs in](docs/ranking-services.md). Shared lobby creation, readiness, launch, return, and next-match handling are implemented. Local progress and records, source arena progression, and provider-based ranking account/report handling are separate implemented features.

The Custom game summary adapts to its available space so its final field stays visible.

The executable in `~/Projects/qfiles/quake-typescript` contains production source from `ab3e3adf` and was installed on September 25 (local time). It includes qualified original native Q2 selected arsenals, native component cameras and HUD transport, and source-held weapon models, alongside the earlier mod, movement and rendering changes. The compiled original Threewave GL check verified movement, firing, armor, save/load and normal quit; the restored frame and source state were inspected. Later source changes described above are not yet installed. Whole-game performance, physical audio and complete mod coverage remain unqualified. See [installed identity and runtime evidence](docs/execution-status.md#installed-executable-and-recent-fixes).

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
