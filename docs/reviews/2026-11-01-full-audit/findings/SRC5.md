# SRC5 — Items left "not compared" or "partly compared" by SRC3Q1A, SRC3Q1B, SRC4Q1A, SRC4Q1B, SRC3Q3 and SRC4Q2, against upstream/

HEAD fcdc8af5. Original paths are relative to `<scratchpad>/upstream/`: `ROG` and `HIP` = `quake-rerelease-qc/quakec_rogue` and `quakec_hipnotic`, `MG3` = `quake-rerelease-qc/quakec_mg3`, `RR2` = `quake2-rerelease-dll/rerelease`, `Q3` = `Quake-III-Arena/code`. Port paths are relative to `src/`, read from `<scratchpad>/clean`. Nothing from upstream was executed. Scripts are in `<scratchpad>/src5/`.

**This coverage is partial. Part D lists what was not reached. Treat those items as unaudited, not clean.**

## Coverage

### A. Scope list, from the six source files
| Source file | Item | Status in this pass |
|---|---|---|
| SRC3Q1A | world/rogue-teams.ts vs ROG teamplay.qc | Compared, both read in full, plus ROG client.qc team call sites |
| SRC3Q1A | monsters/charm, charmed-base, paths vs HIP ai.qc, grunt.qc, rottweiler.qc | Compared. `SoldierCheckAttack` body was not opened; its only source of difference was checked by diffing HIP fight.qc against quakec/fight.qc |
| SRC3Q1A | monsters/decoy vs hipdecoy.qc; spikemine vs hipspike.qc | Compared, no finding |
| SRC3Q1A | runtime.ts moveToEnemy, foundDefault vs RUN_STRAIGHT, SightSound | Compared (SRC5-012) |
| SRC3Q1A | commands.ts vs HIP and ROG cheat functions | Port read. The QC cheat functions were NOT opened |
| SRC3Q1A | presentation.ts beyond hammer frames; messages.ts; finale-text.ts | Port read. Strings and pose frames NOT diffed against classic data; the classic strings are not in the rerelease QC tree, which uses `$qc_` keys |
| SRC3Q1A | world/rogue-misc, rogue-plats, rogue-hazards, rogue-pendulum | Compared, both read in full. Pendulum table checked by script: all 26 frames, bounds, delays, impact and swing sounds match, including source typos at frames 22 and 23 |
| SRC3Q1A | selection.ts Rogue cycle and reverse cycles | Port read. The ROG cycle functions were NOT reopened |
| SRC3Q1A | player.ts vs ROG CheckPowerups | Compared, ROG client.qc:1395-1591. Shield and antigrav match |
| SRC3Q1A | backpacks.ts tossRogueBackpack, tossRogueWeapon | Compared (SRC5-009) |
| SRC3Q1A | world/shooters.ts: shooter_think, LaunchLaser, rogue:push | Compared (SRC5-013) |
| SRC3Q1A | travel.ts vs ROG client.qc parms | Compared (SRC5-007) |
| SRC3Q1A | monsters/scourge.ts tail, trigger think and touch | Compared, no new finding beyond SRC5-012. The frame-body checks for `scourge_die3` and `scourge_melee5` in tables/ were not run |
| SRC3Q1A | monsters/morph.ts, dragon.ts spawn functions | Compared, no finding (GAPQ12B-008 already covers morph) |
| SRC3Q1A | helpers.ts eelZap vs T_EELZap | Compared, ROG combat.qc:299-330. Matches, including the 85 radius and the self half |
| SRC3Q1B, SRC4Q1B | addons/brushes.ts 100-190 | Compared against MG3 func_toss.qc, misc.qc, misc_model.qc, rotate.qc, func_fade.qc, mg3_oldone_new.qc. No finding |
| SRC4Q1A | sphere-points.ts | Count verified (100). Value-by-value script did not match the QC layout, so values remain sampled |
| SRC3Q3 | R_FogFactor, R_InitFogTable, R_CreateFogImage, R_LoadFogs vs materials/fog.ts | Now opened and compared, except the gradient vector tail of R_LoadFogs. Matches; the identityLight colour is SRC2Q3-007 |
| SRC3Q3 | RB_DrawSun | Q3 renderer/tr_init.c:926 confirms `r_drawSun` defaults to `"0"`. The earlier recollection is now verified. No finding |
| SRC3Q3 | paksort | Opened: `FS_PathCmp` only. Port side NOT compared |
| SRC4Q2 | perception.ts rerelease branches vs RR2 g_ai.cpp | Compared, all of g_ai.cpp read with comments stripped (SRC5-001, -003 to -006, -008) |
| SRC4Q2 | ai.ts rerelease branches vs RR2 m_move.cpp | Compared m_move.cpp 1-130 and 860-1502 (SRC5-002). Lines 131-859 (`SV_movestep` and helpers) NOT read |
| SRC4Q2 | Frame thinkfuncs in rerelease m_*.cpp and mission packs | By script, `src5/mtables.ts`, see Strengths |
| SRC4Q2 | RR2 p_trail.cpp | Read lines 60-150 (SRC5-005) |

### B. Items with no public original
- `q1/addons/monsters/ai/path.ts`: `walkpathtogoal` is rerelease engine code.
- RR2 `gi.GetPathToGoal` and the nav system behind M_NavPathToGoal (m_move.cpp:1208): engine code. The port's `state.pathing` is never assigned, so path following is absent, and that cannot be compared. The `AI_NO_PATH_FINDING` fallback is what SRC5-002 compares.
- The retail `q1/quakec` pinned statement numbers: they target compiled retail progs, which are not in upstream. The constructors verify them at load.
- `kind: "unavailable"` bot paths in `client-admission.ts` and `server-commands.ts`: a port-only concept.
- Classic Rogue and Hipnotic localized strings: upstream holds only the rerelease `$qc_` form, so `messages.ts` and `finale-text.ts` have no public text to diff.

### C. Also read
`composition/q1/runtime.ts` 55-90, 120-136, 180-240; `composition/q1/clients.ts` 26-94; `composition/q2/index.ts` 95-132, 231-235; `q2/missionpacks/monsters/combat.ts` 82-115; `app/bootstrap/simulation/physics.ts` 266-276; `runtime.ts` 3942-3956, 4440-4448.

### D. NOT compared. The exact remaining list
Budget ran out on this pass, so these need another pass.
- SRC3Q1B and SRC4Q1B: MG1 client.qc diff beyond PutClientInServer; MG1 items.qc diff; CTF client.qc 905-1330 and the obituary after 1764; CTF items.qc rune section vs ctf/runes.ts; CTF combat.qc beyond the carrier hurt lines; `equipment/threewave-weapon.ts` vs CTF weapons.qc (port read only); MG3 mg3_weapons.qc laser touch and lightning chain; MG3 LightningDamage particle colour 246; upstream/Quake/QW pr_cmds.c and qw-qc beyond the quad line.
- SRC4Q1A: base/frames.ts and base/monster-actions.ts frame by frame for MG monsters; the tails of the capped MG3 monster diffs and of the MG1-vs-MG3 ai.qc diff; MG1 monster files other than boss.qc and zombie.qc.
- SRC3Q3: `qcommon/vm.c` VM_LoadSymbols, VM_ValueToSymbol, VM_Call, VM_VmProfile, VM_VmInfo, VM_ExplicitArgPtr; syscall argument shapes per trap; the GL and CPU shadow backends' pixel behaviour; `tr_mesh.c` R_ComputeFogNum (original opened; its port in `render/scene/world.ts` and `content/q3/presentation/scene.ts` was located but not read); the paksort port side.
- SRC4Q2: `rogue/g_ai.c`, `rogue/m_move.c` under `quake2-rerelease-dll/original`; m_move.cpp 131-859; species `*_blocked` callers other than infantry; `muzzle.ts` and non-script parts of `moves.ts`; `Pickup_Weapon` rerelease respawn timing; `G_CheckInfiniteAmmo`; the tail of `CL_RequestNextDownload`; `Throw_Generic` line by line.
- SRC3Q1A: the QC side of commands.ts and the Rogue weapon cycles, as noted in table A.

## Strengths
- **Frame tables.** `src5/mtables.ts` compared every `mframe_t` and `mmove_t`: rerelease `m_*.cpp` 329 moves and 4868 frames; `original/rogue` 251 moves and 3416 frames, with 0 mismatches; `original/xatrix` 120 moves and 1859 frames. The 82 rerelease and 133 Xatrix rows the script printed were inspected and are script artefacts: custom AI names compared as objects, inline lambda rows, and tables split by comments. No real row mismatch was found. The script does not parse `m_soldier.cpp` or the base monsters already covered by SRC4Q2.
- **Rogue teamplay.** `rogue-teams.ts` reproduces the fragile parts of teamplay.qc: the 80-second effective flag return from `time - super_time > 40`, the operator-precedence bug that awards the flag defence bonus twice (teamplay.qc:326-335), the `self.steam == flag1.team` status bug, the overlapping carrier frame branches, and `steam = -50` on an illegal team.
- **Rogue world.** Elevators, plat2, buttons, earthquake, buzzsaw and lightning trails match line for line, including `elvButnDir` and the unnormalized LightningDamage side offset. Buzzsaw path following works through a dedicated path touch (`rogue-ending.ts:53`).
- **Charm and decoy.** The charm state machine, the dangling `else` in `become_decoy`, and the absolute `nextthink` in `monster_dragon` are preserved.
- **M_CheckAttack_Base.** `defaultCheckAttack` matches g_ai.cpp:908-1091 for ranges, chances, blind fire and strafing.
- **Rule composition.** The production rerelease path registers `["xatrix", "rogue"]` (`composition/q2/index.ts:232`), so Rogue rules and hooks are live there. That supplies the rerelease damage debounce, target anger, medic gating and `last_player_enemy`.
- **Candidates dropped after checking:**
  - `func_explode` looked 32 units too high. `barrel_explode` adds the 32 back (MG3 misc.qc:127).
  - Rerelease `M_ReactToDamage` looked unported. `createRogueCombatHooks` covers it (`combat.ts:82-115`).
  - Buzzsaw corners looked unadvanced. See `rogue-ending.ts:53`.
  - Rogue `CheckPowerups` expiry looked unreachable. The extension frame runs before the foundation deletes expired powerups (`entity-services.ts:513`, `:520`).
  - `monster_morph` with no skin flag throws, but the source's `objerror` is also a host error.

## Findings

### SRC5-001 — Rerelease monsters use the classic view cone, so a player beside a monster goes unseen
- **Verification (VERIFY-W): confirmed-with-changes. Final severity: High.** Reproduced: rerelease tank, player at 90 degrees, enemy stays null. `monsters/ai.ts:56` is `> 0.3`; g_ai.cpp:460-463 is 0.15 for an unalerted ambush monster, otherwise -0.30. Correction: ambush monsters are not wrong "in the other direction". 0.15 is a wider cone than 0.3, so the port is too narrow in both cases.
- Severity: High
- Category: bug
- Location: content/q2/foundation/monsters/ai.ts:52-57; content/q2/foundation/monsters/perception.ts:203, :221
- Original: RR2 g_ai.cpp:447-464; used at :47, :627, :800
- Confidence: reproduced (`src5/repro-infront.ts`)
- Evidence: The original is `if (self->spawnflags.has(SPAWNFLAG_MONSTER_AMBUSH) && !self->monsterinfo.trail_time && !self->enemy) return dot > 0.15f; return dot > -0.30f;`. The port has one rule for all editions: `return dot(angleVectorsRule(self.angles, "native").forward, normalize(subtract(body.origin, self.origin))) > 0.3;`. Run with edition rerelease and a monster facing +X:
  ```
  player 300u at 90 deg (dot 0, g_ai.cpp:463 needs > -0.3): enemy null
  player 300u at 30 deg (dot .866): enemy player
  ```
- Impact: Rerelease monsters notice within about 145 degrees where the source gives about 215. Non-ambush monsters miss players at their sides and slightly behind them. Ambush monsters are also wrong in the other direction, since the source narrows them to dot 0.15 while they are unalerted.
- Remediation: Give `inFront` the rerelease branch, including the ambush test on `trailTime` and `enemy`.

### SRC5-002 — Rerelease M_MoveToGoal and SV_StepDirection are the classic versions, so monsters stair-step instead of walking straight at a clear goal
- **Verification (VERIFY-W): confirmed. Final severity: High.** `perception.ts:424-429` has the classic closeEnough return and the classic random step; `ai.ts:215-218`, `:211` and `:244` match the finding. m_move.cpp:1426-1449, :996-1003, :1012-1013 and :1135 differ as cited. `index.ts:382` is the only moveToGoal binding, so no rerelease override exists.
- Severity: High
- Category: bug
- Location: content/q2/foundation/monsters/perception.ts:416-430; content/q2/foundation/monsters/ai.ts:207-219, :244
- Original: RR2 m_move.cpp:1368-1472, :969-1015, :1135
- Confidence: traced
- Evidence: The port's only move attempt is `(Math.floor(game.host.random() * 4) !== 1 || ...) && stepDirection(context, state.idealYaw, distance)`, and then chase directions. The source differs in these ways, none of them in the port:
  - m_move.cpp:1426-1449: when `bad_move_time` has passed, turn in place if not `FacingIdeal`, and otherwise `SV_StepDirection` straight along `vectoyaw(goal - origin)` if a traceline is clear. A blocked direct line sets `bad_move_time = level.time + 5_sec`.
  - m_move.cpp:1452-1456: the random re-roll is gated by `random_change_time`, `AI_CHARGING` and alternate fly. Line 1463 sets `random_change_time`, and 1468 decrements `bad_move_time`.
  - m_move.cpp:1404-1421: `path_corner` and `point_combat` goals are snapped to the monster's Z once the monster reaches them in XY.
  - The source has no "next step hits the enemy" stop. Port line 424 keeps classic's `closeEnough` return.
  - m_move.cpp:996-1003: a turn that leaves the monster not `FacingIdeal` restores the origin and returns `allow_no_turns` (false in chase), so the next direction is tried in the same tick. Port ai.ts:215-218 restores and returns true.
  - m_move.cpp:1012-1013: a failed step restores `ideal_yaw` and `angles.yaw`. Port ai.ts:211 keeps them.
  - m_move.cpp:1135: a dead end sets `ideal_yaw = frandom(0, 360)`. Port ai.ts:244 sets the old direction.
- Impact: In the TS rerelease provider, monsters follow classic 8-direction chase even on an open floor. Approach paths, timing and getting stuck at dead ends all differ from the rerelease, in every level.
- Remediation: Add a rerelease branch to `moveToGoal`, and an `allowNoTurns` result with restore to `stepDirection`. `AI_NO_PATH_FINDING` behaviour is the right baseline while nav is absent. Exclude from this fix: the axis roll (CONTENT2-012) and the 180-degree turn (SRC4Q2-014), which are catalogued.

### SRC5-003 — The rerelease Invisibility powerup does not hide the player from TS monsters
- **Verification (VERIFY-W): confirmed. Final severity: Medium.** `ai.ts:41-50` has no invisibility test, and `runtime.ts:3953` reads only Q1 powerups. `invisibilityUntil` and `invisibilityFadeUntil` are read only in `rerelease/players.ts`. g_ai.cpp:410-419, :822-826, :921-926 and :1276-1280 all gate on them.
- Severity: Medium
- Category: bug
- Location: content/q2/foundation/monsters/ai.ts:41-50; content/q2/foundation/monsters/perception.ts:25-77, :190-193; app/bootstrap/simulation/runtime.ts:3953; content/q2/rerelease/index.ts:66-68; content/q2/rerelease/players.ts:369-370
- Original: RR2 g_ai.cpp:410-419 (`visible`), :822-826 (FindTarget), :921-926 (M_CheckAttack_Base), :1276-1280 (ai_checkattack); m_move.cpp:1297
- Confidence: traced
- Evidence: The source's `visible` includes `if (other->client->invisible_time > level.time) { if (other->client->invisibility_fade_time <= level.time) return false; if (frandom() > other->s.alpha) return false; }`. The port's `visible` is one trace. `monsterTarget` computes `invisible: (q1?.powerups.get("invisibility") ?? 0) > this.timeSeconds`, which reads only Q1 powerups, and no Q2 AI file reads `.invisible`. A repo grep shows `invisibilityUntil` and `invisibilityFadeUntil` are read only by the rerelease player files, for the alpha value at players.ts:369-370.
- Impact: A rerelease player who uses `item_invisibility` is translucent and has spent the item, but monsters see, chase and attack as normal. Firing also does nothing useful, since the reveal only changes alpha.
- Remediation: Expose the rerelease invisibility and fade times through `monsterTarget`, then add the four source checks. The `frandom` call must use the shared source RNG in source order.

### SRC5-004 — Rerelease point_combat rules are missing: no attacks on the way, and hold points do not guard
- **Verification (VERIFY-W): confirmed. Final severity: Medium.** `perception.ts:344` and `ai.ts:323` are unconditional, where g_ai.cpp:1225 has the 100 unit test and :1425 calls ai_checkattack. `index.ts:814-824` `hold` sets no extra flags and `finish` clears moveTarget, against g_misc.cpp:412 and :421. `ai.ts:288` has no return-to-point test (g_ai.cpp:96-106).
- Severity: Medium
- Category: bug
- Location: content/q2/foundation/monsters/perception.ts:344; content/q2/foundation/monsters/ai.ts:288, :323; content/q2/foundation/monsters/index.ts:814-815, :823-824
- Original: RR2 g_ai.cpp:47, :96-106, :627, :800, :1221-1227, :1423-1449; g_misc.cpp:405-431
- Confidence: traced
- Evidence:
  - Port `if (state.combatPoint) return false;` is unconditional. The source returns false only when `self->enemy && range_to(self, self->enemy) > 100.f`.
  - Port ai.ts:323 is `if (state.combatPoint) { context.moveToGoal(distance); return undefined; }`. The source first calls `ai_checkattack(self, dist)`, and with `AI_REACHED_HOLD_COMBAT` leaves combat-point mode when the point is more than 160 units away or blocked.
  - g_misc.cpp:412 sets `AI_STAND_GROUND | AI_REACHED_HOLD_COMBAT | AI_THIRD_EYE`, and :420-424 keeps `movetarget` for a hold point. Port `hold` sets only `pauseTime` and `standGround`, and `finish` clears `moveTarget` unconditionally. `AI_THIRD_EYE` (360-degree sight until FoundTarget, g_ai.cpp:47, :517) has no counterpart.
  - g_ai.cpp:96-106 sends a holding monster back to `movetarget` if it no longer overlaps the point. ai.ts:288 has no such test.
- Impact: A monster running to a combat point ignores a player standing next to it. A monster on a hold point has normal forward sight and, if knocked away, does not return.
- Remediation: Port the 100-unit test, the checkattack call, the hold flags, and the return to the point.

### SRC5-005 — Rerelease pursuit uses classic's distance test at 40 Hz, and classic's trail rules
- **Verification (VERIFY-W): confirmed. Final severity: Medium.** `perception.ts:459-460` uses a 3D `d1 <= distance`, and `index.ts:608` scales distance by frameSeconds*10; g_ai.cpp:1731 uses a box test. `:449` uses simple trail selection against p_trail.cpp:113-150, `:151-165` has only a health gate against p_trail.cpp:91-92, and `:477` keeps the yaw that g_ai.cpp:1795 restores.
- Severity: Medium
- Category: bug
- Location: content/q2/foundation/monsters/perception.ts:158-163, :440-481; content/q2/foundation/monsters/index.ts:608
- Original: RR2 g_ai.cpp:1696-1738, :1752, :1795; p_trail.cpp `PlayerTrail_Add`, `PlayerTrail_Pick`
- Confidence: traced. Not run through a level.
- Evidence:
  - The port advances with `if (d1 <= distance) state.pursueNext = true;`, a 3D length. `distance` is `frame.distance * state.scale * game.host.frameSeconds() * 10`, a quarter of the frame value at the rerelease's 0.025 s tick. The source uses `boxes_intersect(last_sighting, last_sighting, origin + mins, origin + maxs)` at g_ai.cpp:1731. A monster whose origin height differs from the player's by more than `distance` can never satisfy the port's test, while the point is inside its box in the source.
  - `PlayerTrail_Pick(self, false)` picks the first marker newer than `trail_time` that is visible, and `next` picks the marker after the closest one. The port takes `trail.find(point => point.time > state.trailTime)`, with classic's one-step fallback.
  - `PlayerTrail_Add` skips when the player is airborne, noclipping or in intermission. Port :151-165 has only the health test.
  - g_ai.cpp:1752 and :1795 restore `angles.yaw` after probing. Port :477 leaves the monster snapped to the ideal yaw.
- Impact: A rerelease monster that loses sight can stop advancing along the trail and hover at the last marker, most likely for monsters whose origin sits at a different height from the player's. SRC4Q2-005 covers the classic drifts, not these.
- Remediation: Use the box test and rerelease trail selection under the rerelease edition.

### SRC5-006 — Rerelease ai_stand treats a heard noise as an enemy, so monsters flicker between stand and run at the noise
- **Verification (VERIFY-W): confirmed. Final severity: Medium.** `ai.ts:289-292` has no `player_noise` exclusion (g_ai.cpp:109) and tests exact `!==`. I tried to limit the flicker to the turn time, but `vw/yaw.ts` shows changeYaw never lands exactly on the ideal yaw in 13088 of 20000 cases within 400 ticks, so the "up to 5 seconds" stands. The HuntTarget branch (g_ai.cpp:166-170) is also absent.
- Severity: Medium
- Category: bug
- Location: content/q2/foundation/monsters/ai.ts:288-306, :335-339
- Original: RR2 g_ai.cpp:109-117, :145-149, :166-170, :1518-1534
- Confidence: traced
- Evidence: At the noise, ai.ts:338 sets `standGround` and `temporaryStandGround` and calls `context.stand()`. The next stand frame takes `if (entity.enemy !== null)`, computes the yaw to the noise, and `if (game.body(entity).angles.y !== state.idealYaw && state.temporaryStandGround) { ...; context.run(); }`. The next run frame stands again. The source excludes it first: `if (self->enemy && !(self->enemy->classname && !strcmp(self->enemy->classname, "player_noise")))`, so a monster at a noise runs `FindTarget` and stays put. The source also tests `!FacingIdeal(self)` (±45 degrees) rather than exact inequality. It also has `if (self->enemy && !(AI_SOUND_TARGET)) { HuntTarget(self); return; }` for a non-holding stand, which the port lacks, so a monster in stand frames with a real enemy can walk off on `pauseTime`. Arrival is also different: `length(delta) < 32` where the source uses `SV_CloseEnough` and `FacingIdeal`, and `close_sight_tripped` is not reset (:1532).
- Impact: For up to 5 seconds after a noise, a monster that has reached it alternates stand and run animation states rather than standing watch.
- Remediation: Add the `player_noise` exclusion, `FacingIdeal`, and the HuntTarget branch under the rerelease edition.

### SRC5-007 — Rogue CTF players are reassigned to random teams on every map, and first spawn ignores team bases
- **Verification (VERIFY-W): confirmed. Final severity: Medium.** `rogue-teams.ts:38` starts `steam` at -1, `travel.ts:28` returns new parms with no team, and `runtime.ts:4443` selects a spawn before `:4447` spawned. ROG client.qc:60, :102, :166-169 and :1666-1672 carry the team and assign it in ClientConnect. `src2q1/ents-rogue.json` shows flags in all 15 maps.
- Severity: Medium
- Category: bug
- Location: content/q1/missionpacks/world/rogue-teams.ts:36-39, :50-53, :74; content/q1/missionpacks/travel.ts:26-30; app/bootstrap/simulation/runtime.ts:4443-4447
- Original: ROG client.qc:60, :102, :133, :166-169, :1666-1673, :606-617; ROG teamplay.qc:418-431
- Confidence: traced
- Evidence: The source carries the team through a level change: `parm14 = self.steam; // save team setting`, then `if (TeamColorIsLegal(parm14)) { self.steam = parm14; TeamSetSkin(); }`. The port keeps `steam` on a `rogue_team_state` entity that dies with the map, `Q1TravelState` has no team field, and `state()` recreates it with `this.ctf && (gamecfg & 8) === 0 ? -1 : color`. `playerSpawned` then skips the legal-color path for -1 and assigns the smaller team, with `host.random() < 0.5` on ties.
  Order also differs. The source assigns in ClientConnect before PutClientInServer, so `self.steam` selects `info_player_team1` or `team2` at first spawn. The port calls `selectSpawn` before `spawned` (runtime.ts:4443, :4447), so `team(actor)` is -1 and `selectSpawn` picks `info_player_deathmatch`.
- Impact: With `teamplay` 4 to 6 and default `gamecfg`, a server's teams are scrambled at each map change, and players begin each map at deathmatch spots rather than their base. All 15 Rogue maps carry flag entities.
- Remediation: Save `steam` through travel, as `parm14` does, and run team assignment before spawn selection.

### SRC5-008 — Small rerelease FindTarget and ai_charge drifts
- **Verification (VERIFY-W): confirmed-with-changes. Final severity: Low.** Correction: the port does test visibility at `perception.ts:226`, since `visualCandidate` (`:203`) mirrors G_MonsterSourceVisible. Only the `client->enemy == self->enemy` drop (g_ai.cpp:707) is missing. The sound, noise re-acquire, `tesla_mine` (`ai.ts:277`) and `ai_run` yaw items stand.
- Severity: Low
- Category: bug
- Location: content/q2/foundation/monsters/perception.ts:172-186, :226, :240-250; content/q2/foundation/monsters/ai.ts:277, :360
- Original: RR2 g_ai.cpp:579-612, :707-709, :746-763, :292-293, :1639-1640
- Confidence: traced
- Evidence:
  - Sound: `AI_GetSoundClient` picks the nearest fresh sound across living players. The port keeps one global `primary` and `secondary`, as classic does, so in coop a monster hears the most recent noise rather than the nearest, and noises from dead players count.
  - Alerted monsters: the source drops the candidate when `client->enemy == self->enemy` and requires `visible(self, sight_entity)`. The port tests neither at :226, so a monster that already has that enemy re-runs `foundTarget`, adding 0.2 to 0.4 s to `attackFinished` each time.
  - Noise re-acquire: the source returns true without FoundTarget if the monster is facing and within 8 units. Port :240 always continues.
  - `ai_charge` side offset is 0 for `tesla_mine` in the rerelease. Port :277 tests only classic `tesla`.
  - The extra `M_ChangeYaw` within `RANGE_MELEE * 2.5` in `ai_run` (:1639) is missing; the port has it only in charge.
- Impact: Minor coop targeting differences and slightly delayed attacks.
- Remediation: Fix each under the rerelease branch.

### SRC5-009 — Q1 backpacks and Rogue tossed weapons lack FL_ITEM, so their pickup box is 14 units narrower on each side
- **Verification (VERIFY-W): confirmed. Final severity: Medium.** `base/projectiles.ts:81-91` and `missionpacks/backpacks.ts:82` never set bit 256, while `gremlin-weapons.ts:113` and the rune and flag paths do. `physics.ts:274` pads 15 only with that bit, and WinQuake world.c:421-427 is the source rule. It also affects monster-dropped packs in single player.
- Severity: Medium
- Category: bug
- Location: content/q1/base/projectiles.ts:81; content/q1/missionpacks/backpacks.ts:82; app/bootstrap/simulation/physics.ts:274; app/bootstrap/simulation/actor-execution.ts:69
- Original: quakec/items.qc:1474; ROG items.qc:1744; HIP items.qc:1476; qw-qc/items.qc:1675; ROG teamplay.qc:734, :829; WinQuake/world.c:421-426
- Confidence: traced
- Evidence: The source sets `item.flags = FL_ITEM;`, and SV_LinkEdict widens `absmin` and `absmax` by 15 in X and Y for it. The port implements this: `const pad = solid?.family === "q1" && solid.item ? { x: 15, y: 15, z: 0 } : { x: 1, y: 1, z: 1 };`, with `item: (entity.movementFlags & 256) !== 0`. Map items, flags, CTF drops and runes set bit 256 (`pickups.ts:350`, `ctf/drops.ts:25`, `ctf/runes.ts:25`). `dropBackpack` and `tossRogueWeapon` do not:
  ```
  const pack = game.create("item_backpack"); pack.model = "progs/backpack.mdl"; pack.solid = "trigger"; pack.movement = ...
  ```
- Impact: In every Q1 deathmatch and coop game using TS rules, a player must get 14 units closer on each horizontal side (15 unit item padding in the source, 1 here) to collect a backpack. Near misses that collect in the original do not collect here.
- Remediation: Set `movementFlags |= 256` in `dropBackpack` and `tossRogueWeapon`.

### SRC5-010 — Rogue team bonus scoring counts a carried flag, because the radius scan ignores SOLID_NOT
- **Verification (VERIFY-W): confirmed. Final severity: Low.** `rogue-teams.ts:177-183` has no solid test, and `:162` runs assists before `:164` drops the flag. In the source, combat.qc:122 runs the obituary and TeamAssists before th_die, so the flag is still SOLID_NOT (teamplay.qc:1045) and findradius skips it. The attacker-scan +1 needs the attacker within 400 units of the carrier.
- Severity: Low
- Category: bug
- Location: content/q1/missionpacks/world/rogue-teams.ts:177-183
- Original: ROG teamplay.qc:281, :311; WinQuake/pr_cmds.c:898
- Confidence: traced
- Evidence: `findradius` skips SOLID_NOT: `if (ent->v.solid == SOLID_NOT) continue;`. A carried flag is SOLID_NOT (teamplay.qc TeamFlagTouch sets `self.solid = SOLID_NOT`), and so are dead players. The port scans `game.host.actors.observations()` and never tests solidity, though `monsters/helpers.ts:radiusActors` does (`entity?.solid === "none"`).
- Impact: Killing an enemy carrying your flag awards a flag defence bonus for the flag on their back: +1 from the attacker scan and +1 from the target scan, because the precedence bug leaves those branches unguarded. The source awards none.
- Remediation: Skip `solid === "none"` entities in `assists`.

### SRC5-011 — Rogue teamplay feedback is thin: announcements, assist prints, skin and respawn timers
- **Verification (VERIFY-W): confirmed. Final severity: Low.** `rogue-teams.ts:140`, `:149`, `:155` and `:176-182` lack the prints in teamplay.qc:292-332, :1103-1108 and :1189-1191. teamplay.qc:1236-1262 prints no capture center text in one-flag mode, while the port always does. No player skin counterpart exists, and `playerSpawned` does not reset the timers (ROG client.qc:866-869).
- Severity: Low
- Category: bug
- Location: content/q1/missionpacks/world/rogue-teams.ts:53, :64, :139-140, :149, :155, :174-182
- Original: ROG teamplay.qc:292, :302, :321, :332, :378-385, :523, :1106-1108, :1189-1191; ROG client.qc:866-869
- Confidence: traced
- Evidence:
  - Missing `bprint`: "returned the flag", both capture assist lines, `$qc_defend_flag_carrier`, `$qc_defend_team_flag`, `$qc_defends_flag`, `$qc_defend_flag_carrier_aggressive`, `$qc_death_color_sense`.
  - Center prints: the source gives teammates "Your team has the X flag!", team 3 its own pickup text, and prints nothing in one-flag capture. The port sends `${team} team has the ${flag} flag!` to all non-owners and always prints `$qc_your_team_captured` and `$qc_your_flag_captured`.
  - `TeamSetSkin` sets `self.skin = 1` in CTF deathmatch; there is no counterpart. Whether the retail Rogue `player.mdl` shows a difference was not checked.
  - PutClientInServer resets the four CTF timers to -10. The port keeps them across respawn, so a player who fragged a carrier and then died can still earn the 2-point assist. This is the Rogue twin of SRC4Q1B-010.
- Impact: Scoring events are silent, and one small assist scoring difference.
- Remediation: Add the prints and reset the timers in `playerSpawned`.

### SRC5-012 — Small Hipnotic charm and dodge drifts
- **Verification (VERIFY-W): confirmed-with-changes. Final severity: Low.** Correction: the cited `runtime.ts:363-378` does not exist; `missionpacks/monsters/runtime.ts` has 196 lines and the branch is `:73-92`. The charm gap stands (`base/monsters.ts` clearShot against HIP fight.qc:91). The hostile gap is wider than dodging: `base/monsters.ts` `run` never writes `show_hostile` either, so `super.run` lacks HIP ai.qc:1131 too.
- Severity: Low
- Category: bug
- Location: content/q1/missionpacks/monsters/runtime.ts:363-378; content/q1/base/monsters.ts (generic `tryAttack`)
- Original: HIP fight.qc:91; HIP ai.qc:1131
- Confidence: traced
- Evidence:
  - HIP CheckAttack has `if ((trace_ent != targ) && (!self.charmed)) return FALSE;`. A repo grep finds `charmed` only in the mission pack charm files and `armagon.ts:121`, so generic monsters charmed by the Horn stop firing when another entity is in the line of fire. Armagon alone has the exception.
  - The `ai_run` line `self.show_hostile = time + 1;` runs before the dodge branch in the source. The port's dodging branch at :363 bypasses `super.run`, so a dodging Scourge does not wake other monsters.
- Impact: Horn-summoned allies hold fire more often than in the source. Scourge alerts travel less.
- Remediation: Add the charmed test to the shared check and set `show_hostile` in the dodge branch.

### SRC5-013 — Source quirks changed on entities no shipped map uses
- **Verification (VERIFY-W): confirmed. Final severity: Info.** ROG misc.qc:355-360, newmisc.qc `rubble_use` and combat.qc:163-168, :343 read as cited; `shooters.ts` and `rogue-misc.ts:27`, `:31` differ. A scan of `ents-rogue.json` finds no `trap_shooter`, `rubble_generator` or `trigger_explosion` in any Rogue map.
- Severity: Info
- Category: bug
- Location: content/q1/missionpacks/world/shooters.ts:36; content/q1/missionpacks/world/rogue-misc.ts:27, :31
- Original: ROG misc.qc:355-360; ROG newmisc.qc `rubble_use`; ROG combat.qc:163-168, :343
- Confidence: traced. Map counts come from `src2q1/ents-rogue.json`.
- Evidence:
  - Rogue `shooter_think` ends with `newmis.velocity = self.movedir * 500;`, so continuous lasers and fireballs fly at 500. The port keeps 600 for lasers. 0 Rogue `trap_shooter` entities ship.
  - `rubble_use` "off" sets `self.nextthink = time - 1`, which SV_RunThink still runs, so the generator never actually stops and one rock fires at once. The port cancels the think. 0 entities ship.
  - `IsExplosionDamage` is cleared by the first T_Damage after T_RadiusDamage sets it, so a `trigger_explosion` is hurt only if it is the first target in the chain, and a later direct hit can use a stale flag. The port tests `delivery === "radius"`. 0 entities ship.
- Impact: Only custom Rogue maps can observe these.
- Remediation: Preserve them or record them as deliberate.

### SRC5-014 — Rerelease alternate-fly monsters skip movement on zero-distance frames
- **Verification (VERIFY-W): confirmed. Final severity: Low.** `ai.ts:255`, `:273`, `:286` and `:354` test `distance !== 0`; g_ai.cpp:90, :280, :330 and :1589 also admit AI_ALTERNATE_FLY. `alternateFlyStep` is called only at `ai.ts:150`, and `alternateFly` is set by the floater, flyer, flipper and hover variants. The visible effect remains plausible, not observed.
- Severity: Low
- Category: bug
- Location: content/q2/foundation/monsters/ai.ts:150, :255, :273, :286, :354
- Original: RR2 g_ai.cpp:90, :280, :330, :1589
- Confidence: traced for the gating. The visible effect is plausible; `alternate-fly.ts` was not read in full.
- Evidence: The source tests `if (dist || (self->monsterinfo.aiflags & AI_ALTERNATE_FLY)) M_walkmove(...)` in four AI functions. The port tests `distance !== 0` in all four, and `alternateFlyStep` is reachable only through `walkMove`.
- Impact: Floater, hover, flyer and flipper variants, which set `alternateFly`, do not run their flight step during stand, turn and charge frames with distance 0.
- Remediation: Extend the four guards with `state.alternateFly`.
