# TAB1 — Hand read of data tables, part 1 (tables-part1.txt, 37 files, 14,882 lines)
## Coverage
Read in full, verbatim: src/content/monsters/q1.ts, src/content/monsters/q2-rerelease.ts, src/content/composition/q2-q1-supply.ts, src/compat/qvm/legacy-bot-abi.ts, src/persistence/qvm-grapple.ts, src/render/scene/models/shadedots.ts, src/content/q1/addons/monsters/bosses/frames/ghost.ts, src/content/q1/addons/monsters/bosses/frames/szombie.ts, src/content/q1/addons/monsters/heavy/tables/mg3_rknight.ts, src/content/q1/missionpacks/monsters/tables/lavaman.ts, s_wrath.ts, wrath.ts, rottweiler.ts; src/content/q2/foundation/monsters/moves.ts lines 1-700.
Read through a lossless compact view (<scratchpad>/tab1/rle.awk, compact.py, compact2.py), which keeps every value and non-row line but collapses runs of identical rows to a count and consecutive frame constants to a range: moves.ts lines 700-1623 and the other 23 Q2 tables in the list. rogue-soldier.ts frame constants were read verbatim. Rows that matched no known shape printed verbatim, so no row was dropped.
Skipped: none.
Not provable from local assets: legacy-bot-abi.ts. qfiles has no 1.16n or 1.17 QVM. The table agrees with the 1.17 g_public.h order from memory, which is not proof.

## Strengths
New checks, none of which TABLES.md had:
- shadedots.ts, which TABLES.md listed as 0 of 4,096 checked, is now proven by formula. With s = (cos(r*22.5deg), -sin(r*22.5deg), 1)/sqrt(2) and d = dot(ALIAS_NORMALS[i], s), every one of the 16x162 entries equals (d > 0 ? 1 + d : 1 + 0.3*d) within 0.005, which is two-decimal rounding. All 94 filler columns in all 16 rows are 1.00. Script: <scratchpad>/tab1/shade.ts (reproduced).
- Q2 `end` callback identity. TABLES.md compared only presence. For the 898 moves with one DLL candidate, each end name maps to one DLL address per DLL, apart from aliases folded in the binary (the shared *_dead bodies). The Rogue-only `soldier_move_death4 -> soldier_dead2` is real and has a handler (rogue-soldier.ts:133 in missionpacks/monsters). Limit: 114 moves with several candidates were not included.
- AI function identity on the same 898 moves is one-to-one per DLL. The only conflict is rerelease tank_move_start_walk, in tank.ts, outside this scope. It matches the DLL's start_run because the DLL has no start_walk (dead move, TABLES-008 family).
- Every `end` and action name in the 24 Q2 tables in scope has a handler identifier outside the tables (static name check, <scratchpad>/tab1/handlers.py).
- Header provenance on the 7 Q1 tables matches the s_file strings in progs.dat, including the surprising name: dog_stand1 lives in quakec_hipnotic/monsters/rottweiler.qc and quakec/monsters/rottweiler.qc.
- Precache lists: q1.ts has 87 of 87 monster sounds matching base code, with none missing and none unused. q2-rerelease.ts is missing nothing that its monster plays on these classnames. The hits weapons/plasshot.wav, weapons/phaloop.wav and weapons/laser2.wav belong to monster_gladb and the soldier variants, which have their own lists in q2-expansions.ts.
- qvm-grapple.ts reads every field of QvmGrappleDefinition. Its comment about later validation is true: grapple-provider.ts:44 re-reads the profile against the artifact, and qvm-grapple-selection.ts:40 requires deep equality with the mounted profile.
- q2-q1-supply.ts: every weaponOwners row satisfies the check at world/gameplay/pickups.ts:201, the hipnotic item ids exist in catalog/weapon-hud.ts:33-35, and the header comment matches the rows.

Outliers checked and found source-true, so they are not defects (progs or DLL agree):
- ghost.ts:67 `ghost_diee9` frame 93. Neighbours suggest 102, and frame 93 is ghost_died9's pose, but mg3 progs has 93. This is an upstream QuakeC typo, preserved.
- szombie.ts:83 `szombie_attb14` frame 77 (duplicate of attb13); szombie.ts:19 `szombie_hang1` frame 162.
- s_wrath.ts:109 `overlord_die10` frame 99 (duplicate of die09); s_wrath.ts:118 `overlord_die19` frame 107 (duplicate of die18).
- wrath.ts has no die01 or die06, and s_wrath.ts:100 overlord_die01 is unreachable. monster_wrath and monster_super_wrath store fn:wrath_die02 and fn:overlord_die02 as th_die.
- mg3_rknight.ts:66 and 6 other rows have `next: "rknight_run"`, which is a function and not a frame. progs agrees and rune-knight.ts:42 has the handler.
- ghost.ts:14 `ghost_run6` next ghost_stand1.
- rerelease/tables/brain.ts:307 and base/tables/brain.ts:82 `brain_move_defense`: 9 rows for an 8-frame range. The extra row is never reached, and the move is unreferenced.
- rerelease/tables/boss32.ts:573 `makron_move_walk` uses `run` rows. It passes the AI comparison in tables/q2strict.ts and is not among TABLES' 20 unmatched moves. It was not in my 898-move identity check, because walk and run have identical data.
- rogue-widow2.ts:43 `widow2_move_attack_post_beam`: 3 rows for a 2-frame range.

## Findings
### TAB1-001 — shadedots.ts exports its dimensions, but the only consumer hard-codes them
- **Verification (VERIFY-O2): confirmed. Final severity: Info.** `rg SHADEDOT_QUANT|ANORM_DOTS_ROW` over src, tests and tools hits only the declarations at shadedots.ts:2,:5. renderer.ts, the only other reader of the table, uses literals at :296, :300, :302.
- Severity: Info
- Category: maintainability
- Location: src/render/scene/models/shadedots.ts:2, :5; src/render/scene/models/renderer.ts:296, :300, :302
- Confidence: traced
- Evidence: `export const SHADEDOT_QUANT = 16;` and `export const ANORM_DOTS_ROW = 256;` have no reader in src, tests or tools. renderer.ts uses literals: `row = Math.trunc(yaw * 16 / (2 * Math.PI)) & 15` and `r_avertexnormal_dots[row * 256 + normalIndex]`.
- Impact: None at runtime. The named constants read as the contract but enforce nothing.
- Remediation: Use the constants in renderer.ts, or delete the exports.

## Supplements
- Supplements TABLES coverage: shadedots moves from 0 to 4,096 of 4,096 by closed-form proof (see Strengths), and the part 1 share of TABLES' 110 "script only" files has now been read by hand with no new data defect.
- Supplements CONTENT2-017 and TABLES-008: moves in this scope with no identifier reference outside tables, beyond TABLES-008's rerelease list: xatrix-boss5 turn_right, turn_left, backward, attack4, attack3; xatrix-fixbot pickup, land, death1, backward, start_attack, attack1; rogue-flyer stop, rollright, rollleft, defense, bankright, bankleft; rogue-hover start_attack2, end_attack2; base parasite stop_run, stop_walk; base brain defense. Static name check only; not checked for dynamically built names.
