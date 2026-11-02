# VERIFY-W — SRC5, SRC6 and SRC3Q3-001, checked at HEAD fcdc8af5 against upstream/

`clean/src` matches the project `src` (`diff -rq` empty). Paths are relative to `src/`. Re-run here: `src5/repro-infront.ts`, `src3q3/load.ts` for q3dm1, q3dm3 and q3dm7, and a new yaw test, `vw/yaw.ts`. Everything else was checked by reading. Nothing from upstream was executed.

Totals: 34 IDs. 28 confirmed, 6 confirmed-with-changes, 0 refuted.

### SRC5-001
Verdict: confirmed-with-changes
Corrected severity: High
Reason: Reproduced: rerelease tank, player at 90 degrees, enemy stays null. `monsters/ai.ts:56` is `> 0.3`; g_ai.cpp:460-463 is 0.15 for an unalerted ambush monster, otherwise -0.30. Correction: ambush monsters are not wrong "in the other direction". 0.15 is a wider cone than 0.3, so the port is too narrow in both cases.

### SRC5-002
Verdict: confirmed
Corrected severity: High
Reason: `perception.ts:424-429` has the classic closeEnough return and the classic random step; `ai.ts:215-218`, `:211` and `:244` match the finding. m_move.cpp:1426-1449, :996-1003, :1012-1013 and :1135 differ as cited. `index.ts:382` is the only moveToGoal binding, so no rerelease override exists.

### SRC5-003
Verdict: confirmed
Corrected severity: Medium
Reason: `ai.ts:41-50` has no invisibility test, and `runtime.ts:3953` reads only Q1 powerups. `invisibilityUntil` and `invisibilityFadeUntil` are read only in `rerelease/players.ts`. g_ai.cpp:410-419, :822-826, :921-926 and :1276-1280 all gate on them.

### SRC5-004
Verdict: confirmed
Corrected severity: Medium
Reason: `perception.ts:344` and `ai.ts:323` are unconditional, where g_ai.cpp:1225 has the 100 unit test and :1425 calls ai_checkattack. `index.ts:814-824` `hold` sets no extra flags and `finish` clears moveTarget, against g_misc.cpp:412 and :421. `ai.ts:288` has no return-to-point test (g_ai.cpp:96-106).

### SRC5-005
Verdict: confirmed
Corrected severity: Medium
Reason: `perception.ts:459-460` uses a 3D `d1 <= distance`, and `index.ts:608` scales distance by frameSeconds*10; g_ai.cpp:1731 uses a box test. `:449` uses simple trail selection against p_trail.cpp:113-150, `:151-165` has only a health gate against p_trail.cpp:91-92, and `:477` keeps the yaw that g_ai.cpp:1795 restores.

### SRC5-006
Verdict: confirmed
Corrected severity: Medium
Reason: `ai.ts:289-292` has no `player_noise` exclusion (g_ai.cpp:109) and tests exact `!==`. I tried to limit the flicker to the turn time, but `vw/yaw.ts` shows changeYaw never lands exactly on the ideal yaw in 13088 of 20000 cases within 400 ticks, so the "up to 5 seconds" stands. The HuntTarget branch (g_ai.cpp:166-170) is also absent.

### SRC5-007
Verdict: confirmed
Corrected severity: Medium
Reason: `rogue-teams.ts:38` starts `steam` at -1, `travel.ts:28` returns new parms with no team, and `runtime.ts:4443` selects a spawn before `:4447` spawned. ROG client.qc:60, :102, :166-169 and :1666-1672 carry the team and assign it in ClientConnect. `src2q1/ents-rogue.json` shows flags in all 15 maps.

### SRC5-008
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: Correction: the port does test visibility at `perception.ts:226`, since `visualCandidate` (`:203`) mirrors G_MonsterSourceVisible. Only the `client->enemy == self->enemy` drop (g_ai.cpp:707) is missing. The sound, noise re-acquire, `tesla_mine` (`ai.ts:277`) and `ai_run` yaw items stand.

### SRC5-009
Verdict: confirmed
Corrected severity: Medium
Reason: `base/projectiles.ts:81-91` and `missionpacks/backpacks.ts:82` never set bit 256, while `gremlin-weapons.ts:113` and the rune and flag paths do. `physics.ts:274` pads 15 only with that bit, and WinQuake world.c:421-427 is the source rule. It also affects monster-dropped packs in single player.

### SRC5-010
Verdict: confirmed
Corrected severity: Low
Reason: `rogue-teams.ts:177-183` has no solid test, and `:162` runs assists before `:164` drops the flag. In the source, combat.qc:122 runs the obituary and TeamAssists before th_die, so the flag is still SOLID_NOT (teamplay.qc:1045) and findradius skips it. The attacker-scan +1 needs the attacker within 400 units of the carrier.

### SRC5-011
Verdict: confirmed
Corrected severity: Low
Reason: `rogue-teams.ts:140`, `:149`, `:155` and `:176-182` lack the prints in teamplay.qc:292-332, :1103-1108 and :1189-1191. teamplay.qc:1236-1262 prints no capture center text in one-flag mode, while the port always does. No player skin counterpart exists, and `playerSpawned` does not reset the timers (ROG client.qc:866-869).

### SRC5-012
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: Correction: the cited `runtime.ts:363-378` does not exist; `missionpacks/monsters/runtime.ts` has 196 lines and the branch is `:73-92`. The charm gap stands (`base/monsters.ts` clearShot against HIP fight.qc:91). The hostile gap is wider than dodging: `base/monsters.ts` `run` never writes `show_hostile` either, so `super.run` lacks HIP ai.qc:1131 too.

### SRC5-013
Verdict: confirmed
Corrected severity: Info
Reason: ROG misc.qc:355-360, newmisc.qc `rubble_use` and combat.qc:163-168, :343 read as cited; `shooters.ts` and `rogue-misc.ts:27`, `:31` differ. A scan of `ents-rogue.json` finds no `trap_shooter`, `rubble_generator` or `trigger_explosion` in any Rogue map.

### SRC5-014
Verdict: confirmed
Corrected severity: Low
Reason: `ai.ts:255`, `:273`, `:286` and `:354` test `distance !== 0`; g_ai.cpp:90, :280, :330 and :1589 also admit AI_ALTERNATE_FLY. `alternateFlyStep` is called only at `ai.ts:150`, and `alternateFly` is set by the floater, flyer, flipper and hover variants. The visible effect remains plausible, not observed.

### SRC6-001
Verdict: confirmed
Corrected severity: High
Reason: `ai.ts:161-165` and `:176-205` are one algorithm for all editions. m_move.cpp:659-664, :676-697, :717-728, :745, :750-770, :850-858 and :485-492 read as cited. No `bump_time`, `bad_move_time` or equivalent exists under `content/q2`.

### SRC6-002
Verdict: confirmed
Corrected severity: Medium
Reason: original/rogue/g_ai.c:18 and the `#ifdef SLIDING_TROOPS` else branch with `random() < 0.4` are real. `perception.ts:63-75` handles only fly, plus a rerelease-only straight branch, so classic Rogue walkers skip both the strafe and the RNG call.

### SRC6-003
Verdict: confirmed
Corrected severity: Low
Reason: original/rogue/g_ai.c `!self->flags & FL_FLY` clamps only when flags are 0, and `ai.ts:370` clamps only in rerelease; `ai.ts:49` lacks `trace.ent == other`. The clamp gap matters today, not only after SRC6-002, since classic Rogue dodges already reach `slide`.

### SRC6-004
Verdict: confirmed
Corrected severity: Low
Reason: `ai.ts:163-164` hard-codes 40 and 30. original/rogue/m_move.c:258-270 and m_move.cpp:458-463, :482-489 use 104 for `monster_carrier`, and `carrier.ts` has no height rule.

### SRC6-005
Verdict: confirmed
Corrected severity: Medium
Reason: `runtime.ts:2972` and `:4746` hard-code `infiniteAmmo: false`, and no Q2 file overrides it. `items.ts:587` and `:594` read dmflag 8192 in every edition. `q2-owner.ts` registers none of the cvars, and a grep of `content/q2`, `app` and `settings` finds only the comment at `types.ts:74`.

### SRC6-006
Verdict: confirmed
Corrected severity: Low
Reason: `items.ts:719-722` returns with `retained = true` and no schedule. p_weapon.cpp:275-280 calls SetRespawn with `hide_self` false in deathmatch, and g_items.cpp:181-198 schedules DoRespawn without hiding. The coop path correctly has no respawn. The DoRespawn body itself was not reopened.

### SRC6-007
Verdict: confirmed
Corrected severity: Medium
Reason: In quakec_ctf, `healthrot_nextcheck` is set at items.qc:211 and never read, and `item_megahealth_rot` is never assigned to `think`. `pickups.ts:398` sets `megaRotAt` for all rerelease programs, and `entity-services.ts:515-518` applies it. No CTF exemption exists.

### SRC6-008
Verdict: confirmed-with-changes
Corrected severity: Medium
Reason: Correction: MG is not rerelease only. `catalog/products.ts:24-25` lists classic MG products, which take the item-bound `health_rot` path (`pickups.ts:410-412`). The defect applies to `q1-rerelease-mg1` and `-mg3` (products.ts:31-32). On classic MG, `pickups.ts:434` regenerates only at deathmatch 1, where MG1 items.qc tests `deathmatch && deathmatch != 2`.

### SRC6-009
Verdict: confirmed
Corrected severity: Medium
Reason: MG1 monsters.qc:279-301 and the final death frames (knight.qc:217-220, dog.qc:239, :253) fade corpses. `addons/horde/index.ts:75-85` schedules a fade only for `progs/h_*` heads, and no `MonsterFade` or `FADETIME` exists under `content/q1`. Retention scales with non-gib kills, for the life of the map.

### SRC6-010
Verdict: confirmed
Corrected severity: Low
Reason: MG1 demon.qc:348-355 and dog.qc:91 gate on `attack_finished`, and the demon sets it to time + 0.5. `base/monster-actions.ts:29-34` and `foundation/monsters.ts:230-236` (dog) have no limiter.

### SRC6-011
Verdict: confirmed
Corrected severity: Low
Reason: `foundation/weapons.ts:144` emits `blood`, and `app/bootstrap/effects.ts:460` draws it as colour 73 with zero velocity. ID1 weapons.qc:457 uses colour 225 with '0 0 100', and MG3 weapons.qc:477, :490, :498 use 246. `addons/effects.ts:54` uses 225 for all programs.

### SRC6-012
Verdict: confirmed
Corrected severity: Medium
Reason: `pickups.ts:404` and `:409-414` re-fire key targets in coop and never respawn a coop suit, because `:409` respawns only in deathmatch. MG1 items.qc:975, :1137-1142 and MG3 items.qc:1045, :1207-1212, :1237-1242 read as cited. No addon rule supplies either behaviour.

### SRC6-013
Verdict: confirmed
Corrected severity: Medium
Reason: `foundation/types.ts:198` holds 8 base weapons, and `composition/q1/commands.ts:25-31` cycles them. `selectWeapon` stores the registered grapple id in `player.weapon` (`entity-services.ts:635`), so the index is -1, giving axe on next and rocket launcher on previous. CTF weapons.qc:1198-1207 and :1328-1336 include the hook. `Q1Ctf.impulse` returns false for 10 and 12.

### SRC6-014
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: Correction: the strength rune sound is reached on the native path, because `fireRegisteredWeapon` calls `weaponBeforeFire` (`entity-services.ts:221-222`), which runs `ctf:rune_weapons` (`arsenal.ts:63-69`). It is missing only on the `q1-threewave` slot path (`grapple-runtime.ts:131`). Impulses 31 and 99, the missing `hostileUntil`, and the absent DEATH log (21 LogPlayer sites in CTF client.qc) stand.

### SRC6-015
Verdict: confirmed
Corrected severity: Low
Reason: mg3_weapons.qc:243-247 returns on `trace_ent == self.owner`, and :387 sets `self = self.owner.owner` (the player, whose owner is world), so a center trace that hits no entity skips the side traces. `hipnotic-weapons.ts:134-146` always runs all three. MG3 fish.qc:79-84 differs from `base/frames.ts:880` (chance 0.5, no timer).

### SRC6-016
Verdict: confirmed
Corrected severity: High
Reason: `q2-downloads.ts:255-260` throws after `yield map`, including when permission is denied, since the loop at `:310-323` continues into the generator. `:332` rethrows, `q2-client-receiver.ts:95-100` and `q2.ts:698` have no guard, and `remote-application.ts:2286` rethrows into APP-001. Q2 cl_main.c:1315-1318 uses ERR_DROP. The process exit was traced, not run.

### SRC6-017
Verdict: confirmed
Corrected severity: Low
Reason: `catalog/index.ts:146-147` lowercases; files.c:2289-2318 uppercases and maps `\` and `:` to `/`. For `z_mod.pk3` and `zz.pk3` the sort order flips, so a different pak has top priority after `.reverse()`.

### SRC6-018
Verdict: confirmed
Corrected severity: Low
Reason: `compat/qc/spatial-host.ts:41-48` always calls setSize, and no QW override of `setmodel` exists; QW pr_cmds.c:190-197 sizes only `*` models. `quakec-source.ts:354-358` and `mod-provider.ts:332-338` have no `ip`, `ping`, serverinfo or localinfo handling (QW pr_cmds.c:1549-1577). A repo grep finds no `serverinfo` or `localinfo` server command.

### SRC6-019
Verdict: confirmed-with-changes
Corrected severity: Low
Reason: Corrections: `missionpacks/monsters/flyer.ts:49` does not run for a rerelease `monster_flyer`, which uses `rerelease/monsters/base-variants/flyer.ts` (no `blocked`), and the kamikaze has mass 100. Rerelease Gekk can use plats: the default at `index.ts:739` has a platform branch for all kinds; only the jump is missing. Stalker (`stalker.ts:175-185`) and widow (`widow.ts:126-129`) stand; both are in the fallback set at `index.ts:40`.

### SRC3Q3-001
Verdict: confirmed
Corrected severity: High
Reason: Reproduced: q3dm1 loads, and q3dm3 and q3dm7 throw "Unimplemented authored Q3 spawns" in deathmatch and singleplayer. The throw is at `app/bootstrap/simulation/q3/runtime.ts:566-567`; `content/q3/base/game/spawn.ts:238-241` already warns and frees, and g_spawn.c:304-305 and :475-476 continue. q3dm4, q3dm5, q3dm10 and q3dm18 were not re-run.
