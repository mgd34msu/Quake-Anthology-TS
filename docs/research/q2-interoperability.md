Read-only Quake II interoperability assessment, 2026-09-10.

The source in /home/buzzkill/Projects/quake-2-re-ts at commit 0d73750 records a useful intended contract for the unified game: content edition, map selection, game logic, client presentation, and protocol have different responsibilities. The implementation supports meaningful crossings in both directions. Its remaining omissions also show why map loading and spawn-table coverage cannot establish full singleplayer or multiplayer completion.

Subsystem selection must compare the actual Q1, Q2, and Q3 implementations. Each port contains improvements worth carrying forward, including where another port already has an equivalent subsystem. Q3's stronger types and ownership patterns can guide a shared design where the comparison supports them. Q2's working bindings, content selection, mount identity, protocol adaptation, and presentation paths remain candidates for direct adoption or integration. The original game source and authored data define native behavior; accidental TypeScript errors, incomplete adaptations, stale comments, and old test baselines do not become fidelity requirements.

This pass read current source, tests, planning history, and relevant commits, then checked the original re-release C++ at /home/buzzkill/Projects/quake2-rerelease-dll, commit 8dc1fc9794c01ece06881e703851b768fb3994de. It changed no source files and ran no game boot, renderer, or long test suite. One short Bun process exercised the actual in-memory save serializers and reproduced four losses described below. Historical verification claims are identified as historical; they were not rerun.

The existing choices already answer the architecture questions.

| Choice | Current source behavior | Consequence for the unified game |
| --- | --- | --- |
| Content | Campaign or map set, including baseq2, Xatrix, Rogue, CTF, Call of the Machine, Q64, and LMCTF. | A map set does not select movement, weapons, or match rules. |
| Edition | Original and re-release roots are discovered independently. | Asset identity needs a source root or mount generation, not just a filename. |
| Ruleset | Classic chooses the appropriate statically ported legacy module. Re-release usually chooses kexgame, which contains the merged official content. | Keep native game behavior in a module with an explicit contract. |
| Map source | KEX on original data prefers original maps while re-release assets win elsewhere. | Preserve the requested geometry and the selected ruleset's asset precedence separately. |
| Protocol | Narrow classic negotiates 34, 35, or 36. KEX uses 1038. Widened classic uses the private 4038 protocol. | Protocol width is not the ruleset. |
| Client | 4038 selects classic HUD and prediction with wide configstrings. 1038 selects KEX HUD and prediction. | Negotiate presentation and movement semantics explicitly as the unified design grows. |
| Multiplayer mode | Campaign, coop, deathmatch, CTF, and mod-specific modes have independent cvars and launch setup. | Include complete mode behavior, not merely more connected clients. |

The content/ruleset distinction is implemented in [menu_content.ts:757](/home/buzzkill/Projects/quake-2-re-ts/src/client/menu_content.ts:757). The edition and asset rules are stated beside the actual [DataMountPlanFor implementation](/home/buzzkill/Projects/quake-2-re-ts/src/client/menu_content.ts:885). The server's concrete module dispatch is in [legacy.ts:903](/home/buzzkill/Projects/quake-2-re-ts/src/server/bindings/legacy.ts:903) and [kex.ts:1297](/home/buzzkill/Projects/quake-2-re-ts/src/server/bindings/kex.ts:1297).

Edition detection is a filesystem boundary, while gameplay adaptation happens after loading the selected map. [FS_RootIsRerelease](/home/buzzkill/Projects/quake-2-re-ts/src/qcommon/files.ts:552) checks for baseq2/pak0.pak and Q2Game.kpf. Startup can discover a re-release child of a classic installation at [files.ts:526](/home/buzzkill/Projects/quake-2-re-ts/src/qcommon/files.ts:526) and [files.ts:2494](/home/buzzkill/Projects/quake-2-re-ts/src/qcommon/files.ts:2494). These are detection heuristics for installed data, not proofs that a selected map uses a particular entity dialect.

All launches use the ordered command chain in [LaunchCommandString](/home/buzzkill/Projects/quake-2-re-ts/src/client/menu_content.ts:407): stop the server, wait, select the game, remount data, mount auxiliary maps if requested, wait, load the map. This order prevents a latched game cvar from remounting the previous module's content. [PerformLaunch](/home/buzzkill/Projects/quake-2-re-ts/src/client/menu_content.ts:312) clears deathmatch and stale CTF/teamplay state for a campaign. Extra local seats select coop and increase maxclients.

The first concrete crossing is the re-release base1 map under classic rules.

1. The launch resolves to `game ""` and `data_root rerelease`. Classic rules use the selected edition alone. [menu_content.ts:885](/home/buzzkill/Projects/quake-2-re-ts/src/client/menu_content.ts:885)
2. `LoadLegacyGame` selects the original base game implementation. Its imports supply the classic engine `Pmove`, while the engine provides collision, indexing, and presentation extensions. [legacy.ts:249](/home/buzzkill/Projects/quake-2-re-ts/src/server/bindings/legacy.ts:249)
3. Before spawning, the server scans the map's actual entity lump for fields that require wide presentation. Re-release base1 contains dynamic lights and shadow-light data. The server widens the session before `SpawnEntities`. [sv_init.ts:629](/home/buzzkill/Projects/quake-2-re-ts/src/server/sv_init.ts:629)
4. Classic `ED_ParseField` fills added fog, brush animation, monster, and entity-state fields. `ED_CallSpawn` checks the local item table before the local spawn table. The re-release additions are real functions ported into this tree. [g_spawn.ts:325](/home/buzzkill/Projects/quake-2-re-ts/src/game/g_spawn.ts:325), [g_spawn.ts:161](/home/buzzkill/Projects/quake-2-re-ts/src/game/g_spawn.ts:161), [g_spawn.ts:843](/home/buzzkill/Projects/quake-2-re-ts/src/game/g_spawn.ts:843)
5. Classic game logic retains its own movement and timing. The binding remaps raw configstring indices and pickup/chase indices embedded in player stats. It mirrors fixed-point movement coordinates into the floats required by the wide wire format, without adding precision to classic simulation. [legacy.ts:369](/home/buzzkill/Projects/quake-2-re-ts/src/server/bindings/legacy.ts:369), [legacy.ts:876](/home/buzzkill/Projects/quake-2-re-ts/src/server/bindings/legacy.ts:876)
6. The server announces 4038. The client selects the classic HUD and classic movement prediction with the wide layout. Fog, world text, POIs, health bars, alpha, scale, and shadows can therefore reach the presentation code without choosing KEX combat. [cl_parse.ts:530](/home/buzzkill/Projects/quake-2-re-ts/src/client/cl_parse.ts:530), [cl_pred.ts:486](/home/buzzkill/Projects/quake-2-re-ts/src/client/cl_pred.ts:486)
7. Re-release progression semantics are added where the map needs them. Landmark-relative exits preserve the activator's relative position, velocity, and view angles. The destination rotates them into its landmark frame. Cross-unit flags have independent saved storage. [g_target.ts:346](/home/buzzkill/Projects/quake-2-re-ts/src/game/g_target.ts:346), [p_client.ts:1424](/home/buzzkill/Projects/quake-2-re-ts/src/game/p_client.ts:1424), [g_kextarg.ts:1411](/home/buzzkill/Projects/quake-2-re-ts/src/game/g_kextarg.ts:1411)

This is a tested scenario, with limited claims. [legacy_base1_rerelease_boot.test.ts:165](/home/buzzkill/Projects/quake-2-re-ts/test/legacy_base1_rerelease_boot.test.ts:165) asserts legacy game family, wide layout, campaign mode, and real bound door/button/elevator models. Its deathmatch rerun verifies that those same entities disappear because their authored spawnflags inhibit them, not because model adaptation failed. [test line 270](/home/buzzkill/Projects/quake-2-re-ts/test/legacy_base1_rerelease_boot.test.ts:270)

Call of the Machine exercises the harder form of this direction. `mgu4m1` requires the coop-only start and drop-pod script to be inhibited in singleplayer. Classic `SpawnEntities` now implements that rule; NOT_COOP is gated by the session's content-derived wide-layout signal to preserve original-map behavior. [g_spawn.ts:1096](/home/buzzkill/Projects/quake-2-re-ts/src/game/g_spawn.ts:1096) Original-map spawn fallbacks are also preserved until their original path cannot find a spot. The added coop fallback fixes `mgu6m1`, but its commentary and code retain limitations around lava starts and occupied coop spots. [p_client.ts:1497](/home/buzzkill/Projects/quake-2-re-ts/src/game/p_client.ts:1497)

The second concrete crossing is original base1 or xswamp geometry under KEX rules.

1. The plan selects `game kex` and `data_root rerelease classic maps=classic`. Re-release textures, sounds, models, icons, fonts, and required KEX-only assets win. Original maps win the maps/ lookup. [menu_content.ts:892](/home/buzzkill/Projects/quake-2-re-ts/src/client/menu_content.ts:892)
2. The filesystem attributes each mount to its deepest containing data root. This matters when the re-release tree is nested beneath the classic tree. The maps preference scans only mounts owned by the classic root before using normal fallback. [files.ts:359](/home/buzzkill/Projects/quake-2-re-ts/src/qcommon/files.ts:359), [files.ts:985](/home/buzzkill/Projects/quake-2-re-ts/src/qcommon/files.ts:985)
3. Map preference is a priority rule, not an exclusion rule. A map absent from classic data, such as mguhub, remains reachable from the mounted re-release data. [data_root.test.ts:263](/home/buzzkill/Projects/quake-2-re-ts/test/data_root.test.ts:263)
4. The original entity text is handed directly to the KEX module. Shared classnames resolve to KEX implementations. Its unified item table includes the official expansions, and its narrow legacy-name aliases cover weapon_nailgun, ammo_nails, and weapon_heatbeam. [kexgame/g_spawn.ts:1256](/home/buzzkill/Projects/quake-2-re-ts/src/kexgame/g_spawn.ts:1256)
5. KEX game state and engine state have separate representations. The adapter must copy engine-computed model indices and bounds back into the game's edicts. Missing copy-back previously made doors and brush triggers collapse to incorrect bounds. The current fix is explicit. [kex.ts:709](/home/buzzkill/Projects/quake-2-re-ts/src/server/bindings/kex.ts:709)
6. KEX movement retains native floats through player-state adaptation and 1038. The client chooses KEX cgame movement. Save dispatch follows the KEX game API, regardless of the map's edition. [kex.ts:609](/home/buzzkill/Projects/quake-2-re-ts/src/server/bindings/kex.ts:609), [kex.ts:1198](/home/buzzkill/Projects/quake-2-re-ts/src/server/bindings/kex.ts:1198), [cl_parse.ts:519](/home/buzzkill/Projects/quake-2-re-ts/src/client/cl_parse.ts:519)

The actual map switch invalidates filename-based caches through `FS_Generation`; collision-map cache hits require that generation. Localization reloads after a remount. The old bug served different base1 variants to collision and rendering, producing “bad inline model number.” [cmodel.ts:932](/home/buzzkill/Projects/quake-2-re-ts/src/qcommon/cmodel.ts:932), [data_root_nested.test.ts:14](/home/buzzkill/Projects/quake-2-re-ts/test/data_root_nested.test.ts:14)

Commit b5a32c1 records verification against real base1 and xswamp bytes and a geometry screenshot comparison. Commit cbfcdc9 records later verification of all four edition/ruleset launch combinations with nested roots. The current combined visual gate includes those exact four launch strings at [final_gate2.sh:36](/home/buzzkill/Projects/quake-2-re-ts/.orch/scripts/final_gate2.sh:36). Those are historical evidence and existing checks, not live visual verification from this audit.

Multiplayer adds a third concrete adaptation that must remain explicit.

LMCTF's re-release choice is `lmctf-kex`, not the KEX gameplay module. [ResolveServerLaunch](/home/buzzkill/Projects/quake-2-re-ts/src/client/menu_content.ts:1520) selects LMCTF's maps and mounts classic data beneath re-release data so the mod's own directory remains available. The server retains legacy game family for timing and save dispatch, while choosing 1038 and the wide layout. [legacy_kex.ts:31](/home/buzzkill/Projects/quake-2-re-ts/src/server/bindings/legacy_kex.ts:31), [sv_game.ts:498](/home/buzzkill/Projects/quake-2-re-ts/src/server/sv_game.ts:498)

This needs real command adaptation. 1038 sends jump/crouch button bits; classic LMCTF reads upmove. [kexUsercmdForClassicGame](/home/buzzkill/Projects/quake-2-re-ts/src/server/bindings/legacy_kex.ts:293) converts those bits to +400 or -400 when necessary. It also needs configstring remapping and fixed-point movement mirrors. The client still chooses KEX cgame and prediction from 1038. This audit did not prove that KEX prediction and LMCTF server movement agree across all movement cases. The unified protocol should carry the actual movement provider and HUD schema instead of inferring both from one protocol number.

CTF and LMCTF also borrow each other's maps through an auxiliary tier. Host-mod assets win, borrowed map dependencies sit below them, and baseq2 sits below both. The allowance includes maps, textures, skies, and exact assets referenced by map entities; it excludes the borrowed mod's general HUD, configuration, player, and game-code files. [files.ts:1651](/home/buzzkill/Projects/quake-2-re-ts/src/qcommon/files.ts:1651), [files.ts:1837](/home/buzzkill/Projects/quake-2-re-ts/src/qcommon/files.ts:1837) MD5 replacements must come from the same or a higher priority than the MD2 they replace, preventing re-release Threewave flags from overriding LMCTF flags. [md5_replacement_tier.test.ts:1](/home/buzzkill/Projects/quake-2-re-ts/test/md5_replacement_tier.test.ts:1)

Arbitrary mod directories are not arbitrary executable game modules. `LoadLegacyGame` recognizes five statically imported legacy modules and defaults to baseq2 for other names. The discovered singleplayer branch returns its gamedir without using the selected ruleset. The multiplayer re-release branch explicitly reports “mod code does not run under this ruleset yet.” [legacy.ts:914](/home/buzzkill/Projects/quake-2-re-ts/src/server/bindings/legacy.ts:914), [menu_content.ts:766](/home/buzzkill/Projects/quake-2-re-ts/src/client/menu_content.ts:766), [menu_content.ts:1549](/home/buzzkill/Projects/quake-2-re-ts/src/client/menu_content.ts:1549)

Protocol 4038 has concrete compatibility consequences.

The server widens a classic session to Q2REPRO_CLASSIC_CODEC and requires the new protocol number. Other client protocols are rejected. [sv_init.ts:153](/home/buzzkill/Projects/quake-2-re-ts/src/server/sv_init.ts:153), [sv_main.ts:510](/home/buzzkill/Projects/quake-2-re-ts/src/server/sv_main.ts:510) Its original documentation calls it byte-identical to 1038 apart from serverdata. That comment is now stale: the actual codec overrides batched user commands to include upmove and lightlevel. [q2repro.ts:1766](/home/buzzkill/Projects/quake-2-re-ts/src/qcommon/protocol/q2repro.ts:1766)

Thus “classic and re-release content interoperate within this engine” does not mean “every original or re-release executable can join every mixed server.” The external q2repro matrix is disabled by an earlier owner instruction in [interop-matrix.sh:1](/home/buzzkill/Projects/quake-2-re-ts/scripts/interop-matrix.sh:1). The remaining [interop_q2repro.test.ts:1](/home/buzzkill/Projects/quake-2-re-ts/test/interop_q2repro.test.ts:1) covers byte-level regressions derived from earlier live experiments. Restoring foreign-engine execution would require checking the applicable scope instruction, rather than silently treating those disabled cells as tested.

The original source separates genuine behavior from port omissions in the decisive cases.

| Original re-release implementation inspected directly | Observed TypeScript difference | Disposition |
| --- | --- | --- |
| [g_save.cpp:728](/home/buzzkill/Projects/quake2-rerelease-dll/rerelease/g_save.cpp:728) saves POI stage, health bars, and story state. [Line 1262](/home/buzzkill/Projects/quake2-rerelease-dll/rerelease/g_save.cpp:1262) saves fog; [line 1286](/home/buzzkill/Projects/quake2-rerelease-dll/rerelease/g_save.cpp:1286) saves brush animation. | The classic content adaptation omits these from serialization. | Incomplete adaptation, not a native save quirk. |
| [g_items.cpp:1492](/home/buzzkill/Projects/quake2-rerelease-dll/rerelease/g_items.cpp:1492) toggles the flashlight through P_ToggleFlashlight. | The classic adaptation has an empty use action. | Missing gameplay effect, not original behavior. |
| [g_target.cpp:2039](/home/buzzkill/Projects/quake2-rerelease-dll/rerelease/g_target.cpp:2039) sends achievements and [line 2058](/home/buzzkill/Projects/quake2-rerelease-dll/rerelease/g_target.cpp:2058) publishes the story configstring. | The classic adaptation sends neither. | Missing presentation/event adaptation. |
| [g_spawn.cpp:1517](/home/buzzkill/Projects/quake2-rerelease-dll/rerelease/g_spawn.cpp:1517) updates both CONFIG_N64_PHYSICS and server pm_config.n64_physics. [Line 1528](/home/buzzkill/Projects/quake2-rerelease-dll/rerelease/g_spawn.cpp:1528) does the same for air acceleration. | The TS server passes PM_CONFIG_DEFAULT while the client reads the announced configuration. | Port wiring defect, not a movement quirk to preserve. |

The intended fidelity contract is useful, but several broad claims in the prose are stronger than the code.

[ARCHITECTURE.md:36](/home/buzzkill/Projects/quake-2-re-ts/ARCHITECTURE.md:36) says legacy modules gained every re-release entity. At line 48 the same document still says re-release-only content is never backported. Current source and commits 288484f and 2f150cf prove that it was ported into all five legacy trees. The actual policy is native implementations first, additional content second, and explicit compatibility rules when new maps need semantics absent from original gameplay.

The same document promises a single SSV2/SAV2 save container for both module families at [ARCHITECTURE.md:72](/home/buzzkill/Projects/quake-2-re-ts/ARCHITECTURE.md:72). Current [sv_ccmds.ts:331](/home/buzzkill/Projects/quake-2-re-ts/src/server/sv_ccmds.ts:331) instead keeps legacy and KEX engine containers separate. Neither shared filenames nor JSON serialization establish cross-ruleset save compatibility. The intended unified save ownership is reusable; the current split and missing fields are implementation work to resolve.

The extra items preserve ordinary item indices through appended rows and local lookup, while functions are translated to each module's time units, flags, callback registry, and item schema. [g_items.ts:3](/home/buzzkill/Projects/quake-2-re-ts/src/game/g_items.ts:3) The native version of an existing entity wins. Re-release-only monsters sometimes lose semantics during this translation: gun commander uses immediate animation selection, omits KEX navigation branches, and reduces gib behavior. Shambler keeps different melee metrics between attack selection and hit resolution. [m_guncmdr.ts:26](/home/buzzkill/Projects/quake-2-re-ts/src/game/m_guncmdr.ts:26), [m_guncmdr.ts:2269](/home/buzzkill/Projects/quake-2-re-ts/src/game/m_guncmdr.ts:2269), [m_shambler.ts:378](/home/buzzkill/Projects/quake-2-re-ts/src/game/m_shambler.ts:378)

Even native-fidelity tests have explicit baselines: the four expansion trees suppress appended item-name configstrings on narrow sessions, but baseq2 intentionally emits the expanded 80-name table because its control already included that change. [g_spawn_rerelease_all_modules.test.ts:603](/home/buzzkill/Projects/quake-2-re-ts/test/g_spawn_rerelease_all_modules.test.ts:603) A future “native fidelity” claim needs an identified reference behavior, not only equality to the previous port revision.

The most concrete completion blocker found here is save-state loss in classic rules hosting added content.

| State exercised through the actual serializer | Before | After |
| --- | ---: | ---: |
| POI stage | 9 | 0 |
| Entity fog density | 0.35 | 0 |
| Brush animation enabled | true | false |
| Persistent flechette capacity | 200 | 0 |

The entity serializer explicitly lists the original fields and omits fog and brush animation. The persistent-client serializer omits added ammo capacities. The level serializer omits the POI, health-bar, story, and related state kept in g_kexent. [g_save.ts:919](/home/buzzkill/Projects/quake-2-re-ts/src/game/g_save.ts:919), [g_save.ts:1162](/home/buzzkill/Projects/quake-2-re-ts/src/game/g_save.ts:1162), [g_save.ts:1249](/home/buzzkill/Projects/quake-2-re-ts/src/game/g_save.ts:1249), [g_kexent.ts:272](/home/buzzkill/Projects/quake-2-re-ts/src/game/g_kexent.ts:272) Cross-unit flags and landmark state are already serialized and must not be reported as missing. [g_save.ts:1382](/home/buzzkill/Projects/quake-2-re-ts/src/game/g_save.ts:1382)

This command reproduces the four observations without creating a save file:

```bash
cd /home/buzzkill/Projects/quake-2-re-ts
bun -e '
import { level, EdictT, ClientPersistantT } from "./src/game/g_local.ts";
import { kexLevel, KexResetLevelState } from "./src/game/g_kexent.ts";
import {
	serializeLevel, deserializeLevel,
	serializeEdict, deserializeEdict,
	serializeClientPersistant, deserializeClientPersistant
} from "./src/game/g_save.ts";
level.mapname = "interop_probe";
KexResetLevelState();
kexLevel().current_poi_stage = 9;
const savedLevel = serializeLevel();
KexResetLevelState();
deserializeLevel(savedLevel);
const entity = new EdictT();
entity.fog.density = 0.35;
entity.bmodel_anim.enabled = true;
entity.bmodel_anim.start = 5;
entity.bmodel_anim.end = 12;
const restoredEntity = new EdictT();
deserializeEdict(restoredEntity, serializeEdict(entity));
const pers = new ClientPersistantT();
pers.max_flechettes = 200;
const restoredPers = deserializeClientPersistant(serializeClientPersistant(pers));
console.log(JSON.stringify({
	poiStage: { before: 9, after: kexLevel().current_poi_stage },
	fogDensity: { before: entity.fog.density, after: restoredEntity.fog.density },
	bmodelAnimation: { before: entity.bmodel_anim.enabled, after: restoredEntity.bmodel_anim.enabled },
	maxFlechettes: { before: pers.max_flechettes, after: restoredPers.max_flechettes }
}));
'
```

Other confirmed source omissions are material to a full-game claim. Classic `Use_Flashlight` is empty. The story action sets a flag but sends no text. Achievement use is empty. Target lights read a hardcoded lightstyle table, so switchable styles do not return their live value. [g_items.ts:830](/home/buzzkill/Projects/quake-2-re-ts/src/game/g_items.ts:830), [g_kextarg.ts:1478](/home/buzzkill/Projects/quake-2-re-ts/src/game/g_kextarg.ts:1478), [g_kextarg.ts:1516](/home/buzzkill/Projects/quake-2-re-ts/src/game/g_kextarg.ts:1516), [g_kexent.ts:149](/home/buzzkill/Projects/quake-2-re-ts/src/game/g_kexent.ts:149) Older comments blame protocol 34, but mixed re-release maps now widen. Those explanations no longer justify leaving wide-session actions empty.

A separate KEX source mismatch affects Q64 movement. The server publishes CONFIG_N64_PHYSICS=1 but does not update its movement configuration. ClientThink passes PM_CONFIG_DEFAULT, while the cgame updates its own configuration from that configstring. This audit establishes the disagreement in source; it did not reproduce a Q64 movement session. [g_spawn.ts:1930](/home/buzzkill/Projects/quake-2-re-ts/src/kexgame/g_spawn.ts:1930), [p_client.ts:3531](/home/buzzkill/Projects/quake-2-re-ts/src/kexgame/p_client.ts:3531), [cg_main.ts:78](/home/buzzkill/Projects/quake-2-re-ts/src/kexgame/cgame/cg_main.ts:78)

Existing verification is reusable, with clear limits. The 222-map, five-legacy-tree test checks classname membership and 18 documented museum/authoring exceptions, not every spawned entity's behavior. [g_spawn_rerelease_all_modules.test.ts:213](/home/buzzkill/Projects/quake-2-re-ts/test/g_spawn_rerelease_all_modules.test.ts:213) The two-module sweep actually boots 444 combinations and observes 100 frames, but keeps an explicit table of unresolved behavioral differences. [parity_map_sweep.test.ts:7](/home/buzzkill/Projects/quake-2-re-ts/test/parity_map_sweep.test.ts:7), [parity_map_sweep.test.ts:269](/home/buzzkill/Projects/quake-2-re-ts/test/parity_map_sweep.test.ts:269) The scripted play gate checks movement, ammo consumption, item pickup, flag pickup, hook use, map changes, and save/load position for ten scenarios. Its save assertion accepts position within 32 units and does not compare the missing state demonstrated above. [play_e2e.sh:8](/home/buzzkill/Projects/quake-2-re-ts/.orch/scripts/play_e2e.sh:8), [play_e2e.sh:567](/home/buzzkill/Projects/quake-2-re-ts/.orch/scripts/play_e2e.sh:567), [pe_check.py:493](/home/buzzkill/Projects/quake-2-re-ts/.orch/scripts/pe_check.py:493)

The graphics dependency decision is already present in source. SDL2 is the shared native window/input/audio backend through bun:ffi. Software rendering supplies its own framebuffer to an SDL streaming texture. GL uses the SDL context and direct GL calls. Its shader code is authored GLSL embedded in TypeScript; retail KPF shader templates are not treated as executable game shaders. [sdl.ts:1](/home/buzzkill/Projects/quake-2-re-ts/src/platform/sdl.ts:1), [swimp.ts:3](/home/buzzkill/Projects/quake-2-re-ts/src/platform/swimp.ts:3), [glimp.ts:7](/home/buzzkill/Projects/quake-2-re-ts/src/platform/glimp.ts:7), [gl_shader.ts:10](/home/buzzkill/Projects/quake-2-re-ts/src/ref_gl/gl_shader.ts:10) That convention supports the requested Bun, SDL2, CPU, and GL architecture. A strict no-casts check remains necessary: this checkout still contains casts, including [kex.ts:606](/home/buzzkill/Projects/quake-2-re-ts/src/server/bindings/kex.ts:606).

My recommendation is to select and combine implementations per subsystem after comparing their behavior, ownership, types, and tests across all three ports. Preserve Q2's strengths identified here: peer game bindings, independent content and edition selection, mount generations, filtered auxiliary map assets, wide-state protocol adapters, and shared SDL2 presentation. Make the currently implicit distinctions structural as those pieces are integrated. A session needs explicit map/content provenance, gameplay provider, movement provider, HUD/inventory schema, mode, capabilities, and protocol. Classnames need a source family and a defined mapping to the selected implementation. Native same-family behavior from original source remains the authority where it exists. Missing foreign content needs a complete implementation with an explicit adaptation, including persistence and presentation. Existing working code earns adoption through the same evidence used to identify and repair its gaps.

The required scope includes the full classic and re-release feature sets. Splitscreen is one example among many: local player input and presentation, bots and navigation, localization, expanded content, campaign progression, HUD additions, visual effects, audio, and multiplayer behavior all need their own inventory and acceptance evidence. This report's examples do not limit that inventory.

The resulting dependency and acceptance gates follow directly from the failures already encountered:

| Dependency | Acceptance required before calling the associated work complete |
| --- | --- |
| Content discovery and mount identity | Every requested edition/ruleset/map combination resolves the intended map bytes and ruleset assets, including nested roots, auxiliary maps, replacement formats, and a same-name map switch. |
| Module and entity contract | All required classnames resolve with typed fields, valid bounds, real callbacks, target chains, and native precedence. Unsupported museum content is explicit. Discovered code mods are not silently replaced by baseq2. |
| Simulation and prediction | Server and clients share the selected movement semantics, time units, flags, collision masks, and configuration. Exercise crouch, jump, swim, slopes, ladders, platforms, teleports, and Q64 configuration under every supported protocol. |
| Gameplay | Each weapon fires with its selected rules, items affect inventory and capacities, monsters attack/react/die, and map-authored presentation such as flashlight and story actually appears. Native deviations require identified source evidence. |
| Campaign and coop lifecycle | Complete level and unit transitions, backtracking, keys, landmark placement, all players' spawn/respawn paths, shared or instanced pickups, and map-specific progression. A restored session preserves all gameplay and presentation state. |
| Multiplayer lifecycle | Real separate clients connect, receive the correct map and HUD, join teams, fight, capture/return flags, score, spectate, disconnect/rejoin, rotate maps, and run the mod's defaults. Local seats receive correct individual state. |
| Presentation | CPU and GL render the same semantic content, with valid models, bounds, texture precedence, lights, fog, world text, HUD, inventory, effects, and audio. Inspect actual SDL windows as well as captures. |
| Integration evidence | Extend the existing content matrix and scripted probes to full behavior, fresh-process save/load, and complete campaigns/matches. Keep unresolved differences visible. A boot, green membership test, or screenshot alone cannot satisfy this gate. |

No additional user decision is needed for the basic scope: the stated requirement includes the full singleplayer and multiplayer game for every family. The remaining work is to make these combinations complete and to encode their contracts explicitly. Foreign-engine wire compatibility is a separate evidence claim from internal classic/re-release content interoperability.
