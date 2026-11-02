# TABLES — Data, frame and move tables validated against real game assets
## Coverage
Scripts: <scratchpad>/tables/ (lib.ts, qcdec.ts, q1cmp2.ts, q1cls.ts, q1fr.ts, q1stats.ts, q1mdl.ts, sndch.ts, act.ts, q2ext.ts, q2strict.ts, q2md2.ts, q2items.ts, q2itemrr.ts, q2itemcmp.ts, fin.ts, wgen.ts, q2stats.ts, muz.ts, nums.ts, q3items.ts, paths.py, p3.py, botchk.ts, rev.ts, tot.ts). Tables were imported at runtime from <scratchpad>/clean, so computed tables (demodog, infected) were checked as built.

Exact entry coverage, checked against an asset: 38,341 of 42,739 entries = 89.71%.
| Family | Entries | Checked | Evidence |
|---|---:|---:|---|
| Q1 frame rows (25 files) | 3,877 | 3,877 | progs.dat STATE opcode: frame, next, ai_*, sound, lightstyle, calls |
| Q2 move rows (1,031 moves) | 15,724 | 15,724 | mmove_t/mframe_t in gamex86.dll (base, xatrix, rogue), game_x64.dll (rerelease) |
| Q2 frame constants | 17,443 | 17,443 | MD2 frame names and counts, classic and rerelease paks |
| Monster muzzle rows | 502 | 502 | monster_flash_offset in the 4 DLLs |
| rereleaseFlash enum (flashes.ts) | 290 | 0 | Only the row count was checked (290 = 290 muzzle rows). The DLL has no names. |
| Normals (anorms, alias, direction-byte) | 487 | 487 | quake2ex_steam.exe, qagame.qvm, cgame.qvm |
| shadedots | 4,096 | 0 | No binary copy found. Structure only: filler is 1.0, range 0.70-1.99. |
| sphere-points | 100 | 100 | mg3 progs get_org vector immediates |
| Reverb presets (546 fields) | 26 | 26 | /usr/include/AL/efx-presets.h, which is not game data |
| Q3 items | 51 | 51 | bg_itemlist in baseq3 and missionpack qagame.qvm |
| Q2 items | 47 | 40 | gitem_t arrays. item_health*, key_nuke, key_nuke_container, item_foodcube matched no gitem row. |
| Q2 weapon definitions | 20 | 15 | Weapon_Generic push arguments. grenades, trap, tesla, hyperblaster, chainfist did not match the byte pattern. |
| Q1 species | 37 | 37 | monster_* functions (73 fields: 55 match, 18 unresolved because the store is in a helper function) |
| Q2 monster stat rows | 39 | 39 | SP_* immediates (104 fields: 84 match, 20 unresolved because the value is loaded through a register) |

Depth limits. A checked row is not always fully proven:
- Q1 rows: 3,337 had every operation compared. The other 540 use opaque actions. 321 of those were proved identical to the action's canonical function body, and the remaining 219 self-named actions were only checked for a handler. monster-actions.ts 100-189 was compared by hand against a sample of disassembled functions.
- Q2 think callbacks: presence per frame is exact. Identity is one-to-one per DLL address, except for aliases folded in the binary.
- Stats are not all extractable: Q1 pickup values were spot-checked against progs (armor, ammo). Q2 armor info matched for 3 rows. Weapon damage in code was not checked.

Path literals: 5,141 under content/ and bots/behavior/; 5,074 resolve. The other 67 were triaged as mod-only, including LMCTF (resolved against q2/lmctf) and LRCTF, or as source-true missing files (medkit_sphere.md3, tele_exit.md3, models/players/characters fallback). Threewave Q3/Q1 grapple assets could not be checked because those mods are not in qfiles.

Read in full by hand: bots/behavior/rerelease/data/botdata.ts 1038, library/libvars.ts 320, rerelease/data/knowledge-q1.ts 15, knowledge-q2.ts 91, q3/arsenal-knowledge.ts 156, q1/missionpacks/monsters/tables/hipscrge.ts 76, q2/missionpacks/monsters/tables/rogue-turret.ts 57.
Read in part: q2/foundation/weapons/definitions.ts and q2/missionpacks/weapons/definitions.ts (long lines cut in display for the base file); q1/base/monster-actions.ts 100-189 (lines cut at 330 columns); q2/foundation/items.ts 41-92 and q2/missionpacks/items.ts 22-37, 120-160 (cut at 230-290 columns); q2/base/monsters/tables/boss2.ts 87-106; audio/reverb-presets.ts 60-105.
Not read by hand, checked by script only: the 110 table-like files, 44,722 lines, listed in <scratchpad>/tables/unread.txt. Reason: their rows were compared mechanically against the binaries; the brief for this key asked for a hand sample. This is well short of ROUND3's "read every file" rule, and that list is the exact remainder.
Not asset-checked at all: content/q3/base/game/save-values.ts, compat/q2/classic/layout.ts, compat/q2/native-primary-weapon-profile.ts, compat/qvm/legacy-bot-abi.ts, persistence/qvm-grapple.ts. They hold no game-asset values that could be compared this way, or need a separate ABI check.
No data tables in: library/chat-data.ts and botdata.ts are parsers. libvars.ts is logic with no defaults table. For those I ran the parsers instead (see Strengths).

## Strengths
- Q1 frame numbers and next pointers: 3,877 of 3,877 exact against rerelease progs. 79 of 79 table sound operations have the correct chance and comparison.
- Q2 moves: 1,011 of 1,031 moves and 15,557 of 15,724 rows exact on range, distance, think presence, end presence and lerp. All 286 base DLL moves are claimed by a table. Of the 20 unmatched moves, 19 are dead (TABLES-008) and the other, fixbot_move_turn, fails only because its one-use ai_facing has no mapping to check.
- Q2 frame constants: every index is in range for its model, except the actor (TABLES-009). The 1,535 name differences are naming only: attak1_1/attaka1, jump1/jump01, shambler fr_N, and classic death33.
- Q3 bg_itemlist: 1,032 of 1,032 fields exact. Muzzle tables: base and rogue 212 of 212, rerelease 290 of 290. Normals, sphere points and EFX presets (546 of 546) are exact.
- Bot parsers read 800 real records from every rerelease bots/*.txt with 0 errors. BOT_WEAPON_BINDINGS matches weapons.txt with no unbound names.
- All 1,189 Q1 action names were resolved. 418 mission pack, 122 MG3 heavy and 142 base actions were checked for a real handler by instantiating definitions with a stub, so frame-action throws at monster-actions.ts:190 are not reachable from those tables.

## Findings
### TABLES-001 — Prox Launcher uses the Grenade Launcher's view and world models
- **Verification (VERIFY-M): confirmed. Final severity: Medium.** definitions.ts:20 has v_launch/g_launch. gitem rows in rogue/gamex86.dll (0x20060dcc) and game_x64.dll (0x180196168) read g_plaunch and v_plaunch; rogue/pak0.pak contains both models and no v_launch/g_launch. The only v_plaunch reference in src is the proxskin preload at catalog/weapons.ts:124.
- Severity: Medium
- Category: bug
- Location: src/content/q2/missionpacks/weapons/definitions.ts:20
- Confidence: reproduced (table vs DLL and pak)
- Evidence: `viewModel: "models/weapons/v_launch/tris.md2", worldModel: "models/weapons/g_launch/tris.md2"`. The gitem row in q2/rogue/gamex86.dll reads `weapon_proxlauncher|models/weapons/v_plaunch/tris.md2|models/weapons/g_plaunch/tris.md2`, and game_x64.dll also uses g_plaunch. Both v_plaunch (66 frames) and g_plaunch exist in rogue/pak0.pak and rerelease pak0. v_launch and g_launch are not in the rogue pak; they load only from baseq2. catalog/weapons.ts:124 preloads `models/weapons/v_plaunch/proxskin.pcx`, but no code selects that model. A grep finds no override.
- Impact: In Ground Zero and the rerelease, the prox launcher looks like the grenade launcher in hand and on the floor.
- Remediation: Change both paths to v_plaunch and g_plaunch. Frame ranges already match (66 frames).

### TABLES-002 — Rogue Hornet plays the base game's move distances
- **Verification (VERIFY-Q): confirmed. Final severity: Medium.** original/rogue/m_boss2.c:302-303, :329-330 (10, comment "normally all 8's"), :355-356, :372-373, :394-395 (2) and :407 (-5, comment "was -20"). The source explains the DLL data. Source review: SRCQ2
- Severity: Medium
- Category: bug
- Location: src/content/q2/missionpacks/monsters/rogue-variants.ts:90-92; src/content/q2/base/monsters/tables/boss2.ts:60, :82, :104, :115, :123, :129
- Confidence: reproduced
- Evidence: rogue-variants.ts spreads `...boss2Definition` with no `moves`, so the Rogue variant keeps base tables. Rogue DLL against the table: walk and run [50,69] are 10 per frame (table 8); attack_pre_mg [70,78], attack_mg [79,84], attack_post_mg [85,88] are 2 (table 1); attack_rocket [89,109] is 2 with -5 at index 12 (base table and base DLL: 1 with -20). DLL addresses: 200686b0, 200687b0, 20068830, 20068888, 200688c8, 200689d8. These are the only 6 of 367 Rogue DLL moves not matched by the base or rogue tables. The rerelease boss2.ts table already has these values, so the data exists.
- Impact: In classic Ground Zero the Hornet walks and runs 20% slower than the original and moves half as far per frame during attacks. One rocket frame has distance -20 instead of -5.
- Remediation: Add a rogue boss2 table, or override `moves` in the Rogue definition.

### TABLES-003 — Rerelease edition ignores rerelease item values for Tesla, Disruptor, Body Armor and Shard
- **Verification (VERIFY-M): confirmed. Final severity: Medium.** game_x64.dll rows: ammo_tesla quantity 3, ammo_disruptor 3, item_armor_body misc/ar3_pkup.wav, item_armor_shard i_armor_shard. missionpacks/items.ts:29-30 and foundation/items.ts:78-79 have 5, 15, ar1_pkup, i_jacketarmor. missionpacks/items.ts:113 overrides only ammo_trap for rerelease; no src file names ar3_pkup or i_armor_shard.
- Severity: Medium
- Category: bug
- Location: src/content/q2/missionpacks/items.ts:29, :30; src/content/q2/foundation/items.ts:78, :79
- Confidence: reproduced for the table difference, traced for use
- Evidence: Table against game_x64.dll gitem rows: `ammo_tesla` quantity 5, DLL 3; `ammo_disruptor` quantity 15, DLL 3; `item_armor_body` sound `misc/ar1_pkup.wav`, DLL `misc/ar3_pkup.wav`; `item_armor_shard` icon `i_jacketarmor`, DLL `i_armor_shard` (pics/i_armor_shard.pcx is in the rerelease pak). Classic rogue values do match (tesla 5, disruptor 15). items.ts and missionpacks/items.ts have no edition branch on these rows. Other compared rerelease rows match, apart from TABLES-005 and the blaster's world model and warning fields, which have no pickup effect.
- Impact: Rerelease Disruptor pickups give five times the ammo and Tesla pickups give 5 instead of 3. Armor pickup sound and shard HUD icon are wrong. Rerelease max-ammo values were not extracted, so capacities remain unverified.
- Remediation: Add per-edition overrides for these fields, and check rerelease capacities against InitClientPersistant in the DLL.

### TABLES-004 — Rerelease edition plays mission pack monsters from classic tables, losing rerelease callbacks
- **Verification (VERIFY-M): confirmed-with-changes. Final severity: Low.** index.ts:40 lists 16 classnames and :54 registers them for all editions. Independent scan confirms gekk_move_death1 [5], carrier_move_spawn [6,7,8,11], carrier_move_death [0], stalker_move_walk [0,4], widow2_move_walk [0,5] against the table. Correction: the gekk_move_swim_start example is wrong; game_x64.dll has an exact match at 0x180146e08 with callbacks at 8, 14, 20, alongside two other [291,322] moves without callbacks. The count of 18 was not re-derived (my scan of 4 table files alone finds 20 moves with no exact match).
- Severity: Low
- Category: bug
- Location: src/content/q2/missionpacks/monsters/index.ts:40, :51-54; tables xatrix-gekk.ts:58, :346; rogue-carrier.ts:107, :145; rogue-stalker.ts:72, :123, :133, :140, :152, :161; rogue-widow2.ts:8, :19, :30
- Confidence: reproduced for the table difference, traced for use
- Evidence: `q2OriginalMissionPackFallbacks` registers 16 classnames with the classic definitions for all editions. Distances match, but 18 rerelease DLL moves differ in think layout. Examples (DLL against table): gekk_move_swim_start 32 frames with no callbacks against callbacks at 8, 14, 20; gekk_move_death1 callback at frame 5 against none; carrier_move_spawn callbacks at 6-8, 11 against all 18; carrier_move_death first frame against last; stalker_move_walk callbacks 0, 4 against none; widow2_move_walk callbacks 0, 5 against none. Two rerelease [74,81] moves (DLL 0x145670, 0x1456f8) have no table in the project at all and no owner was identified.
- Impact: Rerelease footsteps and related per-frame callbacks are missing or differ for these monsters. I did not determine each callback's purpose.
- Remediation: Generate rerelease tables for these 16 monsters. generate-tables.ts already handles the format.

### TABLES-005 — ammo_grenades is marked rotating, which no original game does
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** original/baseq2/g_items.c:1413 has world_model_flags 0 for ammo_grenades. items.ts:46 has `rotate: true`. Source review: SRCQ2
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/items.ts:46, used at :456, :528, :618
- Confidence: reproduced
- Evidence: `rotate: true`. world_model_flags for ammo_grenades is 0 in baseq2, xatrix and rogue gamex86.dll and in game_x64.dll. The other ammo rows are false. items.ts:528 turns this into `entity.effects |= 1`.
- Impact: Grenade ammo pickups spin. Visual only.
- Remediation: Set `rotate: false`.

### TABLES-006 — Classic Quake plays rerelease frame numbers for the Knight attack and Shub death
- **Verification (VERIFY-Q): confirmed. Final severity: Low.** The cause is visible in the source. V101 knight.qc:50 lists `attackb1` twice and V101 oldone.qc:47 lists `shake12` twice, which shifts later frames by one. RR monsters/knight.qc:46 and shub.qc:50 removed the duplicates. Source review: SRCQ1
- Severity: Low
- Category: bug
- Location: src/content/q1/base/frames.ts:48-56 (knight_atk2-10), :1304-1311 (old_thrash13-20)
- Confidence: reproduced
- Evidence: q1/id1 progs: knight_atk2-10 are frames 44-52; the table and rerelease progs have 43-51. Classic old_thrash13-20 are 59-66; the table has 58-65. These 17 rows are the only classic/rerelease frame differences among 1,610 state functions. monsters.ts:76-80 special-cases classic behavior (boss_idle1, f_death2, f_death21, sham_magic11) but not these frames. Hipnotic and rogue progs have 0 such differences.
- Impact: In `q1-classic-id1`, these animations are one frame off, and frame 52 and frame 66 are never shown.
- Remediation: Add a classic frame offset for these rows in the same place as the other classic exceptions.

### TABLES-007 — Xatrix uses the base muzzle table, though its DLL differs in two rows
- **Verification (VERIFY-Q): confirmed-with-changes. Final severity: Info.** The Xatrix source agrees with the port: original/xatrix/m_flash.c:132-133 has row 57 as 24.8 and :227-228 has row 98 as 31.5*1.2, 9.6*1.2, 10.1*1.2, with the old values commented out. The difference exists only against the 1998 corpus DLL, which predates that fix. Whether to match that build is a choice, not a defect. Source review: SRCQ2
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/monsters/muzzle.ts:62, :103, used via muzzleOffset("classic", ...) (chick-heat.ts `shot(context, 57)`)
- Confidence: reproduced for the table difference
- Evidence: q2/xatrix/gamex86.dll: row 57 is (-24.8, -9, 39), the table has (24.8, -9, 39); row 98 (SOLDIER_BLASTER_8) is (41.4, 11.52, 7.32), the table has (37.8, 11.52, 12.12). All other rows up to the end of the xatrix table at row 137 match. The classic table is correct for base and rogue (212 of 212).
- Impact: In The Reckoning, chick rockets and one soldier blaster frame start from different points than the original. The row 57 value may be an id bug, but it is what the shipped mission pack does.
- Remediation: Add a xatrix override for rows 57 and 98, or record the divergence as intentional.

### TABLES-008 — 19 rerelease moves are absent from the DLL and unreferenced by the port
- **Verification (VERIFY-M): confirmed. Final severity: Info.** All 19 cited lines resolve to move names with zero references outside monsters/tables in src and tests, and no dynamic `_move_${` name construction exists in src/content/q2. Absence from the DLL was spot-checked on tank_move_stop_walk only (no valid mmove at [50,54]); the rest is carried from the original scan.
- Severity: Info
- Category: dead-code
- Location: rerelease/monsters/tables: tank.ts:358, :389; supertank.ts:364, :384; parasite.ts:190, :211; hover.ts:401, :411; flyer.ts:307, :318, :352, :360, :369; float.ts:491, :525; brain.ts:307; boss32.ts:723; boss31.ts:265, :288
- Confidence: reproduced
- Evidence: None of these move names appears outside the table files. No exact DLL mmove exists for them; the linker dropped them or the DLL's same-range moves have different data.
- Impact: About 167 rows of unreachable data. No gameplay effect.
- Remediation: Have generate-tables.ts skip moves no code references.

### TABLES-009 — Actor table indexes past the model, and wraps instead of resetting
- **Verification (VERIFY-Q): refuted. Final severity: Info.** ref_gl/gl_mesh.c:764-770 and :385-390 reset out-of-range frames to 0. prepare.ts:46-47 does the same for q2-md2, as VERIFY already found. Source-side detail: gl_mesh.c:773-778 resets `frame`, not `oldframe`, on a bad oldframe, but R_CullAliasModel at :391-395 has already cleared oldframe. Source review: SRCQ2
- Severity: Info
- Category: bug
- Location: src/content/q2/base/monsters/tables/actor.ts (moves walk [251,258], taunt [234,250]), src/render/scene/models/prepare.ts:44
- Confidence: traced
- Evidence: players/male/tris.md2 has 198 frames, while actorFrame has 481 constants (283 out of range). prepare.ts:44 uses `frame %= count`. From my knowledge of ref_gl, the original resets an out-of-range frame to 0; this was not checked against a binary. The out-of-range data itself matches the DLL.
- Impact: misc_actor walk and taunt play arbitrary low frames, differently from the original's frame 0. Rarely seen.
- Remediation: None needed beyond matching the renderer's reset if fidelity matters.

## Supplements
- Supplements CONTENT1-016: row-level duplicate rates against base tables: rogue-chick and rogue-brain 99.3%, rogue-float 97.5%, rogue-flyer 94.3%, rogue-mutant 94.1%, xatrix-brain 93.3%, rogue-medic 92.6%, rogue-berserk 92.2%, rogue-gunner 91.8%, rogue-parasite 90.7%. mg3_lavaman and rogue lavaman differ only in a few operations. Base and rerelease copies share only 3-11% of rows textually because of formatting, so that pair needs a value comparison.
- Supplements CONTENT2's note on `boss2_move_fidget` first=21 last=0 and floater_move_activate 30 rows for a 31-frame range: both are present in the DLLs with the same values, so they are source-faithful. floater_move_activate is filtered at floater.ts:11 and rogue-variants.ts:54, and boss2_move_fidget has no references.
