# TAB2 — Hand read of data tables, part 2 (37 files in tables-part2.txt)
## Coverage
Read in full: all 37 files (14,875 lines) at HEAD fcdc8af5. Nothing skipped.
Read verbatim: catalog/products.ts, q1/base/messages.ts, monsters/expansions.ts, compat/q2/classic/layout.ts, audio/reverb-presets.ts, q3/base/shared/direction-byte.ts, formats/q12-model/normals.ts, plus the move rows of rerelease gunner.ts and boss31.ts.
Read through a reformat, with scripts in <scratchpad>/tab2 (compact.py, c2.py): the other Q1 and Q2 tables and foundation/monsters/frames.ts. The reformat shortens JSON keys, run-length encodes identical adjacent move rows, and collapses frame constants into numbered ranges where index and value both increase by one. Any line that did not match the row patterns printed verbatim. No output line hit the display cut. So identical adjacent rows were read as a count, not one by one.
Not available locally: game.h, q_shared.h and the QuakeC and rerelease C++ sources. layout.ts offsets were checked by summing field sizes and against my memory of those headers, not against a copy.

## Strengths
- No wrong row, copy-paste row or misnamed move was found in any Q1 or Q2 table in scope. Every apparent outlier I examined is either source behavior I recognize or was already matched to the binaries by TABLES: tank_move_attack_chain ai "none", tank_move_stop_run ending in tank_walk, flipper pain1/pain2 frame ranges swapped by name, mummy_attb13 and attb14 sharing frame 77, dragon_atk_f3 and f4 sharing frame 60.
- Every table header names the right monster and source file for its table.
- layout.ts: all struct sizes sum correctly (usercmd 16, player state 184, edict 260, trace 56, pmove 240), 44 imports x 4 = 176 bytes, export offsets 4-60 with 80 total. Import order and signatures match game_import_t as I recall it.
- messages.ts: the suspicious `$qc_discharge_slime` and `$qc_discharge_lava` rows reading "into the water" are correct. Classic id1, hipnotic and rogue progs contain only that one string. The other obituary fragments I searched for (30) and all 16 monster strings are in id1 progs.dat.
- products.ts: every built-in row reports installed on the local corpus, so its map witness and archives resolve. The exception is q3-demota, which is correctly missing because that media is absent. lmctf09 is in pak5 rather than the listed pak0, which passes because index.ts:629 searches every archive in the directory.
- reverb-presets.ts: index 19 is "plain", and the two fallback uses described in its comments match audio/environments.ts:58-61 and :145-146.

## Findings
### TAB2-001 — Expansion creature manifests omit sounds their frame tables play
- **Verification (VERIFY-O2): confirmed. Final severity: Low.** Reproduced from the loaded manifests: monster_mummy lists only z_gib, z_hit, z_idle, z_miss, z_shot1; lava man only out1, throw; eel, wrath, gremlin and scourge lack eactive1, wdthc, grem/idle, tailswng. `rg precache` over q1/missionpacks/monsters/*.ts has no hits. catalog/monsters.ts:34 requests only `creature.resources`; startup-selection.ts `monsterChoices` tests only those files; audio.ts:334 registers on first play. Delay only, so Low stands.
- Severity: Low
- Category: bug
- Location: src/content/monsters/expansions.ts:121 (monster_mummy), :80 (monster_eel), :23 (monster_gremlin), :5 (monster_scourge), :104 (monster_wrath), :156 (monster_lava_man)
- Confidence: reproduced for the list difference (<scratchpad>/tab2/res.ts), traced for use
- Evidence: monster_mummy lists z_gib, z_hit, z_idle, z_miss, z_shot1, but tables/mummy.ts plays zombie/z_idle1.wav (:56), z_pain.wav (:96), z_pain1.wav (:108), z_fall.wav (:116). The base zombie entry at monsters/q1.ts:140-145 lists all four, so the mummy list looks like a trimmed copy. Also unlisted: eel/eactive1.wav (tables/eel.ts:11, :17), grem/idle.wav (tables/hipgrem.ts:22), scourge/tailswng.wav (tables/hipscrge.ts:59), wrath/wdthc.wav (tables/wrath.ts:89), boss1/sight1.wav and boss1/death.wav for the lava man, whose list has only out1 and throw (tables/lavaman.ts:6). No module in q1/missionpacks/monsters precaches these outside the tables.
- Impact: For a creature selected as a replacement, catalog/monsters.ts:33-34 and precache.ts request only the listed files. An unlisted sound is first loaded when it plays (app/bootstrap/audio.ts:334 `bank.register`), which adds a disk read and decode during play and delays that first sound. startup-selection.ts:592 also does not check these files when it decides a creature is installed. The sounds still play if the file exists.
- Remediation: Add the missing paths, or derive the sound list from the frame tables with a test that compares them.

### TAB2-002 — Every MG3 creature's manifest also contains all base monster resources
- **Verification (VERIFY-O2): confirmed. Final severity: Low.** expansions.ts:172-174 merges every base creature's resources into each MG3 class. Reproduced 131, 129, 141 for monster_super_shambler, monster_army_infected, monster_ranged_knight. The startup check requires all of them (`creature.resources.every` in monsterChoices). Necessity of the union remains unproven, as the finding says.
- Severity: Low
- Category: performance
- Location: src/content/monsters/expansions.ts:172-174
- Confidence: reproduced for the counts, traced for use
- Evidence: `resources: [...new Set([...Object.values(source.creatures).flatMap(creature => creature.resources), ...definition.resources])]`. monster_super_shambler has 131 resources against 22 of its own, monster_army_infected 129 against 25, monster_ranged_knight 141 against 22. The base union is 129 paths, across all 14 MG3 classes. The Dopa and MG1 providers have no such merge.
- Impact: Selecting one MG3 creature requests every base monster model and sound at load, and the startup availability check requires them all. I did not prove the union is unnecessary: tests/content/catalog/expansion-weapons.test.ts:50 refers to "source precaches", so it may be deliberate, but no comment says so.
- Remediation: Request definition.resources plus only what MG3 creatures reference, or state the reason in a comment.

### TAB2-003 — `requiredPrograms` is never enforced for built-in product rows
- **Verification (VERIFY-O2): confirmed. Final severity: Low.** catalog/index.ts:621-630 checks archives, directory and witness, never programs. content.ts:163-164, :171-172 and source-program.ts:9 exclude built-in rows. products.ts:47-48 requires gamex86.dll while q2/rerelease/baseq2 holds only game_x64.dll, pak0.pak, music, video. The launch-failure case was not run here either.
- Severity: Low
- Category: maintainability
- Location: src/content/catalog/products.ts:11, :34-35, :47-48; src/content/catalog/index.ts:621-630; src/app/bootstrap/content.ts:163-164, :171-172; src/content/catalog/source-program.ts:9-10
- Confidence: reproduced for availability (<scratchpad>/tab2/cat.ts against qfiles), traced for the launch path
- Evidence: Availability checks only archives, the directory and the map witness. The three other readers exclude built-in rows with `!expectedProducts.some(...)`. On the local corpus q2-classic-mg2 and q2-classic-n64 report installed with `gamex86.dll` required, but their directory q2/rerelease/baseq2 holds only game_x64.dll. q1-quakeworld-hipnotic reports installed with `qwprogs.dat` required, but q1/hipnotic has none; it comes from the base q1/qw.
- Impact: The column reads as a requirement and is not one. A q1/qw directory without qwprogs.dat would report q1-quakeworld as installed, and the failure would surface only at launch through the artifact at content.ts:274. I did not run that case.
- Remediation: Check programs through the base chain during availability, or remove the column from built-in rows.

### TAB2-004 — Rogue and Hipnotic providers omit implemented monsters from selection
- **Verification (VERIFY-O2): confirmed. Final severity: Info.** expansions.ts:164-165 omits them. Reproduced: rogue has no monster_dragon or monster_morph, hipnotic has no monster_spikemine, hipnotic has monster_armagon. roster.ts:22-23 lists all three and dragon.ts:143, morph.ts:73, spikemine.ts:4 define them. Intent is unrecorded, so Info stands.
- Severity: Info
- Category: bug
- Location: src/content/monsters/expansions.ts:164-165; src/content/monsters/roster.ts:22-23; src/content/q1/missionpacks/monsters/dragon.ts:143, morph.ts:73, spikemine.ts:4
- Confidence: reproduced (<scratchpad>/tab2/res2.ts)
- Evidence: Roster boss-role monster_super_wrath is in the rogue provider and monster_armagon is in the hipnotic provider, but `Object.hasOwn(rogue.creatures, "monster_dragon")` is false. No Q1 provider offers monster_dragon, monster_morph or monster_spikemine, although all three have definitions and roster.ts lists them.
- Impact: startup-selection.ts:589-592 cannot offer these as overrides, while other bosses and specials can be chosen. Authored maps still spawn them. This may be deliberate; nothing records it.
- Remediation: Add manifests for them, or record why they are excluded.

### TAB2-005 — Three separate copies of the 162-entry normal table
- **Verification (VERIFY-O2): confirmed. Final severity: Info.** normals.ts:5, direction-byte.ts:13 and network/q2/anorms.ts:3 are separate literal tables (174, 206, 167 lines). `rg 0.525731` finds exactly these three in src and tools, and no test file references any of the three paths.
- Severity: Info
- Category: maintainability
- Location: src/formats/q12-model/normals.ts:5; src/content/q3/base/shared/direction-byte.ts:13; src/network/q2/anorms.ts:3
- Confidence: traced
- Evidence: Each file holds its own literal table: `Math.fround` objects, frozen doubles, and network/q2/anorms.ts (167 lines, out of scope, not read beyond its header). TABLES confirmed the values match the binaries, so none is wrong today.
- Impact: About 500 lines of duplicated data with no test tying the copies together.
- Remediation: Keep one table and derive the others, or add a test asserting equality.
