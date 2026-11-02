# VERIFY-O2 — verification of TAB1, TAB2, TAB3 and DOCS5 at HEAD fcdc8af5

### TAB1-001
Verdict: confirmed
Corrected severity: Info
Reason: `rg SHADEDOT_QUANT|ANORM_DOTS_ROW` over src, tests and tools hits only the declarations at shadedots.ts:2,:5. renderer.ts, the only other reader of the table, uses literals at :296, :300, :302.

### TAB2-001
Verdict: confirmed
Corrected severity: Low
Reason: Reproduced from the loaded manifests: monster_mummy lists only z_gib, z_hit, z_idle, z_miss, z_shot1; lava man only out1, throw; eel, wrath, gremlin and scourge lack eactive1, wdthc, grem/idle, tailswng. `rg precache` over q1/missionpacks/monsters/*.ts has no hits.
catalog/monsters.ts:34 requests only `creature.resources`; startup-selection.ts `monsterChoices` tests only those files; audio.ts:334 registers on first play. Delay only, so Low stands.

### TAB2-002
Verdict: confirmed
Corrected severity: Low
Reason: expansions.ts:172-174 merges every base creature's resources into each MG3 class. Reproduced 131, 129, 141 for monster_super_shambler, monster_army_infected, monster_ranged_knight. The startup check requires all of them (`creature.resources.every` in monsterChoices). Necessity of the union remains unproven, as the finding says.

### TAB2-003
Verdict: confirmed
Corrected severity: Low
Reason: catalog/index.ts:621-630 checks archives, directory and witness, never programs. content.ts:163-164, :171-172 and source-program.ts:9 exclude built-in rows. products.ts:47-48 requires gamex86.dll while q2/rerelease/baseq2 holds only game_x64.dll, pak0.pak, music, video. The launch-failure case was not run here either.

### TAB2-004
Verdict: confirmed
Corrected severity: Info
Reason: expansions.ts:164-165 omits them. Reproduced: rogue has no monster_dragon or monster_morph, hipnotic has no monster_spikemine, hipnotic has monster_armagon. roster.ts:22-23 lists all three and dragon.ts:143, morph.ts:73, spikemine.ts:4 define them. Intent is unrecorded, so Info stands.

### TAB2-005
Verdict: confirmed
Corrected severity: Info
Reason: normals.ts:5, direction-byte.ts:13 and network/q2/anorms.ts:3 are separate literal tables (174, 206, 167 lines). `rg 0.525731` finds exactly these three in src and tools, and no test file references any of the three paths.

### TAB3-001
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Crakhor does not reach the throw at native-held-weapon.ts:33 on the corpus with a stock guest. No loose dir or pak under qfiles/q2 has players/crakhor/tris.md2, runtime.ts:7413 pushes the body before the attachment (:7414), and presentation-scene.ts:196 hits assets.ts:325 "Model is absent" first (GAPQ12-001 family). With a foreign character, runtime.ts:7403 skips both. startup-selection.ts:270-271 never offers crakhor because it requires tris.md2.
The defect is real for its other trigger: reproduced throw and 19/19 crakhor digests unlisted (component level, fake provider). Any third-party Q2 model with tris.md2 and a weapon file but no `.attachment.json` passes the body and throws at :33, ending the process under APP-001; end-to-end not run. Medium: a process exit limited to a native guest with a foreign arsenal.
Remaining routes to :33 with crakhor, not run: a guest that sets modelindex2=255 with modelindex!=255 (classic-guest-services.ts:346-348), or a crafted unified-server frame carrying nativeHeldWeapon (unified-frame-values.ts:49, APP-002 family). The stock DLL's modelindex state was not disassembled.

### TAB3-002
Verdict: confirmed
Corrected severity: Info
Reason: combat-profile.ts:24 digest is sha256:8187df..., and qfiles/q2/xatrix/gamex86.dll is 0b0d119e..., matching combat-profile.ts:84. No gamex86*.dll under qfiles hashes to 8187df. native-primary-weapon-profile.ts:80-82 returns null for 0b0d, so native-primary.ts:29-31 returns null. The 0-of-7 range count was not re-run.

### TAB3-003
Verdict: confirmed
Corrected severity: Info
Reason: Reproduced by hashing rerelease pak0: :56 (male40Joint) is table index 40 and is male and cyborg md5/a_grenades.md5mesh; :115 (female99Joint) is index 99 and is female md5/a_grenades.md5mesh. :134 is index 118, classic players/cyborg/weapon.md2, after the female block. No row names its model.

### DOCS5-001
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Recount: the table has 29 rows, all open, and DOCS2-004 (37), DOCS4-006 (77) and DOCS5-001 are pairwise disjoint, so 143 is correct only as raw addition. It carries two errors. VERIFY-O already removed :240, :709 from DOCS4-006 (68 false + 7 partial). Here :379 is true as written ("startup has no...": registerServerSettingsMenu is reached only from ui.ts:206, and the finding itself says "True for the startup menu only"), and :936 is not shown false (its "not registered" paraphrase omits "complete", and completeness is unestablished). :124 was wrongly excluded: its sentence is about the catalog, is identical to :122-:123, and expansions.ts:59, :164 also offer armagon. So DOCS5-001 is 28 rows, and the combined total is **140 of 184 (76%) with a false clause or partial, 119 (65%) wholly false, 44 not shown false**. Adding the 7 disjoint rows excluded here (DOCS-004 4, DOCS2-005 3) gives at most 147.
Wholly false, held (14): :388, :376 (content.ts:163-164; q2-native-world.ts:20-26 and classic-guest-source.ts:22-32 have no digest gate), :43 (id1-program.ts:84 derives a binding for unknown programs), :846, :604, :572, :706, :212, :700, :647, :345, :122, :123, :124. Clause or partial (14): :915, :903, :930, :323, :208, :534, :25, :260, :285, :875, plus :525, :228, :229, :791 downgraded here. :525: "one player per connection" is true (network/q2.ts:722), and multi-seat works through independent connections (remote-application.ts:1829, :1936; remote-seat-source.ts:149). :1365 is the Q3 branch and q2.ts:254 is the host, so those anchors do not support it. :228, :229, :791: false only with rerelease data; classic-only still loads q3-baseq3 (bot-assets.ts:52) and hits bots.ts:221, :621-624.
Anchor fix: :846's mod-selection.ts:12, :120 and ui/mods/menu.ts:20 are gameplay-mods.json add-ons, not fs_game. Real path is content.ts:210, :233, runtime.ts:3343. Supplement to DOCS4-009 becomes 16 of 29, not 18 (VERIFY-O's 14 plus launch-selection and multiplayer.setup; rotation-editor drops).

### DOCS5-002
Verdict: confirmed
Corrected severity: Low
Reason: Scripted over the ledger: exactly 12 rows cite players.ts (:454, :461-471), 2 of them open. The file is 42 lines at HEAD and at 167bfbf1, with 0 matches for quad|double|chainfist|etf|heat at cutoff. Modifier and expiry code is at missionpacks/items.ts:17, :120, :144, :153.

### DOCS5-003
Verdict: confirmed
Corrected severity: Low
Reason: Recounted: 300 rows, 169 done, 193 cells, max share 11, 95 done rows sharing with another done row (96 counting open rows), 14 cite tests, 38 re-export entries; no q2.weapon.* row cites weapons/player.ts. :466 and :509 cells have 0 hits for nuke and haste; multiplayer/lmctf/runes.ts:142 owns haste. client-think.ts:251 is the only PW_ check, client-effects.ts:129, :168, :184 hold the logic. :895's q3.ts and q3-client.ts have 0 haptic hits, though its cell also cites src/input/haptics.ts. team.ts has 0 subject hits for :800-802.

### DOCS5-004
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: 7 of the 10 "no hit" rows hold, not 10. :372 and :377 cite startup-selection.ts, whose :317 calls `catalog.authoredStartsFor`, so the cell reaches the owner. :906 cites app/bootstrap/audio.ts, whose :6 imports `geometryTransmission` with 13 geometry hits. The other owner-table gaps hold: every listed owner file exists and is uncited in the rows sampled, and q1.config.commands-console names capture.ts in its reason but not its cell.

### DOCS5-005
Verdict: confirmed
Corrected severity: Low
Reason: :716 says "current five capture tests"; tests/capture/application.test.ts generates 8 (:49 x2, :139 x3, :202 x2, :230), all skipIf on SDL_VIDEODRIVER, and package.json `test` is plain `bun test`. :371 says eleven; products.ts:42-55 has 14 Q2 rows. :775: `rg -w ItemLifecycle` over src has zero hits. :374 says the world change "releases the prior runtime"; AUDIT-001 was confirmed High in VERIFY-G.
