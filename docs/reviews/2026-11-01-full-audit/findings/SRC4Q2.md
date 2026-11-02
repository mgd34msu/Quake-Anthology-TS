# SRC4Q2 — Quake 2 ports against id source, closing SRC3Q2's open gaps: g_ai.c, m_move.c, g_monster.c, frame callbacks, rerelease weapon management, client serverdata and downloads

HEAD fcdc8af5. Original paths are relative to `<scratchpad>/upstream/`. Nothing was executed from upstream; its text was read as data. Port paths are relative to the project root. Scripts are in `<scratchpad>/src4q2/` and ran from `<scratchpad>/clean`. The project directory was not changed. All reads were full lines with no column cuts, except the two filtered views listed below.

## Coverage
**Read in full and compared:**
- foundation/monsters/perception.ts (483, all) against game/g_ai.c (1117, all), plus p_trail.c 95-141. Compared for classic and base rules. `reactToDamage` against game/g_combat.c M_ReactToDamage; it matches apart from `oldEnemy` being set before the final else-return (:333), which is inert because that value is the current enemy.
- foundation/monsters/ai.ts (450, all) against game/m_move.c (556, all) and g_ai.c `ai_*`. Classic branches.
- foundation/monsters/index.ts 360-882 against game/g_monster.c 107-740. Rerelease `dodge`, `checkDodge` and `blocked` against rerelease/g_monster.cpp 801-856 and rogue/g_rogue_newai.cpp 12-256, 1304-1410.
- Frame tables, by script (src4q2/thinks.ts): every `mframe_t` and `mmove_t` in game/m_*.c against base/monsters/tables/* and the `classic_*` moves in foundation/monsters/moves.ts. 286 moves and 4670 frames compared for AI function, distance, thinkfunc, endfunc and frame range. Result: 0 mismatches. Only soldier_move_stand4, soldier_move_attack5 and brain_move_walk2 are absent from the port; all three sit inside `#if 0` in m_soldier.c and m_brain.c.
- rerelease/p_weapon.cpp 1-382, 431-655 against foundation/weapons/player.ts (768, all), presentation.ts, damage.ts, turn.ts, projection.ts, definitions.ts, base/player/commands.ts `use` and `drop`, foundation/items.ts weapon pickup, rerelease/players.ts `weaponPicked`.
- rerelease/g_weapon.cpp 1020-1217 against ballistics.ts 391-402, 495-523.
- foundation/weapons/hand-action.ts (110, all) against p_weapon.c Weapon_Grenade 595-703 and p_weapon.cpp Throw_Generic 1013-1170. Throw_Generic was read as a filtered listing of frame, timer and fire lines, not line by line.
- client/cl_parse.c 1-192, 298-371 against network/q2/server-messages.ts 173-182, 276-312, app/bootstrap/network/q2-downloads.ts (370, all), q2-client-receiver.ts 91-175, q2.ts 630-700. client/cl_main.c CL_RequestNextDownload was read to its model and skin loop only.

**Not compared (no claim either way):**
- Rerelease and Rogue branches of perception.ts and ai.ts against rerelease/g_ai.cpp and m_move.cpp, except FoundTarget (g_ai.cpp 484-548). rogue/g_ai.c and rogue/m_move.c. These branches are a large share of both files and remain open.
- Thinkfunc assignments in rerelease m_*.cpp and mission pack monsters. The script covers classic base only.
- The species `*_blocked` callers of blocked_checkplat and blocked_checkjump other than infantry.
- moves.ts rows and muzzle.ts beyond the script's classic scope.
- `Pickup_Weapon` rerelease respawn timing (SetRespawn's hide argument). `G_CheckInfiniteAmmo` versus the `IF_NO_INFINITE_AMMO` items.
- ballistics.ts 1-87 helpers were read but have no counterpart range. p_weapon.cpp `weapon_*` bodies were covered by SRC3Q2.

**Differences seen and judged inert, so not reported:**
- g_ai.c:863's per-frame `show_hostile` refresh is absent in classic. Other monsters read it only inside the one-frame sight window, when FoundTarget has just set it.
- `anglemod` quantization, and `abs()` integer truncation in SV_NewChaseDir.
- The one-frame direct move at search timeout (g_ai.c:977-983).
- Trail markers one frame older than `s.old_origin`.
- perception.ts:249 clearing temporary stand-ground on a heard noise (not in g_ai.c:566-571), reachable only with a null enemy.

**Catalog overlap:** the wrapped delta and the axis swap probability in ai.ts are CONTENT2-011 and CONTENT2-012, and were not re-reported. CONTENT2-003 and CONTENT2-004 cover `dodge` and the pain gate.

## Strengths
- All 4670 classic frame rows match m_*.c, including every thinkfunc and endfunc.
- M_MoveFrame's order and captured move, M_CheckGround, M_CatagorizePosition, M_WorldEffects, M_droptofloor and monster_start_go match g_monster.c.
- SV_movestep matches, including the swim and fly water rules, the `+= dz` quirk, the 215 diagonal, the partial-ground branches and the startsolid retry. M_CheckBottom matches.
- M_CheckAttack matches: mask, chances, skill scaling and RNG order. FacingIdeal, ai_stand, ai_walk, ai_turn and ai_run_slide match. The noise branch of FindTarget, including area and PHS tests, matches.
- Course correction geometry matches g_ai.c:1052-1106 apart from its mask (SRC4Q2-005).
- P_ProjectSource matches in both editions, including the close-monster raw-forward rule. PlayerNoise silencer and invisibility timing, G_CheckAutoSwitch's smart rules, Weapon_AttemptSwitch ordering, and the BFG spawn and think targeting match.
- hand-action.ts reproduces the grenade frame timing: cock at frame 5, the hold at 11, the throw one frame after release, and a 3.2 s fuse.
- All ten definitions.ts generic weapon frame numbers match the Weapon_Generic calls at p_weapon.c:748-1430.
- Weapon pickup stay rules match G_WeaponShouldStay.
- Download client path safety is stricter than the original's, and the `..` refusal holds. SRC4Q2-001 is the cost of the same check being over-tight.

## Findings

### SRC4Q2-001 — The Q2 client ends when a server's model list contains any sprite, which includes every retail map that spawns a BFG
- **Verification (VERIFY-U): confirmed. Final severity: High.** Re-run: `sprites/s_bfg1.sp2 installed: true => THROW`; an md2 returns ready. q2-downloads.ts:314 validates before the installed and permission tests, and the :243-248 regex has no sprites/ prefix. g_items.c:1539 and :1040-1043 put these names in the model list; cl_parse.c:74-82 tolerates them. q2.ts:698 and remote-application.ts:2322 have no guard. Exit itself rests on APP-001 and was not run live.
- Severity: High
- Category: bug
- Location: src/app/bootstrap/network/q2-downloads.ts:243-248, :261-263, :314; src/app/bootstrap/network/q2.ts:698; src/app/bootstrap/remote-application.ts:2322
- Confidence: reproduced at component level (src4q2/repro-dl.ts, retail baseq2 pak mounted); the path from the throw to process exit is traced through APP-001; not run against a live server
- Evidence:
  - The port requires `/^(?:maps\/.*\.bsp|(?:models|players)\/.*\.(?:md2|sp2|pcx|wav)|sound\/.*\.wav|pics\/.*\.pcx|env\/.*\.(?:tga|pcx)|textures\/.*\.wal)$/i` plus `/^[a-zA-Z0-9_+./-]+$/`, and throws `Q2 server requested a non-asset download`. There is no `sprites/` alternative.
  - `prepare` runs `this.validate(path)` at :314, before the `installed` test at :317 and before the permission test at :321, so installed files and `allow_download 0` do not help.
  - Repro output: `sprites/s_bfg1.sp2 installed: true => THROW Q2 server requested a non-asset download`. The same model list with an md2 returns `ready`.
  - Original: client/cl_parse.c:74-78 refuses only `..`, prints, and `return true` so loading continues. cl_parse.c:80 treats an existing file as done. client/cl_main.c CL_RequestNextDownload skips model checks when downloads are off.
  - Source of the names: game/g_items.c:1539 lists `sprites/s_bfg1.sp2 sprites/s_bfg2.sp2 sprites/s_bfg3.sp2` as weapon_bfg precaches, and g_items.c:1040-1043 PrecacheItem passes `.sp2` to `gi.modelindex`.
  - The entity text of retail q2dm2, q2dm4, q2dm6, q2dm8 and many single-player maps contains `weapon_bfg` (src4q2/maps.ts). Some single-player occurrences may be flagged out of that mode.
  - q2.ts:698 awaits `prepareGameState` with no guard, and the rejection reaches RemoteApplication's step loop (APP-001).
  - The tests in tests/first-playable/network/q2-downloads.test.ts and tests/network/common/download-controls.test.ts use model lists with no sprite.
- Impact: Connecting to a stock classic server on q2dm2 ends the client process during load. Maps without a BFG connect, which hides the defect. The same check rejects other legal names. Traced, not run: a connected player whose skin contains a space makes `players/male/my skin.pcx` fail for each new client that loads that configstring.
- Remediation: Add `sprites/` to the allowed prefixes. On a validation failure, print and skip that resource as the original does, and test `installed` first.

### SRC4Q2-002 — A classic medic never clears AI_MEDIC, so after one revive it stops fighting for good
- **Verification (VERIFY-U): confirmed. Final severity: Medium.** Re-run: revived medic `frames with enemy=player 50 moves medic_move_run,medic_move_stand`, control `100`, flag stays true. perception.ts:355-356 clears it only for rogue and g_ai.c:811-817 always does; medic.ts has no clear. The behavior is real, but it affects one species and makes the game easier without blocking play, so it is below High.
- Severity: High
- Category: bug
- Location: src/content/q2/foundation/monsters/perception.ts:355-356; src/content/q2/base/monsters/medic.ts:32, :37, :47
- Confidence: reproduced (src4q2/repro-medic.ts)
- Evidence:
  - Original g_ai.c:811-817: `else if (self->monsterinfo.aiflags & AI_MEDIC) { if (self->enemy->health > 0) { hesDeadJim = true; self->monsterinfo.aiflags &= ~AI_MEDIC; } }`.
  - Port: `state.medic ? enemyHealth > 0 : ...` then `if (this.sourceCombatRules === "rogue") state.medic = false;`. A repo grep finds no other clear for the base medic. The rerelease and mission pack medics have their own clears.
  - Repro, with the patient revived at tick 97: `2s after revive flag true enemy null move medic_move_stand`. Then, over 10 s with the player 200 units in front: `flag true frames with enemy=player 50 moves medic_move_run,medic_move_stand`. A control medic in the same scene: `flag false frames with enemy=player 100`.
  - The living enemy counts as dead each frame at :355, so the check at :413 and medic_attack are never reached. The flag also blocks medic_run's corpse search (medic.ts:37), as m_medic.c:261 gates it.
- Impact: In classic base, a medic that has revived anything alternates between acquiring and dropping the player, and never shoots again. Each revive permanently removes that medic as a threat. Xatrix was not traced; it would be affected if it loads this definition.
- Remediation: Clear `state.medic` whenever the medic branch finds a living enemy, for all rule sets.

### SRC4Q2-003 — In classic, FoundTarget marks the player as show_hostile, so monsters that are facing away and ambush monsters wake at near range
- **Verification (VERIFY-U): confirmed. Final severity: Medium.** Re-run: `with A hunting: B enemy player after ticks 1`, control `C enemy null`. perception.ts:288 is ungated and :207 reads it for players; g_ai.c:357, :509, :797 and :863 are the only show_hostile uses and all writes are on monsters. RR/g_ai.cpp:497 is the source of the rerelease behavior.
- Severity: Medium
- Category: bug
- Location: src/content/q2/foundation/monsters/perception.ts:288, :207
- Confidence: reproduced (src4q2/repro-hostile.ts)
- Evidence:
  - Port: `this.sight = record; this.alerted.set(entity.enemy, record); this.hostile.set(entity.enemy, game.host.now() + 1);`, not gated by edition. Line 207 reads `this.contexts.get(actor)?.state.showHostile ?? this.hostile.get(actor) ?? -1`, which for a player is that map.
  - Original g_ai.c:357 sets `self->show_hostile` only on the monster. g_ai.c:509 tests `client->show_hostile`, and grep shows lines 357, 509, 797 and 863 are the only uses, so a client's value stays 0 and RANGE_NEAR always needs `infront`. `self->enemy->show_hostile` is a rerelease change (rerelease/g_ai.cpp:497).
  - Repro: tank A sees the player; ambush tank B has the player 300 units behind it. `with A hunting: B enemy player after ticks 1`. Control with no other monster hostile: `C enemy null`.
- Impact: For one second after any monster notices the player, each monster with line of sight inside 500 units notices too, whichever way it faces. Spawnflag 1 monsters are included, though they are meant to ignore other monsters' anger. Authored ambushes trigger early, and rooms wake together.
- Remediation: Set the player's entry only in the rerelease edition.

### SRC4Q2-004 — Disguise violation is not implemented, so a disguised player can fire without exposing itself
- **Verification (VERIFY-U): confirmed. Final severity: Medium.** `violator` has no hit under src/content/q2. Rerelease: entity-services.ts:247 makes disguise count as notarget, so ballistics.ts:132 returns on weapon noise, against RR/p_weapon.cpp:178-187 and RR/g_ai.cpp:715-717. Classic Rogue: original/rogue/p_weapon.c:108 and g_ai.c:520 have no port counterpart, and reportNoise (perception.ts:169-171) tests only FL_NOTARGET.
- Severity: Medium
- Category: bug
- Location: src/content/q2/foundation/weapons/ballistics.ts:124-133; src/content/q2/foundation/entity-services.ts:247; src/content/q2/foundation/monsters/perception.ts:169-171, :228-237; src/content/q2/missionpacks/entities/rogue.ts:38-43
- Confidence: traced; `violator` has no hit under src/content/q2. Not observed in play
- Evidence:
  - Original rerelease/p_weapon.cpp:178-187: `if (who->flags & FL_DISGUISED) { if (type == PNOISE_WEAPON) { level.disguise_violator = who; level.disguise_violation_time = level.time + 500_ms; } else return; }`. rerelease/g_ai.cpp:715-717 makes that player the first target. Same in original/rogue/p_weapon.c:108-109 and rogue/g_ai.c:518-520.
  - Port rerelease: `notarget` includes 0x8000 (entity-services.ts:247), so `playerNoiseForActor` returns at :132 for a weapon shot, with no noise and no violation.
  - Port classic Rogue: weapon noise proceeds, but no target override exists. Self noises go through `reportNoise` directly, which tests only `FL_NOTARGET`, so a disguised player's jump or pain noise still alerts monsters where the original returns.
- Impact: rammo1 and rammo2 use trigger_disguise (src4q2/dis.ts). The player can shoot from inside the disguise and only direct damage reactions wake monsters, which inverts the rule the mechanic exists for.
- Remediation: Port the violator record and the FindTarget override, and make self noise return while disguised.

### SRC4Q2-005 — ai_run pursuit drifts: an exhausted trail stops instead of wrapping, and three smaller changes
- **Verification (VERIFY-U): confirmed. Final severity: Low.** (a) perception.ts:452 find returns undefined where p_trail.c:103-109 and :132-138 wrap to the oldest marker. (b) :460 lacks g_ai.c:1040-1044's dist = d1. (c) :462-469 use monsterSolidMask against MASK_PLAYERSOLID at g_ai.c:1052-1069. (d) PickFirst's visible uses viewheight (g_ai.c:293-297) and the port does not. (e) Per-player trails at :160-162.
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/monsters/perception.ts:449-456, :452-453, :460, :462-469
- Confidence: traced; effect not measured
- Evidence:
  - (a) p_trail.c:103-109 and :132-138 loop TRAIL_LENGTH times with `marker = NEXT(marker)`, so when every marker is old the index wraps to `trail_head` and the oldest marker is returned. g_ai.c:1026-1035 then adopts it, moving `trail_time` back. Port: `trail.find(point => point.time > state.trailTime)` gives undefined and nothing changes, so PURSUE_NEXT re-fires each frame at the last point.
  - (b) g_ai.c:1040-1044 sets `dist = d1` when within range. Port line 460 sets only `pursueNext`, and moveToGoal keeps the full step, which can overshoot.
  - (c) g_ai.c:1052, :1064, :1069 use MASK_PLAYERSOLID for course correction. Port uses `monsterSolidMask` (monsterclip, not playerclip).
  - (d) PlayerTrail_PickFirst's `visible` starts at `origin + viewheight` (g_ai.c:293-297). Port traces from `body.origin`.
  - (e) p_trail.c holds one global trail. The port keeps one per enemy player, so a monster chasing another monster has no markers, and coop trails do not mix.
- Impact: A monster that reaches the newest marker with no sight of the player idles there instead of doubling back along the trail, until the player moves or is seen.
- Remediation: Return the oldest marker when none is newer, and restore `dist = d1` and the mask.

### SRC4Q2-006 — SV_CloseEnough is skipped for combat points and sound targets, and lacks the link epsilon
- **Verification (VERIFY-U): confirmed. Final severity: Low.** perception.ts:424 adds hintPath, combatPoint and soundTarget conditions; m_move.c:525 has none. closeEnough (:432-438) uses origin + bounds with no link epsilon, whereas absmin and absmax are widened by 1 in sv_world.c.
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/monsters/perception.ts:424, :432-438
- Confidence: traced
- Evidence: m_move.c:525 `if (ent->enemy && SV_CloseEnough (ent, ent->enemy, dist)) return;` has no flag conditions. Port: `if (!state.hintPath && enemy !== null && !state.combatPoint && state.soundTarget === null && this.closeEnough(...))`. SV_CloseEnough compares absmin and absmax, which server/sv_world.c:248-253 widens by 1 on each side. The port uses `origin + bounds`, so it triggers 2 units later on each axis.
- Impact: A monster running to a combat point past its enemy keeps stepping and chasing around the enemy, where the original stops while touching. Melee-range monsters take one extra blocked step, which enters SV_NewChaseDir and consumes extra RNG.
- Remediation: Drop the extra conditions for classic, and add the epsilon.

### SRC4Q2-007 — Classic FoundTarget keeps a rerelease early return and loses the failed-combattarget state
- **Verification (VERIFY-U): confirmed. Final severity: Low.** perception.ts:304 is ungated, g_ai.c:362-366 has no such test, and RR/g_ai.cpp:519-522 marks it as a Paril change. For a missing combattarget, g_ai.c:371 sets movetarget = enemy; port :307 goes to huntTarget without it.
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/monsters/perception.ts:304, :307
- Confidence: traced
- Evidence: `if (state.combatPoint) return undefined;` is not edition-gated. g_ai.c:362-366 has no such test, so a monster on a combat point shot by a second attacker calls HuntTarget, with its goal switching to the attacker. The return is the rerelease "Paril" change (rerelease/g_ai.cpp:519-522). For a missing combattarget, g_ai.c:371 sets `goalentity = movetarget = enemy` before HuntTarget. Port leaves `moveTarget` unset.
- Impact: Reach is limited to coop and monster attackers, because the same attacker returns earlier at :318. Such monsters keep running to the point instead of turning on the new attacker. After a missing combattarget, a monster stands when its enemy dies rather than walking to the old enemy's position.
- Remediation: Gate line 304 on rerelease, and set `moveTarget` in the classic failure path.

### SRC4Q2-008 — Monster start omits the zero-length M_walkmove
- **Verification (VERIFY-U): confirmed. Final severity: Low.** monsters/index.ts:466 and dropToFloor (:539-547) never step or touch triggers, and that file has no walkMove or touchTriggers. g_monster.c:677-679 and :701 call M_walkmove(self, 0, 0), which reaches G_TouchTriggers (m_move.c:287-291).
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/monsters/index.ts:466-467
- Confidence: traced
- Evidence: g_monster.c:677-679 `if (self->groundentity) if (!M_walkmove (self, 0, 0)) gi.dprintf(...)`, and :701 for flyers. M_walkmove runs SV_movestep with relink, so it applies the step-down placement and G_TouchTriggers (m_move.c:287-291). Port start calls only `dropToFloor`, and there is no `touchTriggers` or `walkMove` in `start`.
- Impact: A standing monster placed in a trigger_multiple with the monster flag, or in another touch volume, does not touch it until it first moves. There is also no "in solid" diagnostic for mis-placed monsters.
- Remediation: Call `walkMove(context, 0, 0)` at both points and print the diagnostic on failure.

### SRC4Q2-009 — `use` prints an item id and the wrong sentence for missing ammo; g_select_empty is not implemented
- **Verification (VERIFY-U): confirmed. Final severity: Low.** commands.ts:40 prints weapon.ammo, an id such as q2:ammo_shells, with one sentence for both results; p_weapon.c:327 and :333 use two sentences with pickup names. Nothing under src reads select_empty or passes allowEmpty true to player.ts:139.
- Severity: Low
- Category: bug
- Location: src/content/q2/base/player/commands.ts:39-40; src/content/q2/foundation/weapons/player.ts:139, :145
- Confidence: traced by reading; grep finds no `select_empty` under src and no caller passing `allowEmpty`
- Evidence: Port: ``print(context, `Not enough ${weapon.ammo ?? "ammo"} for ${item.name}.\n`)`` where `weapon.ammo` is `q2:ammo_shells`. Original p_weapon.c:327 `"No %s for %s.\n"` when empty, :333 `"Not enough %s for %s.\n"` when short, both with `pickup_name`. p_weapon.c:320 and p_weapon.cpp:552 honor `g_select_empty`.
- Impact: The player sees `Not enough q2:ammo_shells for Shotgun.`, and the setting that allows selecting an empty weapon has no effect.
- Remediation: Map the ammo id to its display name, use the two sentences, and read the cvar.

### SRC4Q2-010 — Rerelease low-ammo warning is a world sound
- **Verification (VERIFY-U): confirmed. Final severity: Low.** player.ts:263 and :276 use game.sound, which is a positional event (entity-services.ts:351-352) sent to all peers by the path in SRC3Q2-001. RR/p_weapon.cpp:445 uses gi.local_sound.
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/weapons/player.ts:263, :276; src/content/q2/foundation/entity-services.ts:351-352
- Confidence: traced
- Evidence: p_weapon.cpp:445 `gi.local_sound(ent, CHAN_AUTO, gi.soundindex("weapons/lowammo.wav"), 1, ATTN_NORM, 0);`, which sends only to that client. Port: `game.sound(self, "weapons/lowammo.wav", 0)` emits a positional sound event, and the Q2 server sends such events to every client (SRC3Q2-001).
- Impact: Opponents in a rerelease match hear when a nearby player's ammo runs low, which leaks information.
- Remediation: Emit it as a private event to the owner.

### SRC4Q2-011 — Rerelease BFG lasers draw past the target
- **Verification (VERIFY-U): confirmed. Final severity: Low.** ballistics.ts:519 emits the last pierce trace's end. RR/g_weapon.cpp:1117-1136 writes tr.endpos from the unobstructed trace to the target point, separate from pierce_trace.
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/weapons/ballistics.ts:519
- Confidence: traced
- Evidence: g_weapon.cpp:1117 `tr = gi.traceline(start, point, nullptr, MASK_SOLID);` and :1133 `gi.WritePosition(tr.endpos);` use the local `tr`, which ends at the target's center because :1119 has already rejected blocked traces. pierce_trace keeps its own `args.tr`. Port emits `end: trace.end`, the last pierce trace, which runs through the target up to 2048 units to a wall. Classic does use the final trace, so only rerelease differs.
- Impact: Rerelease BFG beams extend through monsters to the wall behind them.
- Remediation: In rerelease, use the center as the beam end.

### SRC4Q2-012 — IF_NO_HASTE is ignored in the weapon animation rate
- **Verification (VERIFY-U): confirmed. Final severity: Low.** presentation.ts:24-27 doubles the rate for any nonzero frame, and animationTime (player.ts:356-363) uses it. RR/p_weapon.cpp:465 exempts IF_NO_HASTE while firing, with the flag on RR/g_items.cpp:1817 and :1872. `noHaste` and `NO_HASTE` have no hit under src/content/q2.
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/weapons/presentation.ts:24-27; src/content/q2/foundation/weapons/player.ts:356-363
- Confidence: traced; no run under Dualfire or Haste
- Evidence: p_weapon.cpp:465 `if (ent->client->ps.gunframe != 0 && (!(ent->client->pers.weapon->flags & IF_NO_HASTE) || ent->client->weaponstate != WEAPON_FIRING))`. Flags are on the grapple (g_items.cpp:1817) and the chainfist (:1872). Port: `if (input.frame !== 0) { if (input.quadFireUntil > input.now) rate *= 2; if (input.haste) rate *= 2; }`, with no flag or firing test. `Q2BaseWeaponDefinition` has no such field.
- Impact: In the rerelease edition, the chainfist under Dualfire or the Haste tech animates and damages at twice the intended rate, and the grapple cycles faster.
- Remediation: Add the flag to the definition and the condition to the rate.

### SRC4Q2-013 — Landmark falls do not suppress self noise
- **Verification (VERIFY-U): confirmed. Final severity: Low.** rerelease/environment.ts:58 stores landmarkNoiseTime and :65 reports noise in the same call. Its only other use is the write at base/player/environment.ts:69, and reportNoise (perception.ts:169-171) has no landmark test. RR/p_weapon.cpp:173-175 returns for that case.
- Severity: Low
- Category: bug
- Location: src/content/q2/rerelease/environment.ts:58, :65; src/content/q2/base/player/environment.ts:69; src/content/q2/foundation/monsters/perception.ts:169-171
- Confidence: traced; grep finds `landmarkNoiseTime` only at its declaration and two writes
- Evidence: p_weapon.cpp:173-175 `if (type == PNOISE_SELF && (who->client->landmark_free_fall || who->client->landmark_noise_time >= level.time)) return;`. Port self noise goes `hooks.noise` to `reportNoise`, which has no such test, and the time it stores is never read.
- Impact: Arriving by a rerelease landmark level change and landing alerts nearby monsters, where the source keeps that landing silent.
- Remediation: Test both fields before reporting self noise.

### SRC4Q2-014 — M_ChangeYaw turns the other way at exactly 180 degrees
- **Verification (VERIFY-U): confirmed. Final severity: Low.** ai.ts:93-94 uses strict comparisons, so a difference of exactly +180 stays positive and -180 stays negative. m_move.c:319-328 uses >= and <= under an ideal > current test, which flips both.
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/monsters/ai.ts:93-94
- Confidence: traced
- Evidence: m_move.c:319-328: `if (ideal > current) { if (move >= 180) move = move - 360; } else { if (move <= -180) move = move + 360; }`. Port: `if (move > 180) move -= 360; if (move < -180) move += 360;`. Exact 180 degree differences are common because SV_NewChaseDir uses multiples of 45.
- Impact: A monster reversing on a cardinal line rotates in the opposite direction. This is visible, and it changes which way it faces mid-turn when `infront` and step checks run.
- Remediation: Use the source's comparisons.

### SRC4Q2-015 — Rerelease infantry jump up does not face the wall, and the drop's water test uses the wrong height
- **Verification (VERIFY-U): confirmed. Final severity: Low.** RR/rogue/g_rogue_newai.cpp:247 calls face_wall, which has no port equivalent in monsters/index.ts:745-759. Port water test is deep.end.z + 48; RR/g_monster.cpp:203-221 reaches WATER_UNDER at in_point + mins + 49, 25 units above the floor for infantry, so the port refuses later.
- Severity: Low
- Category: bug
- Location: src/content/q2/foundation/monsters/index.ts:756, :758
- Confidence: traced; `face_wall` has no port equivalent by grep
- Evidence: g_rogue_newai.cpp:247 calls `face_wall(self);` before `monster_jump_start`; :923-945 traces 64 units ahead and sets `ideal_yaw` from the wall normal, then M_ChangeYaw. Port goes straight to `finishDodge` and `setMove`. g_rogue_newai.cpp:206-211 runs M_CatagorizePosition at `deep.endpos` and rejects above waist level. The port tests `deep.end.z + 48` with no `mins` term, so it requires deeper water before refusing.
- Impact: Infantry can leap up at an angle to a ledge and miss it, and can drop into water the source refuses.
- Remediation: Port face_wall, and test via the shared categorization.

### SRC4Q2-016 — Native downloads never resume, and the load path parses models strictly where the original tolerates them
- **Verification (VERIFY-U): confirmed. Final severity: Low.** q2-downloads.ts:325-327 always sends `download ${path}` with a new sink; cl_parse.c:94-112 resumes from the .tmp length. parseMd2 and parseSp2 at :264-270 are unguarded and :332 rethrows. cl_main.c's tolerance was taken from the finding and recollection, not reopened.
- Severity: Low
- Category: robustness
- Location: src/app/bootstrap/network/q2-downloads.ts:264-270, :325-327
- Confidence: traced; malformed-model throw seen in formats/q12-model/md2.ts:37, not run through `prepare`
- Evidence: cl_parse.c:94-112 looks for the `.tmp` file and sends `download %s %i` with its length. Port always sends `download ${path}` with a new sink, while the server side supports an offset (:77-87). cl_main.c's model loop `continue`s on a load failure, a non-alias header or a wrong version. Port calls `parseMd2(opened.bytes, model)` and `parseSp2(...)` unguarded, and `prepare` rethrows at :332.
- Impact: An interrupted large map starts over on reconnect. A mounted or just downloaded malformed model ends the client during load (APP-001), rather than loading without its skin check.
- Remediation: Resume from staged bytes, and catch parse errors per model.

### SRC4Q2-017 — A spawn baseline for entity 0 throws where the original accepts it
- **Verification (VERIFY-U): confirmed. Final severity: Low.** server-messages.ts:175-176 and :302-304 throw on entity 0; cl_parse.c:368-370 has no zero test. q2.ts:630-700 has no try or catch around receive at :674. Needs a hostile or modified server, and exit depends on APP-001.
- Severity: Low
- Category: robustness
- Location: src/network/q2/server-messages.ts:173-176, :302-304
- Confidence: traced; the stream-parse path through `receive` has no guard in q2.ts:674. Stock servers start baselines at entity 1, so this needs a hostile or modified server
- Evidence: cl_parse.c:368-370 reads the number and writes `cl_entities[newnum].baseline` with no zero test. Port: `if (parsed === null) throw new Error('Q2 zero spawn baseline');`. SRCQ2-015 covers frame reader throws, not this message.
- Impact: A server can end a connected client process with one message (APP-001).
- Remediation: Ignore the record, or drop the connection with a message.

## Summary of IDs
High 2 (001, 002). Medium 2 (003, 004). Low 13 (005-017). Critical 0. Reproduced: 001 (component level), 002, 003. No finding refutes a catalog entry.
