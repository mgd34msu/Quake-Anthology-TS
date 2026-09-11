Quake 1 classic and rerelease interoperability assessment

Inspected 2026-09-10 against `/home/buzzkill/Projects/quake-1-re-ts` at `6bc6a8b`. Source worktree was clean before and after this read-only investigation. The only new artifact is this planning report. No engine build, graphical session, or test suite was run. The investigation read implementation, relevant tests, Git history, rerelease QuakeC, and actual retail PAK directories, entity lumps, and compiled program function tables.

The recommendation follows the existing intended separation: select the gameplay implementation and its engine behavior as an explicit ruleset, independently of the content source and presentation. The selected gameplay implementation owns damage, weapons, monster behavior, pickups, inventory, player lifecycle, and progression. Engine movement and collision complete that contract. Foreign content must retain the mechanics its levels require through explicit implementations in the selected ruleset. The current rename-or-remove fallback does not meet the new requirement for complete campaigns and all combinations.

The intended interoperability contract is the precedent to preserve. These Q1 TypeScript implementations are evidence of what was attempted and where it stopped, not a requirement to reproduce their defects. The rerelease QuakeC and retail entity data establish the content mechanics in the comparisons below. Existing TS launch omissions, gate bypasses, discarded fields, incomplete checks, and stale caches are completion work. They must not become compatibility requirements for the unified engine.

The Q1 precedent is useful, but its word “ruleset” needs care. The architecture defines a pair of campaign gamecode and engine behavior. The menu selects only the engine half. A “Classic 1999” choice on rerelease Hipnotic still runs rerelease Hipnotic gamecode. It does not select the classic Hipnotic balance or classic id1 gamecode. This is explicit in [menu_content.ts](/home/buzzkill/Projects/quake-1-re-ts/src/client/menu_content.ts:21) and [ARCHITECTURE.md](/home/buzzkill/Projects/quake-1-re-ts/ARCHITECTURE.md:141).

The actual selection and execution path is:

1. `COM_InitFilesystem` identifies a rerelease root by `QuakeEX.kpf` or `mapdb.json` in `id1/pak0.pak`. It can mount a classic root and nested rerelease together. Rerelease id1 has higher priority. Mission pack directories resolve against the rerelease root whenever one is mounted. `-norerelease` keeps a nested rerelease overlay out of classic launches. [common.ts](/home/buzzkill/Projects/quake-1-re-ts/src/common/common.ts:1635), [mount priority](/home/buzzkill/Projects/quake-1-re-ts/src/common/common.ts:1838).
2. `ResolveLaunch` returns the same game directory for both behavior choices. `Content_PerformLaunch` queues `game`, player count, `sv_ruleset`, skill, and map in that order. The order preserves the user's choice after `game` reexecutes configuration. [menu_content.ts](/home/buzzkill/Projects/quake-1-re-ts/src/client/menu_content.ts:400), [launch execution](/home/buzzkill/Projects/quake-1-re-ts/src/client/menu_content.ts:462), [Host_Game_f](/home/buzzkill/Projects/quake-1-re-ts/src/common/host_cmd.ts:2122).
3. `SV_SpawnServer` installs the NetQuake host profile, loads the highest-priority `progs.dat`, then calls `QEX_AfterLoadProgs`. `PR_LoadProgs` validates VM version and the profile's system CRC. These are compatibility checks, not a selection of gameplay rules. [sv_main.ts](/home/buzzkill/Projects/quake-1-re-ts/src/server/sv_main.ts:1394), [nq.ts](/home/buzzkill/Projects/quake-1-re-ts/src/progs/profiles/nq.ts:104), [pr_edict_core.ts](/home/buzzkill/Projects/quake-1-re-ts/src/progs/pr_edict_core.ts:1120).
4. Auto behavior detection checks for `ex_centerprint` and absence of `centerprint`. A forced `sv_ruleset classic` or `rerelease` overrides that detected behavior without changing the loaded gamecode. [ruleset.ts](/home/buzzkill/Projects/quake-1-re-ts/src/progs/ext/ruleset.ts:103), [detection](/home/buzzkill/Projects/quake-1-re-ts/src/progs/ext/ruleset.ts:174).
5. Entity parsing writes fields defined by that gamecode, then resolves the entity classname to a function in that same program. Compatibility runs only when that function is absent. A matching classname therefore uses the selected program's behavior even if its source map expected another implementation. [pr_edict_core.ts](/home/buzzkill/Projects/quake-1-re-ts/src/progs/pr_edict_core.ts:929), [spawn resolution](/home/buzzkill/Projects/quake-1-re-ts/src/progs/pr_edict_core.ts:1002).
6. The server calls gamecode `ClientConnect`, `PutClientInServer`, `PlayerPreThink`, `PlayerPostThink`, `StartFrame`, and entity think/touch/blocked functions. The engine applies collision, gravity, acceleration, and movement between callbacks. [player spawn](/home/buzzkill/Projects/quake-1-re-ts/src/common/host_cmd.ts:1516), [physics callbacks](/home/buzzkill/Projects/quake-1-re-ts/src/server/sv_phys.ts:911), [frame dispatch](/home/buzzkill/Projects/quake-1-re-ts/src/server/sv_phys.ts:1149), [friction](/home/buzzkill/Projects/quake-1-re-ts/src/server/sv_user.ts:205).
7. Level changes call the selected gamecode's `SetChangeParms`, preserve its spawn parameters and server flags, and feed them back to `PutClientInServer`. The engine does not reinterpret them as another campaign's inventory. [SV_SaveSpawnparms](/home/buzzkill/Projects/quake-1-re-ts/src/server/sv_main.ts:1205), [changelevel](/home/buzzkill/Projects/quake-1-re-ts/src/common/host_cmd.ts:623).

The retail files confirm a real shared ABI. A read-only binary inspection found VM version 6 and system CRC 5927 in all ten programs: classic id1, Hipnotic, Rogue, and rerelease id1, Hipnotic, Rogue, mg1, mg3, dopa, CTF. All seven rerelease programs have the detection signature above. The three classic programs do not. Shared ABI permits execution by the same VM. It does not make their entity catalog, inventory layout, callbacks, or game rules equivalent.

The implemented engine behavior switch is smaller than the architectural prose suggests:

| Concern | Actual owner and behavior |
| --- | --- |
| Damage, weapon firing, pickup effects, monster decisions, difficulty rules | Loaded gamecode. Changing `sv_ruleset` does not replace it. |
| Movement | The combined contract of engine movement code, gamecode callbacks, and cvars. The rerelease profile adds a fixed server tick. The classic profile retains frame-coupled simulation. |
| Gib and corpse handling | `MOVETYPE_GIB` and `SOLID_CORPSE` branches check the behavior profile. |
| Extension queries | The rerelease profile advertises four implemented extensions. Classic advertises none. Named rerelease builtins remain available to execute loaded gamecode. |
| Localization | Follows detected rerelease gamecode even under forced classic behavior. A later play fix corrected raw localization keys caused by tying this only to the forced profile. |
| Extended effect bits | Enabled by declared gamecode constants through `PR_FindSupportedEffects`, independently of a forced classic behavior label. |
| Weapon quickswitch | Reads content `wwheel.txt`, maps wheel slots to impulses and inventory bits, then lets gamecode perform the weapon change. It is registered without a ruleset gate. |
| Save header | Auto selects version 5 for classic behavior and version 6 for rerelease behavior. The saved fields still come from the loaded gamecode. |
| Renderer and network widths | Separate choices. Map size can require a wider protocol without changing gamecode. |

Evidence: [fixed tick](/home/buzzkill/Projects/quake-1-re-ts/src/common/host.ts:1067), [gibs](/home/buzzkill/Projects/quake-1-re-ts/src/server/sv_phys.ts:1069), [corpses](/home/buzzkill/Projects/quake-1-re-ts/src/server/world.ts:778), [extensions](/home/buzzkill/Projects/quake-1-re-ts/src/progs/ext/qex.ts:612), [localization correction](/home/buzzkill/Projects/quake-1-re-ts/src/progs/ext/ruleset.ts:263), [effect declarations](/home/buzzkill/Projects/quake-1-re-ts/src/progs/ext/ruleset.ts:148), [quickswitch](/home/buzzkill/Projects/quake-1-re-ts/src/client/cl_main.ts:594), [protocol selection](/home/buzzkill/Projects/quake-1-re-ts/src/server/sv_main.ts:1261).

No `sv_gameplayfix_*` implementation was found under `src`, although the architecture lists defaults among the profile's responsibilities. Treat that as an unimplemented promise. The existing gib behavior also follows the rerelease QC comment where available open engine implementations disagree. It is an explicitly chosen port behavior, not proof of exact closed-source KEX physics.

Four concrete combinations establish what this means.

**Classic Hipnotic content with rerelease engine behavior.** A launch using the classic root, `-norerelease`, and `-hipnotic` loads classic Hipnotic's program. Forcing `sv_ruleset rerelease` retains that program, its weapons, and its item handlers while enabling the rerelease engine clock and capabilities. Autosave chooses the KEX-style header but serializes the classic program's fields. Neither the content format nor the save header changes the gameplay implementation.

**Rerelease Hipnotic content with classic engine behavior.** The menu mounts rerelease Hipnotic and forces `sv_ruleset classic`. Native Hipnotic classnames resolve before compatibility. Its laser, Mjolnir, proximity gun, pickups, and player callbacks remain Hipnotic gamecode. The rerelease source's `PutClientInServer` explicitly gives 50 starting and maximum health on Nightmare outside deathmatch, while its jump callback adds 270 vertical velocity. These decisions do not read `sv_ruleset`. See [rerelease Hipnotic player spawn](/home/buzzkill/Projects/qsrc/quake-rerelease-qc/quakec_hipnotic/client.qc:805), [jump](/home/buzzkill/Projects/qsrc/quake-rerelease-qc/quakec_hipnotic/client.qc:1127), [expansion weapon dispatch](/home/buzzkill/Projects/qsrc/quake-rerelease-qc/quakec_hipnotic/weapons.qc:1745). This is the clearest reason not to label an engine-only choice as a complete classic gameplay choice.

**Classic id1 gamecode applied to mg1 or mg3 map assets.** If a content mount supplies those maps while classic id1 supplies `progs.dat`, missing classes reach `compat_spawn.ts`. This is not currently a complete menu launch path. `ClassicProgsPlan` is referenced only by tests and returns `game id1`. That removes the expansion mount, and a mixed root still resolves rerelease id1 above classic id1. It neither retains mg maps nor guarantees classic gamecode. See [model-only plan](/home/buzzkill/Projects/quake-1-re-ts/src/client/menu_content.ts:37), [implementation](/home/buzzkill/Projects/quake-1-re-ts/src/client/menu_content.ts:424), [mount reset](/home/buzzkill/Projects/quake-1-re-ts/src/common/common.ts:1776).

Within such an explicitly constructed combination, the fallback preserves some limited behavior. `func_axe_button` becomes `func_button` after setting health to 1, exactly matching the rerelease wrapper. Team spawn markers can become deathmatch spawn markers. Other adaptations change essential mechanics:

| Entity and real use | Rerelease behavior | Current classic fallback |
| --- | --- | --- |
| mg1 `hub_trigger_changelevel`, present in `maps/hub.bsp` | Removes itself unless all sigils are present, then creates the exit trigger | Always creates a normal level exit |
| mg3 `trigger_rune_counter`, present in hub and several campaign maps | Fires targets only when the number of owned runes reaches `count` | Ordinary relay fires without the threshold |
| mg1 electrode button and rune egg opener, present in `maps/mge2m2.bsp` | Button removes matched electrode targets. Egg opener reconfigures and opens the doors enclosing the rune | Entire puzzle-specific entities are removed |
| mg3 `func_breakable`, present in `maps/boss2.bsp` | Damageable brush, pain callback moves it, death removes it | Permanently solid `func_wall` |
| mg3 `item_upgrade_health`, present in `maps/map1.bsp` and later maps | Records a persistent upgrade, increases capacity, grants a bonus, and fires targets | Ordinary one-time `item_health` |
| mg1 `func_bob`, present in SP and DM maps | Custom moving platform | Entity removed |
| CTF flags and team spawns on a non-CTF program | Flag possession/capture and team-specific spawn behavior | Flags removed, spawn points converted to deathmatch |

The hub correction matters: the fallback comment describes dropping “hub-progress bookkeeping.” The actual source implements an all-runes exit gate. This is a progression change. The table cannot claim fidelity based on its comment. Compare [compat_spawn.ts](/home/buzzkill/Projects/quake-1-re-ts/src/server/compat_spawn.ts:121) with [actual hub QC](/home/buzzkill/Projects/qsrc/quake-rerelease-qc/quakec_mg1/map_specific/hub.qc:21).

Other source comparisons: [rune condition](/home/buzzkill/Projects/qsrc/quake-rerelease-qc/quakec_mg3/mg3_triggers.qc:66), [rune fallback](/home/buzzkill/Projects/quake-1-re-ts/src/server/compat_spawn.ts:154), [electrode and egg callbacks](/home/buzzkill/Projects/qsrc/quake-rerelease-qc/quakec_mg1/map_specific/mge2m2.qc:31), [puzzle inhibition](/home/buzzkill/Projects/quake-1-re-ts/src/server/compat_spawn.ts:123), [breakable callbacks](/home/buzzkill/Projects/qsrc/quake-rerelease-qc/quakec_mg3/monsters/mg3_oldone_new.qc:1251), [upgrade callback](/home/buzzkill/Projects/qsrc/quake-rerelease-qc/quakec_mg3/mg3_upgrades.qc:293), [persistent upgrade parameter allocation](/home/buzzkill/Projects/qsrc/quake-rerelease-qc/quakec_mg3/mg3_upgrades.qc:44), [item replacements](/home/buzzkill/Projects/quake-1-re-ts/src/server/compat_spawn.ts:176), [axe button wrapper](/home/buzzkill/Projects/qsrc/quake-rerelease-qc/quakec_mg3/buttons.qc:258), [CTF fallback](/home/buzzkill/Projects/quake-1-re-ts/src/server/compat_spawn.ts:72).

The September 6 commit `1e1b624` introduced this table as an intentional interim replacement for union gamecode. The architecture explicitly says the qcc/union-progs phase has not started. The limited mappings are documented substitutions, but their existence does not fulfill the broader promise that every program plays every map. [ARCHITECTURE.md](/home/buzzkill/Projects/quake-1-re-ts/ARCHITECTURE.md:160).

**QuakeWorld host with NetQuake rerelease gamecode.** Shared VM implementation does not imply compatible host contracts. The QuakeWorld profile selects its own global and entity layouts, CRC 54730, QuakeWorld builtins, and `qwprogs.dat` preference. Its named extension table is empty. All inspected retail rerelease programs require the NetQuake system CRC 5927. Switching only the protocol or host name cannot run those programs. [qw.ts](/home/buzzkill/Projects/quake-1-re-ts/src/progs/profiles/qw.ts:132), [CRC policy](/home/buzzkill/Projects/quake-1-re-ts/ARCHITECTURE.md:119). This distinction belongs in the unified multiplayer design as a host/gameplay contract separate from a wire codec.

The coverage test has a concrete hole. It builds the union of function names from classic id1, Hipnotic, and Rogue source, then accepts any retail classname found in that union. It never verifies the classname against each actual selected program. It also accepts a rename without proving that program contains the rename target. [compat_spawn.test.ts](/home/buzzkill/Projects/quake-1-re-ts/test/compat_spawn.test.ts:204).

A separate read-only inspection of actual compiled retail function tables and map entity lumps found the following unsupported class catalogs after applying the current table and excluding its six documented vanilla quirks:

| Selected classic gamecode | Rerelease content | Missing distinct classnames |
| --- | --- | ---: |
| id1 | Hipnotic | 56 |
| id1 | Rogue | 32 |
| id1 | mg1 | 2 |
| id1 | mg3 | 5 |
| Hipnotic | Rogue | 32 |
| Rogue | Hipnotic | 56 |

These are static content catalogs, before skill or mode inhibition, not counts of active failing entities in one play session. The mg1 omissions are `light_candle` and `trigger_explosion`. The mg3 omissions add `monster_lava_man`, `weapon_laser_gun`, and `weapon_mjolnir`. Hipnotic's omitted gameplay classes include all three added weapon pickups, `monster_scourge`, `monster_gremlin`, `monster_armagon`, the wetsuit, empathy shields, and horn of conjuring. The loaded id1 program defines none of them, and the compatibility table has no entry for them. A classname present only in another classic expansion passes the current coverage test despite this.

The existing “map x progs sweep” is also not a cross product. Its ten launch configurations pair each content tree with its own program. The test boots 100 frames and checks a live player plus console categories. Its explicit profile crossover E2E cases reload id1 `e1m1`, move in god mode, and kill a reachable ordinary monster. They are useful smoke checks and cannot prove hub gates, puzzle completion, foreign weapons, or expansion inventory retention. [sweep configuration](/home/buzzkill/Projects/quake-1-re-ts/test/support/sweep_lib.ts:180), [sweep assertions](/home/buzzkill/Projects/quake-1-re-ts/test/sweep_maps.test.ts:62), [profile crossover](/home/buzzkill/Projects/quake-1-re-ts/test/e2e/r_progs_features.ts:167), [play assertion scope](/home/buzzkill/Projects/quake-1-re-ts/test/e2e/r_progs_features.ts:99).

Several state and multiplayer boundaries must become explicit for arbitrary combinations:

- Inventory values are program-specific. For example bit 4096 is id1's axe but Rogue's lava nailgun. HUD paths use global `hipnotic` and `rogue` mount flags. Native unified state needs namespaced item identities and ruleset-owned presentation metadata, with old bit layouts confined to format adapters. [quakedef.ts](/home/buzzkill/Projects/quake-1-re-ts/src/common/quakedef.ts:118), [Rogue layout](/home/buzzkill/Projects/quake-1-re-ts/src/common/quakedef.ts:149), [HUD](/home/buzzkill/Projects/quake-1-re-ts/src/client/sbar.ts:874).
- The network writer passes `standard_quake` from filesystem state, and the client uses its local `standard_quake` to decode the active weapon differently. The NetQuake serverinfo message sends protocol, mode, strings, and precaches but no structured complete ruleset/content identity. Arbitrary combinations need a negotiated session description for native clients, while compatible legacy formats retain their exact documented limits. [clientdata writer](/home/buzzkill/Projects/quake-1-re-ts/src/server/sv_main.ts:909), [client decode](/home/buzzkill/Projects/quake-1-re-ts/src/client/cl_parse.ts:796), [serverinfo](/home/buzzkill/Projects/quake-1-re-ts/src/server/sv_main.ts:519).
- KEX-style version 6 adds game directory names but no edition root, gamecode hash, forced behavior, or inventory schema. Loading switches game directories if needed, reloads whatever program wins the current search path, and parses saved entities through that program. It does not invoke the spawn compatibility mapping for saved entities. Cross-program save migration is not implemented. [save writer](/home/buzzkill/Projects/quake-1-re-ts/src/common/host_cmd.ts:736), [save reader](/home/buzzkill/Projects/quake-1-re-ts/src/common/host_cmd.ts:1055), [entity restoration](/home/buzzkill/Projects/quake-1-re-ts/src/common/host_cmd.ts:1093).
- The writer's KEX layout was inferred from Ironwail's reader. Its source header explicitly says no retail `.sav` fixture was available. The architecture's retail round-trip claim exceeds the evidence currently described in implementation. [host_cmd.ts](/home/buzzkill/Projects/quake-1-re-ts/src/common/host_cmd.ts:66).
- `wwheelSlots` is a module-global cache, initialized on first quickswitch and never reset anywhere under `src`. A game-directory change can retain the prior campaign's wheel mapping. A session-owned content cache would avoid this coupling. [cl_main.ts](/home/buzzkill/Projects/quake-1-re-ts/src/client/cl_main.ts:615).
- Unknown fields listed in `knownKeys` are accepted without warnings and then discarded. The concrete resolver ignores the raw fields supplied by the parser. Quiet parsing therefore proves neither preservation nor adaptation of fields such as scripted spawn controls. [parser](/home/buzzkill/Projects/quake-1-re-ts/src/progs/pr_edict_core.ts:927), [registered resolver](/home/buzzkill/Projects/quake-1-re-ts/src/server/compat_spawn.ts:273).

The implementation order for the unified engine follows these dependencies:

1. Define an explicit session description with content identity, gameplay identity and revision, engine movement/behavior profile, multiplayer mode, and protocol capabilities. Keep edition-root resolution and renderer selection separate. Default gameplay to the content's native module, matching Q1's existing behavior.
2. Give the selected gameplay module ownership of damage, weapons, item effects, AI, player lifecycle, inventory, and progression. Port the Q1 game behavior into strict typed TypeScript under the user's all-engine-and-game-code requirement. The existing VM remains useful for comparison and external QuakeC compatibility; a TypeScript qcc alone would still leave built-in gameplay executing QuakeC bytecode.
3. Implement each foreign entity's required behavior in a content integration layer with explicit references to the selected damage, inventory, movement, and progression contracts. Preserve target graphs, sigil gates, puzzles, scripted spawns, moving platforms, and game-mode objectives. Replace the lossy table as the route to complete content support.
4. Use canonical item and entity identities internally. Adapt old numeric fields and bit sets at the legacy VM, network, demo, and save boundaries. Do not derive gameplay identity from mounted directory booleans.
5. Store the session description and a versioned gameplay state schema in native saves, demos, and native multiplayer negotiation. Retain classic and KEX import/export as explicitly bounded adapters. Do not claim a save can switch gameplay implementation without a defined migration.
6. Regate true combinations after these dependencies exist. Keep native same-content fidelity checks alongside full cross-content campaign and multiplayer checks.

Acceptance must require more than successful spawn:

- Each selected gameplay implementation resolves every relevant classname and property for every requested campaign, including classes present in other expansions and newly added classes with familiar names.
- Classic and rerelease native runs reproduce their selected health, damage, armor, ammo, movement, weapon timing, AI, pickup, and lifecycle rules. Force-profile cases state precisely which half of the ruleset changed.
- mg1's hub exit stays unavailable before all sigils and becomes available afterward. Its electrode/rune-egg sequence completes in the actual retail map.
- mg3 rune counters respect thresholds, breakable encounter geometry reacts to damage, upgrades persist across level transitions and save/load, and foreign expansion weapons are usable with correct ammo and HUD state.
- Cooperative spawning, death/respawn, CTF flags and scoring, spectators, bots, and multiplayer transitions retain the selected mode's semantics. Turning a CTF map into deathmatch is a distinct mode, not proof of CTF support.
- Both CPU and OpenGL clients can complete representative native and foreign-content paths against the same authoritative server state. Protocol boundaries fail explicitly when they cannot represent required state, and legacy compatibility is verified separately from native interoperation.
- Native saves resume the exact content/ruleset combination. Retail-format round trips require actual retail fixtures and behavior checks, beyond loading a locally generated header.

This report establishes source-grounded behavior and static binary catalog evidence. It does not certify runtime completion of these scenarios. The current Q1 engine provides useful contracts and working native-profile paths. The stronger arbitrary-content promise remains unfinished in launch selection, foreign entity semantics, state identity, and acceptance coverage.

The static retail catalog check can be reproduced with this read-only command. It reads installed commercial data and does not copy or modify it. It emits the program ABI facts and six coverage counts used above. The expected counts are specific to the retail files inspected on this machine.

```sh
python3 - <<'PY'
import pathlib
import struct
import re
import json

root = pathlib.Path('/home/buzzkill/Projects/qfiles/q1')
port = pathlib.Path('/home/buzzkill/Projects/quake-1-re-ts')
source = (port / 'src/server/compat_spawn.ts').read_text()
renames = dict(re.findall(r'\["([^"]+)", rename\("([^"]+)"', source))
inhibited = set(re.findall(r'\["([^"]+)", INHIBIT\]', source))
quirks = {
    'func_dm_only', 'light_torch_3legs_white',
    'light_torch_tall_3legs_yellow', 'plat_4x128',
    'sound_thunder', 'sound_wind1',
}
configs = [
    'id1', 'hipnotic', 'rogue', 'rerelease/id1',
    'rerelease/hipnotic', 'rerelease/rogue', 'rerelease/mg1',
    'rerelease/mg3', 'rerelease/dopa', 'rerelease/ctf',
]
catalogs = {}
for cfg in configs:
    entries = {}
    packs = sorted((root / cfg).iterdir(), key=lambda p: p.name.lower())
    for path in packs:
        if path.suffix.lower() != '.pak':
            continue
        with path.open('rb') as f:
            signature, offset, length = struct.unpack('<4sii', f.read(12))
            if signature != b'PACK':
                raise ValueError(path)
            f.seek(offset)
            directory = f.read(length)
        for i in range(0, length, 64):
            name, pos, size = struct.unpack('<56sii', directory[i:i + 64])
            name = name.split(b'\0', 1)[0].decode()
            entries[name] = (path, pos, size)

    path, pos, size = entries['progs.dat']
    with path.open('rb') as f:
        f.seek(pos)
        code = f.read(size)
    header = struct.unpack('<15i', code[:60])
    strings = code[header[10]:header[10] + header[11]]
    names = set()
    for i in range(header[9]):
        name_offset = struct.unpack_from('<i', code, header[8] + i * 36 + 16)[0]
        names.add(strings[name_offset:].split(b'\0', 1)[0].decode())

    classnames = set()
    for name, (path, pos, size) in entries.items():
        if not (name.startswith('maps/') and name.endswith('.bsp')):
            continue
        with path.open('rb') as f:
            f.seek(pos + 4)
            offset, length = struct.unpack('<ii', f.read(8))
            f.seek(pos + offset)
            entities = f.read(length).decode('latin1')
        classnames.update(re.findall(r'"classname"\s*"([^"]+)"', entities))

    catalogs[cfg] = (names, classnames)
    print(json.dumps({
        'program': cfg, 'vm_version': header[0], 'system_crc': header[1],
        'detected_rerelease': 'ex_centerprint' in names and 'centerprint' not in names,
    }))

pairs = [
    ('id1', 'rerelease/hipnotic'), ('id1', 'rerelease/rogue'),
    ('id1', 'rerelease/mg1'), ('id1', 'rerelease/mg3'),
    ('hipnotic', 'rerelease/rogue'), ('rogue', 'rerelease/hipnotic'),
]
for rules, content in pairs:
    names = catalogs[rules][0]
    missing = sorted(
        classname for classname in catalogs[content][1]
        if classname not in names and classname not in inhibited
        and classname not in quirks
        and renames.get(classname, classname) not in names
    )
    print(json.dumps({
        'gamecode': rules, 'content': content,
        'missing_count': len(missing),
        'missing_names': missing if len(missing) < 8 else [
            name for name in missing if name.startswith(('weapon_', 'monster_', 'item_'))
        ],
    }))
PY
```
