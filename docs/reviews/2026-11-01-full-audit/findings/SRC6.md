# SRC6 — The items in Part D of SRC5's Coverage, against upstream/

HEAD fcdc8af5. Original paths are relative to `<scratchpad>/upstream/`: `ID1`, `CTF`, `MG1`, `MG3`, `HIP`, `ROG` = `quake-rerelease-qc/quakec`, `quakec_ctf`, `quakec_mg1`, `quakec_mg3`, `quakec_hipnotic`, `quakec_rogue`; `RR2` = `quake2-rerelease-dll/rerelease`; `RQ2` = `quake2-rerelease-dll/original/rogue`; `Q2` = `Quake-2`; `Q3` = `Quake-III-Arena/code`; `QW` = `Quake/QW/server`. Port paths are relative to `src/`, read from `<scratchpad>/clean`. Nothing from upstream was executed. Scripts are in `<scratchpad>/src6/`.

## Coverage

### Part D item by item
| SRC5 Part D item | Status | Result |
|---|---|---|
| MG1 client.qc diff beyond PutClientInServer | Compared. Full `diff -bw` against ID1 client.qc read | SRC6-009 (corpse fade). The rest is catalogued or matches, see Strengths |
| MG1 items.qc diff | Compared. Full diff against ID1 items.qc read | SRC6-008, SRC6-012. Coop respawn, `wait`, worldtype, start flags are catalogued |
| CTF client.qc 905-1330, obituary after 1764 | Compared, both ranges read | SRC6-007, SRC6-010, SRC6-014 |
| CTF items.qc rune section vs ctf/runes.ts | Compared, items.qc:1531-1746 against runes.ts in full | No rune mismatch. Elder Magic rot exception is dead source code, see SRC6-007 |
| CTF combat.qc beyond the carrier hurt lines | Compared, all 324 lines against ctf/scoring.ts and runes.ts | No finding |
| equipment/threewave-weapon.ts vs CTF weapons.qc | Compared, plus CTF player.qc:200-233 for frames | Frames, pose numbers and delays match. SRC6-013, SRC6-014 for the impulses around it |
| MG3 mg3_weapons.qc laser touch and lightning chain | Compared, all 576 lines against items/weapons.ts and hipnotic-weapons.ts | SRC6-015 |
| MG3 LightningDamage particle colour 246 | Compared, and traced through the `blood` effect | SRC6-011 |
| upstream/Quake/QW pr_cmds.c | Partly. Read: setmodel, bprint, sprint, centerprint, sound, stuffcmd, localcmd, cvar, cvar_set, aim, setspawnparms, changelevel, logfrag, infokey, stof, multicast, the builtin table | SRC6-018. The rest is shared with WinQuake pr_cmds.c, which SRC3Q1B compared |
| qw-qc beyond the quad line | **Not compared line by line.** Reason: QW game logic runs from the original `qwprogs.dat` in the QC VM, so it has no TS port to diff. Only `infokey` and `setmodel` call sites were read | SRC6-018 |
| base/frames.ts and base/monster-actions.ts for MG monsters | Compared by `src6/frames.py` | See Strengths. Only frame number, next frame and ai distance are scripted; other operations rely on the QC body diff below |
| Tails of capped MG3 diffs, MG1-vs-MG3 ai.qc diff | Compared, no cap | SRC6-010, SRC6-015. The rest is SRC4Q1A-015/-018 |
| MG1 monster files other than boss.qc, zombie.qc | Compared, by diff against ID1 and by the frame body diff (`src6/bodies.txt`) | SRC6-009, SRC6-010 |
| Q3 vm.c VM_LoadSymbols, VM_ValueToSymbol, VM_Call, VM_VmProfile, VM_VmInfo, VM_ExplicitArgPtr | Compared against symbols.ts, registry.ts, game.ts:28-46 | No finding |
| Q3 syscall argument shapes per trap | Partly. All of CL_CgameSystemCalls, CL_UISystemCalls and SV_GameSystemCalls up to BOTLIB_SETUP against the decoders. Enum values by `src6/enums.py`: 0 differences across 382 entries | No finding. Not compared: see below |
| Q3 GL and CPU shadow backends' pixel behaviour | **Not compared.** Reason: a pixel comparison needs id's renderer running or a window, which the brief forbids. SRC3Q3-005 already shows modes 2 and 3 have no producer | None |
| tr_mesh.c R_ComputeFogNum port | Compared, also R_SpriteFogNum and the poly fog test | No finding |
| paksort port side | Compared | SRC6-017 |
| RQ2 g_ai.c, m_move.c | Compared, by diff against Q2 game/, against ai.ts and perception.ts:165-414 | SRC6-002, SRC6-003, SRC6-004 |
| m_move.cpp 131-859 | Compared, all read | SRC6-001, SRC6-004 |
| Species `*_blocked` callers other than infantry | Compared, all 16 rerelease species | SRC6-019. Bodies of `blocked_checkjump` and `blocked_checkplat` were not compared |
| muzzle.ts, non-script parts of moves.ts | Compared by `src6/q2t2.py` | See Strengths |
| Pickup_Weapon rerelease respawn timing | Compared | SRC6-006 |
| G_CheckInfiniteAmmo | Compared | SRC6-005 |
| Tail of CL_RequestNextDownload | Compared, cl_main.c from the model loop to the end | SRC6-016 |
| Throw_Generic line by line | Compared, p_weapon.cpp:1013-1210 against `throwRerelease` | No finding; the end of the throw matches |
| QC side of commands.ts, Rogue weapon cycles | Compared: HIP and ROG CheatCommand, QuadCheat, ImpulseCommands, the HIP cheat functions, ROG CycleWeaponCommand, CycleWeaponReverseCommand, W_ChangeWeapon to impulse 65 | No finding |

### Not compared, with reasons
- `compat/qvm/bot-library-syscalls.ts`, `bot-navigation-syscalls.ts`, `legacy-bot-syscalls.ts`: BOTLIB traps. Budget; these were last audited in the BOTS reviews, not per trap here.
- `compat/qvm/client-browser-syscalls.ts:1-59` and most of `client-script-syscalls.ts`: LAN and PC traps. Budget.
- Monster `army` and `dog` frame tables: 189 frames that are not in `base/frames.ts`. Out of the Part D wording, and SRC4Q1A-002 says the MG classes do not use the ordinary controller.
- The upstream qw-qc logic and shadow pixels, as in the table.

## Strengths
- **Base frame tables.** `frames.py` compared every QC frame function against `base/frames.ts`. ID1 1307, MG1 1306, MG3 1306: 0 frame-number and 0 next-frame differences. The 6 rows printed are source frames the port routes through a named action.
- **Monster muzzle and soldier tables.** `q2t2.py`: classic `m_flash.c` 212 of 212 rows and rerelease `m_flash.h` 290 of 290 match. `m_soldier` and `m_infantry` classic (22 and 12 moves) and rerelease (28 and 17) match; the one printed row is a parser artefact on a lambda.
- **Trap numbering and shapes.** All three import enums match the C headers, and every cgame, UI and game trap read uses the right argument words, including `Key_GetKey`, `GetConfigString` and the CD key traps.
- **vm.c.** Symbol parsing, the segment skip, the 16-byte record, `perc` in float, profile reset and the VmInfo layout are faithful.
- **Fog selection.** `R_ComputeFogNum`, `R_SpriteFogNum` and the poly bounds test match, including the Math.fround on the MD3 path.
- **Runes.** Spawn rotation, `random() * 10` skip loop, `Do_DropRune`, the `teamplay == IT_SIGIL4` quirk, regeneration, haste intervals and `items2` values all match.
- **Throw_Generic and alternate fly.** `throwRerelease` and `steerQ2AlternateFly` match line for line, apart from the deliberate hand grenade reservation.
- **Rogue selection.** Both cycles match, including the source's reverse-only `ammo_lava_nails < 2` quirk.
- **Candidates dropped after checking:**
  - The grenade end of throw looked wrong because it sets `fireFinished` and frame 49. p_weapon.cpp:1196-1200 does the same.
  - `$modlist` is VM-006.
  - The `validate` regex throw is SRC4Q2-001.
  - `staydeadtime` only ever gets 0 in CTF, so client.qc:1006 is dead.
  - `Cvar_Update` on an over-long value throws where id drops; this is the GAPQ3-009 family.

## Findings

### SRC6-001 — Rerelease SV_movestep is the classic version: no wall sliding, no partial moves, and monsters refuse any water
- **Verification (VERIFY-W): confirmed. Final severity: High.** `ai.ts:161-165` and `:176-205` are one algorithm for all editions. m_move.cpp:659-664, :676-697, :717-728, :745, :750-770, :850-858 and :485-492 read as cited. No `bump_time`, `bad_move_time` or equivalent exists under `content/q2`.
- Severity: High
- Category: bug
- Location: content/q2/foundation/monsters/ai.ts:141-205, :161-165, :176-187
- Original: RR2 m_move.cpp:655-890 (ground), :443-600 (SV_flystep)
- Confidence: traced. SRC5-002 is the caller layer (M_MoveToGoal, SV_StepDirection); this is the step below it, and SRC4Q2 checked it only against classic.
- Evidence: `sourceMoveStep` has one algorithm for all editions: `const start = add(destination, scale(gravity, -18)), end = add(start, scale(gravity, 36));`, then a vertical trace at the destination. The rerelease differs:
  - m_move.cpp:676-697: traces forward from a stepped-up start and from the origin, and keeps whichever went farther. The move can be partial. The port only accepts the full destination.
  - m_move.cpp:752-772: when barely moving, it sets `bad_move_time`, and if `bump_time` allows, `SlideClipVelocity` picks a new `ideal_yaw` along the obstacle and returns true. No `bump_time` exists in `src`.
  - m_move.cpp:717-728: `M_CatagorizePosition` lets a monster enter water up to its waist and refuses only deep water, slime and lava. Port ai.ts:187 keeps classic: `if ((pointContents(feet) & MASK_WATER) === 0 && (pointContents(end) & MASK_WATER) !== 0) return false;`.
  - m_move.cpp:659-664: SPAWNFLAG_MONSTER_SUPER_STEP gives a 64 unit step and AI_NOSTEP gives 1. The port hard-codes 18 and reads bit 131072 only in `checkBottom`.
  - m_move.cpp:745: dead monsters may fall off edges during death frames. Port :189 returns false.
  - m_move.cpp:850-860: `M_CheckGround` after the move rejects steps with no valid ground. Port :201 takes the trace hit.
  - Flying: m_move.cpp:485-492 halves the horizontal move and uses the full move length vertically, and :527-534 handles non-client goals. Port :161-165 keeps classic's `frameSeconds() * 80` stride, and there is no fixbot frame logic (:497-518) or `G_Impact` on a failed move (:592).
- Impact: In the TS rerelease provider, ground monsters stop dead against corners rather than sliding, stop at the edge of any shallow water while chasing the player, and flyers climb and dive at the wrong rate. This shows on every level and compounds SRC5-002.
- Remediation: Add a rerelease branch for ground and fly steps, with `bump_time`, `bad_move_time` and `M_CheckGround` state, rather than patching the classic path.

### SRC6-002 — Classic Rogue ground monsters never strafe
- **Verification (VERIFY-W): confirmed. Final severity: Medium.** original/rogue/g_ai.c:18 and the `#ifdef SLIDING_TROOPS` else branch with `random() < 0.4` are real. `perception.ts:63-75` handles only fly, plus a rerelease-only straight branch, so classic Rogue walkers skip both the strafe and the RNG call.
- Severity: Medium
- Category: bug
- Location: content/q2/foundation/monsters/perception.ts:63-75
- Original: RQ2 g_ai.c:18, :858-866
- Confidence: traced. A grep for `"sliding"` across `missionpacks/monsters` finds only the carrier and the dodge in rogue-common.ts:72.
- Evidence: Rogue defines `#define SLIDING_TROOPS 1` and adds, after the `FL_FLY` block: `else { if (random() < 0.4) self->monsterinfo.attack_state = AS_SLIDING; else self->monsterinfo.attack_state = AS_STRAIGHT; }`. The port's matching branch is `else if (rerelease && state.locomotion !== "fly" && state.pathing === null) state.attackState = "straight";`, and classic Rogue has no branch at all.
- Impact: In classic Rogue, soldiers, gunners and other walkers do not circle-strafe 40% of the time as the mission pack intends. The missing `random()` call also shifts the shared source RNG on every failed attack roll for walking monsters.
- Remediation: Add the source branch under `rogue && !rerelease`, with its `random()` call.

### SRC6-003 — Small classic Rogue AI drifts: side step clamp and `visible` target test
- **Verification (VERIFY-W): confirmed. Final severity: Low.** original/rogue/g_ai.c `!self->flags & FL_FLY` clamps only when flags are 0, and `ai.ts:370` clamps only in rerelease; `ai.ts:49` lacks `trace.ent == other`. The clamp gap matters today, not only after SRC6-002, since classic Rogue dodges already reach `slide`.
- Severity: Low
- Category: bug
- Location: content/q2/foundation/monsters/ai.ts:370, :41-50
- Original: RQ2 g_ai.c:19, :965-966, :361; RR2 g_ai.cpp:437
- Confidence: traced
- Evidence:
  - `if (!self->flags & FL_FLY) distance = min (distance, MAX_SIDESTEP);` parses as `(!flags) & 1`, so it clamps to 8 for a monster with no flags at all. Port: `game.options.edition === "rerelease" && state.locomotion !== "fly" ? Math.min(...) : distance`, so classic Rogue slides at the full frame distance.
  - Source `visible` is `trace.fraction == 1.0 || trace.ent == other` in both Rogue and the rerelease. Port ai.ts:49 tests only `.fraction === 1`.
- Impact: Strafing, once SRC6-002 is fixed, would be faster than the source. A target that is itself in the opaque mask, such as a brush entity, reads as not visible.
- Remediation: Apply the clamp with the source's flags test, and accept a trace that hits the target.

### SRC6-004 — The carrier keeps the 40 unit hover height, not 104
- **Verification (VERIFY-W): confirmed. Final severity: Low.** `ai.ts:163-164` hard-codes 40 and 30. original/rogue/m_move.c:258-270 and m_move.cpp:458-463, :482-489 use 104 for `monster_carrier`, and `carrier.ts` has no height rule.
- Severity: Low
- Category: bug
- Location: content/q2/foundation/monsters/ai.ts:163-164
- Original: RQ2 m_move.c:258-270; RR2 m_move.cpp:458-462, :483-492
- Confidence: traced
- Evidence: Source: `if (!strcmp(ent->classname, "monster_carrier")) minheight = 104; else minheight = 40;`, with `dz > minheight` and `dz < minheight - 10`, commented "to help prevent him from shooting his fliers, who spawn in below him". Port: `if (dz > 40) ...; if (dz < 30 && ...)`. No other carrier height rule exists in carrier.ts.
- Impact: The carrier flies about 64 units lower than intended. It is easier to hit and can hit its own spawned flyers.
- Remediation: Use the source's per-class minimum height.

### SRC6-005 — Rerelease `g_infinite_ammo` and `g_instagib` do nothing in the TS provider
- **Verification (VERIFY-W): confirmed. Final severity: Medium.** `runtime.ts:2972` and `:4746` hard-code `infiniteAmmo: false`, and no Q2 file overrides it. `items.ts:587` and `:594` read dmflag 8192 in every edition. `q2-owner.ts` registers none of the cvars, and a grep of `content/q2`, `app` and `settings` finds only the comment at `types.ts:74`.
- Severity: Medium
- Category: bug
- Location: app/bootstrap/simulation/runtime.ts:2972, :4746; content/q2/foundation/weapons/player.ts:260, :270; content/q2/foundation/items.ts:587, :594; settings/server/q2-owner.ts:16-22, :36-46
- Original: RR2 p_weapon.cpp:25-31, :266, :433; g_items.cpp:596, :619, :1312-1323, :1363-1375, :1429-1433; p_client.cpp:427, :861-872; g_main.cpp:247, :339
- Confidence: traced. `grep -rn 'instagib\|g_infinite_ammo'` over `content/q2` and `app` finds only a comment at weapons/types.ts:74.
- Evidence: The rerelease fire path reads `context.rerelease ? context.input.infiniteAmmo : dmflag`, and both constructors of that input hard-code `infiniteAmmo: false`. The item paths read classic `deathmatchFlags & 8192` in every edition, so a rerelease server with that bit grants 1000 ammo on pickup and still consumes on fire. Neither cvar is registered in `q2-owner.ts`, and `q2SourceDeathmatchFlags` maps only four `g_dm_*` cvars. `g_no_health`, `g_no_armor` and `g_no_items` also have no TS reader.
  Missing as well: `IF_NO_INFINITE_AMMO` on trap and tesla, removal of plain ammo items (:1363-1368), the BFG to Disruptor swap (:1373), the power armor swap (:1429), the `Drop_Ammo` refusal (:619), and all instagib rules: no pickups, railgun with 99 slugs, no blaster, no weapon drop.
- Impact: Setting these rerelease server options has no effect and gives no warning.
- Remediation: Register the cvars, feed `infiniteAmmo` from a single `G_CheckInfiniteAmmo` port, and use it in items too. If instagib is out of scope, say so in the docs.

### SRC6-006 — Rerelease weapons-stay pickups schedule no DoRespawn
- **Verification (VERIFY-W): confirmed. Final severity: Low.** `items.ts:719-722` returns with `retained = true` and no schedule. p_weapon.cpp:275-280 calls SetRespawn with `hide_self` false in deathmatch, and g_items.cpp:181-198 schedules DoRespawn without hiding. The coop path correctly has no respawn. The DoRespawn body itself was not reopened.
- Severity: Low
- Category: bug
- Location: content/q2/foundation/items.ts:719-722
- Original: RR2 p_weapon.cpp:275-280; g_items.cpp `SetRespawn`, `DoRespawn`
- Confidence: traced
- Evidence: Source: `if (g_dm_weapons_stay->integer) ent->flags |= FL_RESPAWN; SetRespawn(ent, gtime_t::from_sec(g_weapon_respawn_time->integer), !g_dm_weapons_stay->integer);`. `hide_self` is false, so the weapon stays visible, and DoRespawn still runs after the delay. The port returns early: `this.pickup(entity).retained = true; return undefined;`. Classic has no such call, so this path is right for classic only.
- Impact: With weapons stay on, the rerelease plays EV_ITEM_RESPAWN on a taken weapon after 30 seconds and re-rolls a team chain at that point. The port does neither.
- Remediation: In the rerelease edition, schedule the respawn without hiding the item.

### SRC6-007 — CTF mega health rots in the port; the rerelease CTF source never rots it
- **Verification (VERIFY-W): confirmed. Final severity: Medium.** In quakec_ctf, `healthrot_nextcheck` is set at items.qc:211 and never read, and `item_megahealth_rot` is never assigned to `think`. `pickups.ts:398` sets `megaRotAt` for all rerelease programs, and `entity-services.ts:515-518` applies it. No CTF exemption exists.
- Severity: Medium
- Category: bug
- Location: content/q1/foundation/pickups.ts:398; content/q1/foundation/entity-services.ts:515-518
- Original: CTF items.qc:208-212, :228-249; CTF client.qc:1281-1322
- Confidence: traced. `grep healthrot\|item_megahealth_rot\|CheckHealthRot quakec_ctf/*.qc` gives only defs.qc:593, items.qc:142, :211, :228.
- Evidence: CTF `health_touch` sets `other.healthrot_nextcheck = time + 5;`, but CTF has no `CheckHealthRot`, unlike ID1 client.qc:1400 and :1460, and its PlayerPostThink does not call one. `item_megahealth_rot`, with the Elder Magic exception, is declared and defined but never assigned to `think`. The port applies ID1's rule to all rerelease programs: `if (game.options.edition === "rerelease" && entity.classname === "item_health" && (entity.spawnflags & 3) === 2) player.megaRotAt = game.time + 5;`. The classic ThreeWave source is not in upstream, so the classic path was not judged.
- Impact: In rerelease CTF a player's mega health bonus decays by 1 per second where the source keeps it until spent, up to 250. That changes fights around a mega spawn.
- Remediation: Skip `megaRotAt` for the CTF program in the rerelease edition.

### SRC6-008 — MG1 and MG3 mega health uses ID1's fixed 120 second respawn and one rot timer
- **Verification (VERIFY-W): confirmed-with-changes. Final severity: Medium.** Correction: MG is not rerelease only. `catalog/products.ts:24-25` lists classic MG products, which take the item-bound `health_rot` path (`pickups.ts:410-412`). The defect applies to `q1-rerelease-mg1` and `-mg3` (products.ts:31-32). On classic MG, `pickups.ts:434` regenerates only at deathmatch 1, where MG1 items.qc tests `deathmatch && deathmatch != 2`.
- Severity: Medium
- Category: bug
- Location: content/q1/foundation/pickups.ts:32, :398, :408-413
- Original: MG1 items.qc:217-224, :268-289; MG3 items.qc:267-273, :317
- Confidence: traced
- Evidence: Both MG programs keep the classic form: `self.nextthink = time + 5; self.think = item_megahealth_rot; self.owner = other;`, and after the rot `if (deathmatch && deathmatch != 2) { self.nextthink = time + 20; self.think = SUB_regen; }`. The port's item-bound `health_rot` path is gated to `edition === "classic"`, and MG is rerelease only, so MG gets `respawn: mega ? 120 : 20` and a single `player.megaRotAt`.
- Impact: In MG deathmatch, including mgdm1-4, a mega returns 25 seconds after the holder rots to 100 plus the bonus time, not at a fixed 120. Two stacked megas rot at 2 per second in the source and 1 here.
- Remediation: Use the item-bound rot for the MG1 and MG3 programs.

### SRC6-009 — Horde monster corpses are never faded or removed
- **Verification (VERIFY-W): confirmed. Final severity: Medium.** MG1 monsters.qc:279-301 and the final death frames (knight.qc:217-220, dog.qc:239, :253) fade corpses. `addons/horde/index.ts:75-85` schedules a fade only for `progs/h_*` heads, and no `MonsterFade` or `FADETIME` exists under `content/q1`. Retention scales with non-gib kills, for the life of the map.
- Severity: Medium
- Category: leak
- Location: content/q1/addons/horde/index.ts:28-37, :75-85; content/q1/base/frames.ts (final death frames)
- Original: MG1 monsters.qc:279-301; MG1 monsters/*.qc final death frames, for example knight.qc `knight_die10` and dog.qc `dog_die9`; MG1 defs.qc:844
- Confidence: traced. `grep MonsterFade\|FADETIME` over `src/content/q1` finds nothing. Only `head_fade` for `progs/h_*` heads exists.
- Evidence: Every MG1 final death frame does `if (horde_ent) { self.think = MonsterFade; self.nextthink = time + FADETIME; }`, or the same unguarded on dog, army, enforcer and shambler. `MonsterFade` returns unless `cvar("horde")` is set, waits `10 + random() * 5`, and MonsterFade2 lowers alpha and removes the entity. The port's Horde `die` handler only schedules `head_fade` when the monster gibbed. A corpse from a non-gib death has no think.
- Impact: Retention scales with kills. Horde's rising waves leave every non-gibbed corpse as a live entity for the rest of the map, which raises entity scan and network costs in a mode built to run long, and clutters the arena.
- Remediation: On the final death frame in Horde, run the same fade the heads use.

### SRC6-010 — MG dog and fiend leaps have no 0.5 second damage limiter
- **Verification (VERIFY-W): confirmed. Final severity: Low.** MG1 demon.qc:348-355 and dog.qc:91 gate on `attack_finished`, and the demon sets it to time + 0.5. `base/monster-actions.ts:29-34` and `foundation/monsters.ts:230-236` (dog) have no limiter.
- Severity: Low
- Category: bug
- Location: content/q1/base/monster-actions.ts:29-34
- Original: MG1 monsters/dog.qc:91, monsters/demon.qc:348; MG3 monsters/dog.qc:91, monsters/demon.qc:341
- Confidence: traced for the fiend. The MG dog runs the foundation path per SRC4Q1A-002, which also has no limiter.
- Evidence: Source: `if (other.takedamage && self.attack_finished < time) { if (vlen(self.velocity) > 400) { ...; self.attack_finished = time + 0.5; } }`. Port: `if (damageable && (!tar || ...)) { if (length(velocity) > 400) game.damage(other, ...) }`, shared with ID1, which has no limiter.
- Impact: A leap with repeated touches can hit more than once in MG1 and MG3.
- Remediation: Add the limiter under the MG programs.

### SRC6-011 — Thunderbolt hits draw red blood, not the source's sparks, and MG3 traps use the wrong colour
- **Verification (VERIFY-W): confirmed. Final severity: Low.** `foundation/weapons.ts:144` emits `blood`, and `app/bootstrap/effects.ts:460` draws it as colour 73 with zero velocity. ID1 weapons.qc:457 uses colour 225 with '0 0 100', and MG3 weapons.qc:477, :490, :498 use 246. `addons/effects.ts:54` uses 225 for all programs.
- Severity: Low
- Category: bug
- Location: content/q1/foundation/weapons.ts:144; app/bootstrap/effects.ts:460; content/q1/addons/effects.ts:54
- Original: ID1 weapons.qc:457, :471, :480; MG3 weapons.qc:477, :490, :498; MG3 misc_fx.qc:221
- Confidence: traced. This answers SRC4Q1B's open question about what the `blood` effect draws.
- Evidence: Source: `particle (trace_endpos, '0 0 100', 225, damage*4);`, and MG3 changes it to 246, with the comment "particle was 225". Port: `game.effect("blood", trace.end, target, 120)`, and `case "blood": ... particles.q1Impact(event.origin, zero, 73, event.amount, seconds)`, which is colour 73 with no upward velocity. `trigger_lightning` emits `color: 225` for all programs, where MG3 calls the 246 LightningDamage. Only `heavyLightningDamage` uses 246.
- Impact: Every Q1 Thunderbolt hit in TS rules looks like a blood spray rather than rising sparks, and MG3 lightning hits have the wrong palette colour.
- Remediation: Emit the source's `particles` event from `lightning()`, with colour by program, as `heavyLightningDamage` does.

### SRC6-012 — MG1 and MG3 coop: the biosuit does not return, and key targets fire once per player
- **Verification (VERIFY-W): confirmed. Final severity: Medium.** `pickups.ts:404` and `:409-414` re-fire key targets in coop and never respawn a coop suit, because `:409` respawns only in deathmatch. MG1 items.qc:975, :1137-1142 and MG3 items.qc:1045, :1207-1212, :1237-1242 read as cited. No addon rule supplies either behaviour.
- Severity: Medium
- Category: bug
- Location: content/q1/foundation/pickups.ts:404, :409-414
- Original: MG1 items.qc:975, :1137-1142; MG3 items.qc:1045, :1207-1212, :1237-1242
- Confidence: traced. SRC4Q1B-002 covers `COOP_RESPAWN_ITEMS_FOR_PLAYERS` and `wait`; this source branch is separate, and no `envirosuit` rule exists under `addons/`.
- Evidence: Source powerup touch: `if(coop) //Respawn biosuit in coop, since it might be required for progression { self.target = string_null; self.think = SUB_regen; self.nextthink = time + 2.5; }`. Source key touch ends with `SUB_UseTargets(); self.target = string_null; //Only fire the trigger once though.`. The port's coop key path re-fires: `if (leave) { if (!entity.classname.startsWith("weapon_")) game.useTargets(entity, other); return; }`.
- Impact: Only the first coop player gets the suit, on maps the authors flagged as needing it for progress. A second player taking a key re-runs its targets, which can re-toggle authored events.
- Remediation: Add both source branches to the MG pickup rules.

### SRC6-013 — CTF next and previous weapon skip the grapple, and leave it the wrong way
- **Verification (VERIFY-W): confirmed. Final severity: Medium.** `foundation/types.ts:198` holds 8 base weapons, and `composition/q1/commands.ts:25-31` cycles them. `selectWeapon` stores the registered grapple id in `player.weapon` (`entity-services.ts:635`), so the index is -1, giving axe on next and rocket launcher on previous. CTF weapons.qc:1198-1207 and :1328-1336 include the hook. `Q1Ctf.impulse` returns false for 10 and 12.
- Severity: Medium
- Category: bug
- Location: content/composition/q1/commands.ts:25-31; content/q1/addons/ctf/index.ts:64-76
- Original: CTF weapons.qc:1201-1207, :1330-1336
- Confidence: traced
- Evidence: Source next cycle: LIGHTNING, AXE, HOOK, SHOTGUN. Reverse: SHOTGUN, HOOK, AXE, LIGHTNING. `Q1Ctf.impulse` returns false for 10 and 12, and `q1WeaponImpulse` walks `WEAPONS`, the 8 base weapons, with `WEAPONS.findIndex(weapon => weapon === player.weapon)`. With the grapple selected the index is -1, so next gives the axe where the source gives the shotgun, and previous computes `(-1 - 1 + 16) % 8 = 6`, the rocket launcher, where the source gives the axe.
- Impact: A CTF player using weapon next and previous can never select the grapple, and jumps to an unrelated weapon when leaving it.
- Remediation: Pass a CTF order to the cycle, as the mission packs and MG3 do.

### SRC6-014 — Smaller CTF client drifts: impulses 31 and 99, grapple attack hooks, and the death log
- **Verification (VERIFY-W): confirmed-with-changes. Final severity: Low.** Correction: the strength rune sound is reached on the native path, because `fireRegisteredWeapon` calls `weaponBeforeFire` (`entity-services.ts:221-222`), which runs `ctf:rune_weapons` (`arsenal.ts:63-69`). It is missing only on the `q1-threewave` slot path (`grapple-runtime.ts:131`). Impulses 31 and 99, the missing `hostileUntil`, and the absent DEATH log (21 LogPlayer sites in CTF client.qc) stand.
- Severity: Low
- Category: bug
- Location: content/q1/addons/ctf/index.ts:64-81; content/q1/equipment/threewave-weapon.ts:40-51
- Original: CTF weapons.qc:1066-1069, :1382-1392, :1401, :1412-1413, :954, :1452, :1481-1505; CTF client.qc:1459-1845 (21 LogPlayer call sites); CTF log.qc:20
- Confidence: traced
- Evidence:
  - `impulse == 31` selects the axe directly, and 99 prints "You are at". Neither is in `Q1Ctf.impulse` or `q1WeaponImpulse`; `Q1SourceComposition.impulse` discards them at runtime.ts:167.
  - `grappleAttack` sets no `hostileUntil`, where W_Attack sets `self.show_hostile = time + 1`, and it reaches no strength rune sound, where W_WeaponFrame calls SuperDamageSound before W_Attack.
  - `flags.ts` logs flag events through `services.log`, but deaths are not logged in `LOG:  DEATH` form.
- Impact: One bind does nothing, and server log parsers see flag events without deaths.
- Remediation: Add both impulses and the death log.

### SRC6-015 — Small MG3 weapon and monster drifts
- **Verification (VERIFY-W): confirmed. Final severity: Low.** mg3_weapons.qc:243-247 returns on `trace_ent == self.owner`, and :387 sets `self = self.owner.owner` (the player, whose owner is world), so a center trace that hits no entity skips the side traces. `hipnotic-weapons.ts:134-146` always runs all three. MG3 fish.qc:79-84 differs from `base/frames.ts:880` (chance 0.5, no timer).
- Severity: Low
- Category: bug
- Location: content/q1/missionpacks/hipnotic-weapons.ts:134-146; content/q1/base/frames.ts (`f_run1`)
- Original: MG3 mg3_weapons.qc:243-247; MG3 monsters/fish.qc:79-84
- Confidence: traced
- Evidence:
  - HIP_HammerDamage in MG3 adds `if (trace_ent == self.owner) { dprint("avoid self-damage\n"); return; }`. HIP_LightningThink sets `self = self.owner.owner` first, so `self` is the player, whose owner is world. A center trace that hits no entity leaves `trace_ent` as world, so the source returns before the two side traces. The port, shared with Hipnotic, always runs all three.
  - MG3 fish idle becomes `if (self.waitmin > time) return; if (random() < 0.25) { sound; self.waitmin = time + 5 + random() * 5; }`. The port keeps ID1's 0.5 chance every run cycle, and consumes different random numbers.
- Impact: Mjolnir bolts rarely strike with a side trace where MG3 would not. Rotfish are noisier in MG3.
- Remediation: Add MG3 overrides for both.

### SRC6-016 — A Q2 client connecting to a map it lacks or holds in another version terminates, where the original drops
- **Verification (VERIFY-W): confirmed. Final severity: High.** `q2-downloads.ts:255-260` throws after `yield map`, including when permission is denied, since the loop at `:310-323` continues into the generator. `:332` rethrows, `q2-client-receiver.ts:95-100` and `q2.ts:698` have no guard, and `remote-application.ts:2286` rethrows into APP-001. Q2 cl_main.c:1315-1318 uses ERR_DROP. The process exit was traced, not run.
- Severity: High
- Category: robustness
- Location: app/bootstrap/network/q2-downloads.ts:255-260, :332; app/bootstrap/network/q2-client-receiver.ts:95, :116, :174; app/bootstrap/network/q2.ts:698; app/bootstrap/remote-application.ts:2286
- Original: Q2 client/cl_main.c:1312-1320
- Confidence: traced to the run loop. The process exit is per APP-001 and was not run, since that needs a window. APP-002 names sound, image and map-name throws at other sites; these two are not among them.
- Evidence: Source: `CM_LoadMap (...); if (map_checksum != atoi(cl.configstrings[CS_MAPCHECKSUM])) { Com_Error (ERR_DROP, "Local map version differs from server: %i != '%s'\n", ...); return; }`. ERR_DROP disconnects to the console. Port: `if (world === null) throw new Error(`Q2 server map is unavailable: ${map}`);` and `throw new Error('Q2 server map checksum differs from mounted content');`. `prepare` rethrows at its catch, `prepareGameState` has no guard, q2.ts:698 awaits it directly, and RemoteApplication's step catch rethrows.
- Impact: Joining a Q2 server running a map the player does not have, with downloads off or refused, or a different build of a map, ends the client rather than showing a disconnect message. This is ordinary use, and any server can cause it.
- Remediation: Convert both into a disconnect with the original message, along with the wider APP-001 work.

### SRC6-017 — Q3 pak ordering folds case the other way from FS_PathCmp, so `_` names sort differently
- **Verification (VERIFY-W): confirmed. Final severity: Low.** `catalog/index.ts:146-147` lowercases; files.c:2289-2318 uppercases and maps `\` and `:` to `/`. For `z_mod.pk3` and `zz.pk3` the sort order flips, so a different pak has top priority after `.reverse()`.
- Severity: Low
- Category: bug
- Location: content/catalog/index.ts:146-147
- Original: Q3 qcommon/files.c:2289-2318, :2442-2449, :2506
- Confidence: traced
- Evidence: `FS_PathCmp` uppercases `a-z` before comparing. Port: `sourceCompare(basename(left.path).toLowerCase(), basename(right.path).toLowerCase())`. Characters between `Z` (0x5A) and `a` (0x61) change side. For `z_mod.pk3` and `zz.pk3`: source compares `_` (0x5F) with `Z` (0x5A), so `zz` sorts first and `z_mod` overrides it. Port compares `_` with `z` (0x7A), so `z_mod` sorts first and `zz` overrides it. The source's `MAX_PAKFILES` cap of 1024 is also not applied.
- Impact: With custom pk3 files whose names differ at an underscore, a different file wins the override. id's own `pak0` to `pak8` are unaffected.
- Remediation: Uppercase in the comparator, and map `\` and `:` to `/` as the source does.

### SRC6-018 — QW `setmodel` resizes non-inline models, and `infokey` has no serverinfo, localinfo, `ip` or `ping`
- **Verification (VERIFY-W): confirmed. Final severity: Low.** `compat/qc/spatial-host.ts:41-48` always calls setSize, and no QW override of `setmodel` exists; QW pr_cmds.c:190-197 sizes only `*` models. `quakec-source.ts:354-358` and `mod-provider.ts:332-338` have no `ip`, `ping`, serverinfo or localinfo handling (QW pr_cmds.c:1549-1577). A repo grep finds no `serverinfo` or `localinfo` server command.
- Severity: Low
- Category: bug
- Location: compat/qc/spatial-host.ts:41-48; app/bootstrap/simulation/quakec-source.ts:354-358; compat/qc/mod-provider.ts:332-338
- Original: QW pr_cmds.c:163-197, :1549-1577
- Confidence: traced. Call sites in id's qw-qc pair `setmodel` with a later `setsize` or use non-solid entities, so stock `qwprogs.dat` is not visibly affected.
- Evidence:
  - QW: `// if it is an inline model, get the size information for it  if (m[0] == '*') {...}`, and otherwise the size is untouched. Port, for all kinds: `setSize(vm, slot, model.bounds);`, with the NetQuake -16 to 16 box for MDL.
  - QW world `infokey` reads `svs.info`, then `localinfo`. The port reads `this.cvars.variableString(key)`, and a repo grep finds no `serverinfo` or `localinfo` server command, so `dq`, `dr`, `rj` and `axe` are reachable only as plain cvars.
  - QW client `infokey` handles `"ip"` and `"ping"`. Neither port branch does, and both return an empty string.
- Impact: Third-party QW mods that call `setsize` before `setmodel`, or read `ping`, misbehave. The documented `serverinfo dq 1` style of QW configuration does not work.
- Remediation: Size only `*` models for QW programs, and add the two special keys and an info store.

### SRC6-019 — Rerelease Gekk has no blocked callback, and Stalker, Widow and Flyer use classic Rogue ones
- **Verification (VERIFY-W): confirmed-with-changes. Final severity: Low.** Corrections: `missionpacks/monsters/flyer.ts:49` does not run for a rerelease `monster_flyer`, which uses `rerelease/monsters/base-variants/flyer.ts` (no `blocked`), and the kamikaze has mass 100. Rerelease Gekk can use plats: the default at `index.ts:739` has a platform branch for all kinds; only the jump is missing. Stalker (`stalker.ts:175-185`) and widow (`widow.ts:126-129`) stand; both are in the fallback set at `index.ts:40`.
- Severity: Low
- Category: bug
- Location: content/q2/missionpacks/monsters/gekk.ts; content/q2/missionpacks/monsters/stalker.ts:175-185; content/q2/missionpacks/monsters/widow.ts:126-129; content/q2/missionpacks/monsters/flyer.ts:48-49; content/q2/foundation/monsters/index.ts:384
- Original: RR2 xatrix/m_xatrix_gekk.cpp `gekk_blocked`; rogue/m_rogue_stalker.cpp `stalker_blocked`; rogue/m_rogue_widow.cpp `widow_blocked`; m_flyer.cpp:655
- Confidence: traced. TABLES-004 covers the frame tables of these monsters; these are the blocked callbacks. The 12 base-game rerelease species match in order and arguments.
- Evidence:
  - `gekk_blocked` calls `blocked_checkjump`, then `blocked_checkplat`. `grep blocked gekk.ts` is empty, so the default at index.ts:384 applies, which only handles infantry and soldier.
  - Rerelease stalker: jump, then plat, then `if (visible(self, self->enemy) && frandom() < 0.1f)` pounce. Port: shot check, then `if (visible(context)) { pounce(...); return true; }`, always, which is the classic order.
  - Rerelease widow and flyer return false in their fallback. Port returns `rogueBlockedCheckShot(...)`.
- Impact: Rerelease Gekk cannot jump ledges or use plats. Rerelease Stalkers pounce on every blocked step they can see through.
- Remediation: Give the rerelease edition its own callbacks when TABLES-004 is fixed.
