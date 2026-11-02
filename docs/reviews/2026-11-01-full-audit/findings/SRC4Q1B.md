# SRC4Q1B — QuakeC adapters, CTF, MG1 and MG3 player code, and the QC machine compared against original source

Paths: `RR`, `MG1`, `MG3`, `CTF` = `<scratchpad>/upstream/quake-rerelease-qc/{quakec,quakec_mg1,quakec_mg3,quakec_ctf}`; `WQ` = `<scratchpad>/upstream/Quake/WinQuake`; `QWQC` = `<scratchpad>/upstream/Quake/qw-qc`; `q1/` = `src/content/q1/`. Port paths are at HEAD fcdc8af5.

Nothing from `upstream/` was executed. Map counts are read-only queries of the existing entity dump `<scratchpad>/src2q1/ents-rr.json`. No finding below was run; all are `traced`.

## Coverage

**Port read in full, every line:**
- q1/quakec/** (2,205 lines, not the 1,680 in the assignment): id1-program, id1-damage, id1-attacks, id1-projectiles, id1-environment, id1-pickups, armor-points, armor-stage, damage-call, damage-scale, pickup-callers, pickup-stage, weapon-stage-declaration, weapon-stage.
- q1/addons/ctf/{drops,arsenal,grapple,maps,observer,travel}.ts, plus flags, scoring, state and index again.
- q1/addons/campaign.ts 60-225.
- q1/addons/items/{weapons,commands}.ts.
- src/compat/qc/machine.ts, memory.ts, save.ts, borrowed-actors.ts.
- src/compat/qc/mod-{actors,clients,combat,commands,environment,input,items,messages,objectives,pickups,protection}.ts.
- src/compat/qc/{message-effects,message-routing,quakeworld-presentation,weapon-behavior-profile}.ts.
- src/compat/qc/mod-provider.ts 1-254 and 500-967.

**Original opened and compared:**
| Original | How it was read |
|---|---|
| WQ pr_exec.c | Full file, opened this time |
| WQ pr_edict.c | ED_Write and value-string formats, ED_ParseEdict and ED_LoadFromFile against save.ts. PR_LoadProgs seen only at its error lines |
| CTF teamplay.qc | 539-1249 |
| CTF ctfgame.qc, observ.qc, status.qc | Full |
| CTF client.qc | 19-905 and 1330-1764 |
| CTF items.qc | RankForWeapon, Deathmatch_Weapon, BackpackTouch, weapon_touch ammo lines |
| CTF weapons.qc | W_BestWeapon, W_Attack, W_ChangeWeapon start, ImpulseCommands, W_WeaponFrame, rune sounds |
| MG3 mg3_weapons.qc | Laser launch and fire, HIP_FireMjolnir, HIP_FireMjolnirLightning. Laser touch and lightning chain code was not compared |
| MG3 items_runes.qc, MG1 items_runes.qc (touch and spawn), map_specific/hub.qc, map_specific/mge2m2.qc, func_bossgate | Read against campaign.ts |
| MG1 and MG3 client, player, weapons | Whitespace-normalized diffs against RR with comment-only lines removed. Lines the two trees share with RR were therefore compared only as far as earlier reviews compared RR |
| MG3 items | Diff against RR from the health block on |

**Not compared. Treat as unaudited, not clean:**
- MG1 client.qc diff beyond PutClientInServer, and MG1 items.qc diff. I relied on the shared preprocessor defines and on grep hits for the coop and rune code.
- CTF client.qc 905-1330 (shared movement and PlayerPreThink code) and the obituary text after 1764. CTF items.qc rune section against runes.ts. CTF combat.qc beyond the carrier hurt lines.
- q1/addons/brushes.ts 100-190, q1/equipment/threewave-weapon.ts animation against weapons.qc.
- MG3 LightningDamage particle color 246 (RR 225): I did not trace which color the port's `blood` effect draws.
- q1/quakec pinned statement numbers: read against QuakeC meaning only. I did not disassemble retail progs to re-check each statement index. The constructors verify them at load.
- q1/addons/monsters/** and the MG1 `monster_boss` weapon gates, excluded by assignment.
- QW pr_cmds.c and QWQC beyond the combat.qc quad line.

## Strengths
- machine.ts matches pr_exec.c after opening the file:
  - Stack and locals limits and their off-by-one (`frames.length + 1 >= 32`, `localWords + c > 2048`).
  - A per-entry 100000 runaway count, parameter copying, raw-word IF and IFNOT, sequential overlapping stores, `NOT_S`, `NOT_ENT`, `STATE` at time + 0.1, and `ADDRESS` world protection.
  - `functionAt(0)` raises where the source raises "NULL function".
- save.ts follows ED_ParseEdict and ED_Write exactly: angle hack, `light_lev`, trailing-space trim for NetQuake only, `_` keys dropped, `_x` fields skipped on write, the `%f` formatting, and global filtering by save flag and type.
- message-effects.ts, message-routing.ts and quakeworld-presentation.ts reproduce the QW temp-entity colors and counts, the 1024-unit PHS rule, and the QW punch quirk where the kick is dropped before the view reads it.
- CTF flag state, carrier offsets (including the overlapping frame 112 branches), the 30-second drop return, vote leader selection, the observer flight math, `normalize` without assignment in ObserverTeleporter, and the odd red-team second flag bonus all match the source, several with explanatory comments.
- Hammer double-hit, laser frame alternation, cycle order, W_BestWeapon omissions, `respawn_ammo` and mg3WeaponRank match MG3.
- The bytecode analyzers in q1/quakec reject rather than guess: every pinned site is verified against the artifact at load, and id1DamageMultiplier matches QWQC combat.qc:152.
- Candidates dropped after checking:
  - `samelevel` in CTF: `requestExit` applies it at intermission exit (q1/base/rules.ts:215-218).
  - MG3 weapon rank: `mg3WeaponRank` covers the laser.
  - The `trigger_voteexit` unconditional objerror: the port documents its deliberate fix at maps.ts:71.
  - Hook team tests in grapple.ts match CTF hook.qc:123 and :195.

## Findings

### SRC4Q1B-001 — MG1 and MG3 coop checkpoints activate every spawn point on the map, and respawning players keep no team weapons
- **Verification (VERIFY-T): confirmed. Final severity: High.** MG3 client.qc:681,:948-952,:1038-1075,:1100-1101 are as cited; spawns.ts:253-258 activates every point and removes the trigger, and rules.ts:47-51 allows all points before any fire. Recount: 45 triggers on 12 maps, no models, 176 of 228 gated, mge2m2 7 and 28.
- Severity: High
- Category: bug
- Location: src/content/q1/foundation/spawns.ts:105-112, :253-258; src/content/q1/base/rules.ts:47-51
- Confidence: traced
- Evidence:
  - Original use function, MG3 client.qc:1038-1075 (MG1 :1081-1118): `if(s.targetname == self.target) { s.state = COOP_SPAWN_ACTIVE; s.items = it; } else { s.state = 0; s.items = 0; }`, where `it` is every weapon held by any player.
  - Original spawn point, MG3 client.qc:1100-1101 (MG1 :1143-1144): `if(!self.targetname) self.state = COOP_SPAWN_ACTIVE; if(self.spawnflags & COOP_SPAWN_START_ACTIVE) ...`.
  - Original selection, MG3 client.qc:681 (MG1 :729): `while( lastspawn.state != COOP_SPAWN_ACTIVE )`.
  - Original respawn, MG3 client.qc:948 (MG1 :994): `self.items |= (spot.items & IT_ALL_WEAPONS);` under `COOP_RESPAWN_KEEP_WEAPONS`, which both progs.src define, then ammo floors of 30 nails, 4 rockets, 12 cells.
  - Port: `for (const candidate of game.entities.values()) if (candidate.classname === "info_player_coop") candidate.activated = true;`, with no target test, then the trigger removes itself. A grep for `COOP_SPAWN`, `spot.items` and any keep-weapons equivalent in q1/ finds nothing.
  - Port selection: `activated = entities.some(...); coopPoint = ... (!activated || entity.activated)`, so before any trigger fires all points are eligible.
  - Map data: 45 triggers on 12 maps (MG1 mge1m1 through mge5m2, MG3 map5), all point entities with no model. 176 of the 228 info_player_coop on those maps have a targetname and no start-active flag, meaning they are late-map checkpoints. For example, mge2m2 has 7 triggers and 28 gated points.
- Impact: Coop players respawn from level start in the last checkpoint groups, including rooms beyond locked progression and past triggers. After the first checkpoint fires, earlier and later groups stay eligible, so rotation scatters players across the whole map. Dead players lose every weapon where the source restores those the team held. The source's reusable and backward-moving checkpoints are also lost, because the port removes the trigger after one use.
- Remediation: Give MG programs the source state per spawn point (active flag, carried weapons), filter by `target`, keep the trigger, and apply the weapon and ammo grant on coop respawn. The comment at spawns.ts:106 describing a touched brush does not match these maps, and I found no such entity in RR QC.

### SRC4Q1B-002 — MG1 and MG3 coop pickups never respawn for other players, and item `wait` is ignored
- **Verification (VERIFY-T): confirmed. Final severity: Medium.** MG3 items.qc:232-236,:285-306 are as cited; pickups.ts:409-414 consumes coop items once and ignores wait. MG1 1,219 and MG3 2,752 match (MG3 includes 413 shards). Coop matches vanilla id1 behavior and blocks nothing, so Medium rather than High; `wait` applies in all modes.
- Severity: High
- Category: bug
- Location: src/content/q1/foundation/pickups.ts:409-414; src/content/q1/addons/items/index.ts:17
- Confidence: traced
- Evidence:
  - MG3 items.qc:232-236 at health_touch: `if (coop && other == self.enemy && self.wait <= 0) return; self.enemy = other;`.
  - MG3 items.qc:285-300 onward: `if(coop && self.wait <= 0) { self.cnt++; if(self.cnt < num_players) { self.nextthink = time + 1; self.think = SUB_regen; } else { self.enemy = world; self.cnt = 0; self.nextthink = time + 6 * 60; ...`, with 8 minutes for armor and 4 for ammo. The same blocks are at MG3 :356, :390, :790, :864 and MG1 :188, :236, :307, :341, :722, :796. `COOP_RESPAWN_ITEMS_FOR_PLAYERS` is defined in both progs.src at line 15.
  - Both also add `else if (self.wait) { self.nextthink = time + self.wait; self.think = SUB_regen; }`.
  - Port: `const respawns = game.options.deathmatch !== 0 && respawn > 0 && ...`, so coop items are consumed once. The only add-on rule registered for MG3 is `weaponRank`. A grep for `num_players` or equivalent finds nothing. `entity.wait` is honored only by add-on items (addons/items/pickups.ts:52, lavasuit.ts:20).
  - Map data: 1,219 MG1 and 2,752 MG3 health, armor and ammo pickups. `wait` appears on 7 MG1 ammo items, for example.
- Impact: In MG coop one player takes each health, armor or ammo item and the others get nothing. The source gives each player a share and refills after minutes as a stuck-game safeguard. Mapped `wait` respawners never return in any mode, which can leave authored resupply points empty.
- Remediation: Add the source coop share rule and `wait` handling to the MG pickup path, including the same-player refusal.

### SRC4Q1B-003 — MG3 sigils with flag 128 are visible and collectable from map start
- **Verification (VERIFY-T): confirmed. Final severity: Medium.** MG3 items.qc:91-98,:127-133 hide and bind; ad/campaign.ts:156-167 stores the flag, sets trigger and model, binds no use. map8 sigil flags 136, targetname rune.
- Severity: Medium
- Category: bug
- Location: src/content/q1/addons/campaign.ts:156-167, :101-105
- Confidence: traced
- Evidence:
  - MG3 items.qc:91-98 in PlaceItem: `if (self.classname == "item_sigil") { if (self.spawnflags & 128) { self.model = string_null; self.solid = SOLID_NOT; } }`.
  - MG3 items.qc:127-133 in StartItem: `self.use = SUB_regen`.
  - Port stores the flag (`entity.spawnflags = bit | spawned`), then sets `entity.solid = "trigger"`, a model and a touch, and never binds `use` or hides the entity. `drop_item` only places it.
  - Map data: mg3 map8 `item_sigil` has spawnflags 136 and targetname `rune`. The only other MG3 sigils have flags 1, 4 and 2.
- Impact: map8's rune can be taken without its trigger sequence, setting the rune serverflag early, and firing the trigger later does nothing.
- Remediation: Apply the hidden state and `SUB_regen` use in the sigil spawn and place steps.

### SRC4Q1B-004 — CTF `impulse 21` keeps the thrown weapon selected and firable, so a player can throw unlimited copies; picked-up thrown weapons are never selected
- **Verification (VERIFY-T): confirmed. Final severity: Medium.** CTF teamplay.qc:755-758,:846-847 reselect; ad/ctf/drops.ts:41-47 ignores the consume result. runtime.ts:1293 weaponChanged only recopies, and activeWeapon derives from state.weapon (runtime.ts:4643). fireWeapon sends base weapons to fireBaseWeapon (weapons.ts:149-161), which has no ownership test, unlike fireRegisteredWeapon.
- Severity: Medium
- Category: bug
- Location: src/content/q1/addons/ctf/drops.ts:41-47, :62; src/app/bootstrap/simulation/runtime.ts:1293; src/content/composition/q1/runtime.ts:122; src/content/q1/foundation/weapons.ts:155-161; src/world/gameplay/inventory.ts:286
- Confidence: traced
- Evidence:
  - CTF teamplay.qc:846-847: `self.weapon = W_BestWeapon (); W_SetCurrentAmmo ();`.
  - CTF teamplay.qc:755-758: `if (!deathmatch) self.weapon = new; else Deathmatch_Weapon (old, new);`.
  - Port: `state.game.host.inventory.consume(state.owner(actor), definition.item, 1); launch(...); return state.services.weaponChanged(actor, null);`. Production `weaponChanged: actor => { const player = this.requirePlayer(actor); player.arsenal = this.arsenal(player); return undefined; }` only copies state, ignoring both the acquired argument and selection.
  - `consumeCanonical` returns false when `entry.count < count`, and drops.ts ignores the result, so nothing stops a second throw.
  - tossWeapon's only checks are the selected weapon and `deathmatch === 1`. `selectedWeapon` still reads `state.weapon`.
  - `fireBaseWeapon` checks ammunition, not ownership, so the rocket launcher keeps firing.
  - The test fixture stubs `weaponChanged` (tests/composition/q1/source.test.ts:71), so this path is not exercised.
- Impact: With `teamplay & 128` in deathmatch 1, any player can hold the throw impulse and spawn rocket launchers without limit, each entity living 120 seconds, while still firing the one they threw. A pickup of a thrown weapon never switches to it, even when it outranks the current one.
- Remediation: Select the best weapon after a throw, apply Deathmatch_Weapon selection on the acquired item, and refuse the throw when the consume fails.

### SRC4Q1B-005 — A tossed CTF backpack has no owner delay, so the thrower recollects it at once, and it prints nothing
- **Verification (VERIFY-T): confirmed. Final severity: Medium.** CTF items.qc:1356-1358 and teamplay.qc:683-684 are as cited; drops.ts:50-55 touch has no owner or time test and no message, while the weapon touch at :58 has its test. Bounds overlap the thrower (drops.ts:24-30).
- Severity: Medium
- Category: bug
- Location: src/content/q1/addons/ctf/drops.ts:50-55, :24-30
- Confidence: traced
- Evidence: TossBackpack sets `item.touch = BackpackTouch; item.nextthink = time + 120` (CTF teamplay.qc:683-684). CTF items.qc:1356-1358: `//don't let self pick it up for a sec` then `if ((other == self.owner) && ( (self.nextthink - time) > 118 ) ) return;`. Items.qc:1361-1428 prints `$qc_backpack_got` and each ammo line. Port touch: `if (!game.isPlayer(actor) || game.health(actor) <= 0 || state.services.observer(actor)) return undefined; for (const type of ammoTypes) ...give...`, with no owner or time test and no message. The sibling weapon touch at drops.ts:58 does have its check. The pack spawns at the player's origin + 16 with a 32x32x56 trigger box, which overlaps the thrower.
- Impact: `impulse 20` removes up to 20 ammo and returns it on the next touch, so a player cannot pass ammo to a teammate, which is the purpose of the feature. Recipients get no pickup text.
- Remediation: Add the 118-second remaining-time owner test and the source's print sequence.

### SRC4Q1B-006 — CTF telefrags penalize the victim and do not credit the telefragger
- **Verification (VERIFY-T): confirmed. Final severity: Medium.** CTF client.qc:1453-1460 credits the owner and returns; spawns.ts:351 makes the teledeath entity the attacker, runtime.ts:195 bypasses obituary.score, and scoring.ts:33 penalizes the victim.
- Severity: Medium
- Category: bug
- Location: src/content/q1/addons/ctf/scoring.ts:33; src/content/composition/q1/runtime.ts:188-197; src/content/q1/foundation/spawns.ts:351
- Confidence: traced
- Evidence: CTF client.qc:1453-1460: `if (attacker.classname == "teledeath") { ... attacker.owner.frags = attacker.owner.frags + 1; ... return; }`. Port: `tdeath_touch` calls `runtime.damage(victim, entity.actor.id, entity.actor.id, 50000, ...)`, so the attacker is the teledeath entity. The runtime calls `this.ctf.death(actor.id, attacker)` instead of applying the computed `obituary.score`. scoreDeath begins `if (attacker === null || !game.isPlayer(attacker) || sameActor(attacker, victim)) { services.addScore(victim, -1); return undefined; }`. The `teledeath2` -1 case is right by coincidence. The source's early return also skips the carrier scoring.
- Impact: Every CTF telefrag scores -1 to the victim and 0 to the spawning player, where the source gives 0 and +1. CTF spawn rooms make this routine.
- Remediation: Handle `teledeath` in scoreDeath through the entity owner before the non-player branch.

### SRC4Q1B-007 — MG3 cell boxes hold 12 and 6; the source gives 20 and 10
- **Verification (VERIFY-T): confirmed. Final severity: Medium.** MG3 items.qc:997-1005 give 20 and 10; pickups.ts:64 gives 12 and 6 with no MG3 rule; MG1 keeps 12 and 6. Counts 152, 95 big match.
- Severity: Medium
- Category: bug
- Location: src/content/q1/foundation/pickups.ts:64
- Confidence: traced
- Evidence: MG3 items.qc:997-998 `//self.aflag = 12; self.aflag = 20;` and :1004-1005 `//self.aflag = 6; self.aflag = 10; // AY, Feb 21 2026, bumping up count`. Port: `name === "item_cells" ? { ..., amount: big ? 12 : 6 }`, with no MG3 rule over it. MG1 items.qc:929 and :935 keep 12 and 6, so this is MG3-only. Map data: 152 MG3 `item_cells` (95 big, 57 small).
- Impact: MG3 cell supply is 60% of the authored amount, which also starves the laser cannon and hammer lightning that cost cells.
- Remediation: Give the MG3 program the source amounts.

### SRC4Q1B-008 — MG weapon targets never fire when the weapon stays, so coop misses authored ambushes and events
- **Verification (VERIFY-T): confirmed. Final severity: Medium.** MG3 items.qc:660-665 fires targets before the leave test; pickups.ts:404 skips weapons on leave, while ad/items/pickups.ts:48-50 follows the source for its own items. 15 weapons with targets match.
- Severity: Medium
- Category: bug
- Location: src/content/q1/foundation/pickups.ts:404
- Confidence: traced
- Evidence: MG3 items.qc:660-665 (MG1 :592-597) moves the target call ahead of the leave test: `activator = other; SUB_UseTargets(); ... if (leave) { self.target = string_null; return; }`. RR and the base port return first. Port: `if (leave) { if (!entity.classname.startsWith("weapon_")) game.useTargets(entity, other); return; }`. Add-on weapons at addons/items/pickups.ts:48-49 follow the source, but ordinary `weapon_*` do not. Map data: 15 MG weapons have a target (MG1 10, MG3 5), including mge1m2 `ambush7`, mge2m1 `pickup_gl` and mge4m2 `TeleportRoomSpawn`.
- Impact: In coop and in deathmatch modes where weapons stay, these triggers never fire on the first pickup, so ambushes do not spawn. Maps that open a route from one would block progress; I did not walk each of the 15.
- Remediation: For MG programs, fire targets before the leave return and clear the target once.

### SRC4Q1B-009 — CTF carrier death does not clear enemies' carrier-hurt timers
- **Verification (VERIFY-T): confirmed. Final severity: Low.** CTF client.qc:1440-1449 clears the enemies' timers; lastHurtCarrier has writes at flags.ts:43, index.ts:32, runes.ts:80 and the read at scoring.ts:47, and none on carrier death.
- Severity: Low
- Category: bug
- Location: src/content/q1/addons/ctf/scoring.ts:47; src/content/q1/addons/ctf/index.ts:83-85
- Confidence: traced
- Evidence: CTF client.qc:1440-1449: `if (targ.player_flag & ITEM_ENEMY_FLAG) { head = find(world, classname, "player"); while (head != world) { if (head.team != targ.team) { head.last_hurt_carrier = -10; } ...`. A grep for `lastHurtCarrier` finds only the writes at flags.ts:43, index.ts:32 and runes.ts:80, and the read at scoring.ts:47.
- Impact: Killing an enemy who just killed your carrier awards the +2 aggressive defense bonus and its broadcast, where the source awards neither.
- Remediation: Reset the timer for all opposing players at the start of scoreDeath when the victim carries.

### SRC4Q1B-010 — CTF assist and carrier timers survive respawn
- **Verification (VERIFY-T): confirmed. Final severity: Low.** CTF client.qc:174-177 resets four timers; ad/ctf/index.ts:32 resets one. The other three have no reset in ad/ctf and default to 0 (flags.ts:41-42).
- Severity: Low
- Category: bug
- Location: src/content/q1/addons/ctf/index.ts:32; src/content/q1/addons/ctf/flags.ts:41-42
- Confidence: traced
- Evidence: CTF client.qc:174-177 in DecodeLevelParms, called by every PutClientInServer: `self.last_returned_flag = -10; self.last_fragged_carrier = -10; self.flag_since = -10; self.last_hurt_carrier = -10;`. Port resets only `lastHurtCarrier`. `lastReturned`, `lastFraggedCarrier` and `flagSince` default to 0, so `0 + 4 > game.time` and `0 + 6 > game.time` are also true early in a map.
- Impact: A player who returned a flag or fragged a carrier and then died still gets the capture assist. A capture in the first seconds of a map would award assists to the whole team, though that capture is unlikely.
- Remediation: Reset all four in `spawnPlayer` to -10.

### SRC4Q1B-011 — Observers get "your flag" center prints
- **Verification (VERIFY-T): confirmed. Final severity: Low.** CTF teamplay.qc:1010-1014,:1066-1070 require a real team relation; flags.ts:44,:57 use a two-way ternary, so a null team takes the else branch.
- Severity: Low
- Category: bug
- Location: src/content/q1/addons/ctf/flags.ts:44, :57
- Confidence: traced
- Evidence: CTF teamplay.qc:1010-1014 prints `$qc_ctf_your_captured` only when the two teams are the opposite real teams, and :1013 `$qc_ctf_team_captured` only for the same team. Lines 1066-1070 do the same for pickups. Port: `state.lastTeam(player) === team ? "$qc_ctf_team_captured" : "$qc_ctf_your_captured"` and `state.team(player) === team ? "$qc_ctf_your_has" : "$qc_ctf_your_taken"`, so a team-less observer takes the else branch.
- Impact: Observers are told their flag was captured or taken.
- Remediation: Test for the opposite team explicitly.

### SRC4Q1B-012 — CTF changelevel and vote destinations differ from GotoNextMap, and `$qc_exited` prints outside coop and deathmatch
- **Verification (VERIFY-T): confirmed. Final severity: Low.** CTF client.qc:226-244,:252,:314,:417 route through GotoNextMap in deathmatch, and :404-408 gates the print. ad/ctf/maps.ts:40,:55,:61-63 honor the map and print unconditionally. Likely a sensible divergence, as the finding says.
- Severity: Low
- Category: bug
- Location: src/content/q1/addons/ctf/maps.ts:40, :55, :61-63
- Confidence: traced
- Evidence: CTF client.qc:226-244: GotoNextMap overwrites `nextmap` from `mapname` (ctf1 to ctf9, otherwise ctf1) and calls `changelevel (nextmap)`, and ExitIntermission calls it in deathmatch. So in this source `vote_leader.map` (:763) and a trigger's `self.map` (:411) are discarded: every vote on `start` ends on ctf1. Port honors `leader.text("map")` and `entity.text("map")`. CTF client.qc:406: `if (coop || deathmatch) bprint("$qc_exited", ...)`; port: unconditional `state.announce("$qc_exited", actor)`.
- Impact: The port's vote works as the design intended, and differs from what the released rerelease QC does. This is reported so the divergence is a recorded decision, as maps.ts:71 records for the voteexit objerror.
- Remediation: Keep the voted map if intended and say so in a comment. Add the mode test to the exit print.

### SRC4Q1B-013 — CTF spawn fallback always uses the first deathmatch point
- **Verification (VERIFY-T): confirmed. Final severity: Low.** CTF client.qc:534-549 rotates deathmatch points; ad/ctf/teams.ts:50-51 returns the first for empty team spot lists. 14 maps in the ctf archive lack info_player_team1.
- Severity: Low
- Category: bug
- Location: src/content/q1/addons/ctf/teams.ts:50-51
- Confidence: traced
- Evidence: CTF client.qc:534-549: when TeamCaptureSpawn returns world, the code falls through to `lastspawn = find(lastspawn, classname, "info_player_deathmatch")`, a rotation. Port: `if (spot === null) return entities.find(entity => entity.classname === "info_player_deathmatch") ?? ...`. `killed` is cleared for every player at each capture (flags.ts:38), so this branch recurs.
- Impact: On a map with no `info_player_team1` or `info_player_team2`, every unkilled player spawns on one point and telefrags, where the source rotates.
- Remediation: Rotate through the deathmatch points in the fallback.

### SRC4Q1B-014 — MG1 and MG3 GRENADE_BOUNCE_FIX and the bounce sound limit are not ported
- **Verification (VERIFY-T): confirmed. Final severity: Low.** MG3 weapons.qc:586-612,:638-640 and both progs.src:9 are as cited; foundation/weapons.ts:83-84,:96 schedule only a 2.5 s explode and play bounce unconditionally.
- Severity: Low
- Category: bug
- Location: src/content/q1/foundation/weapons.ts:96
- Confidence: traced
- Evidence: Both progs.src line 9 define `GRENADE_BOUNCE_FIX`. MG3 weapons.qc:586-612 (MG1 :549-575) GrenadeThink runs every 0.05 s, and when velocity is 0 after moving downward above 120 units it reflects the old velocity off the floor at 0.6, clears FL_ONGROUND and sets `avelocity`. It explodes at `cnt == 50`, which is 2.5 s, as before. MG3 :638 (MG1 :595): `if(self.attack_finished < time) sound (... "weapons/bounce.wav" ...); self.attack_finished = time + 0.1;`. Port: `return game.sound(entity, "weapons/bounce.wav", "weapon");`, and a grep for the think or a reflect finds nothing.
- Impact: Grenades stick on downward slopes where the source makes them roll on, changing where they detonate. Bounce sounds can stack.
- Remediation: Add both to the add-on grenade rules.

### SRC4Q1B-015 — MG3 super shamblers take full direct rocket damage
- **Verification (VERIFY-T): confirmed. Final severity: Low.** MG3 weapons.qc:384 includes the super shambler; foundation/weapons.ts:114 tests monster_shambler only. The entity keeps classname monster_super_shambler (heavy/super-shambler.ts:93,:105), so the halving never applies.
- Severity: Low
- Category: bug
- Location: src/content/q1/foundation/weapons.ts:114
- Confidence: traced
- Evidence: MG3 weapons.qc:384: `if ((other.classname == "monster_shambler") || (other.classname == "monster_super_shambler"))`, with damage halved. Port: `if (game.host.classname(direct) === "monster_shambler") amount *= 0.5;`. super-shambler.ts has no rocket damage rule that I could find by grep; the monster files were not read in full, as assigned.
- Impact: Rockets deal double the intended direct damage to this boss-class monster, shortening the fight.
- Remediation: Extend the test for the MG3 program.

### SRC4Q1B-016 — A hammer strike still lands after the wielder dies
- **Verification (VERIFY-T): confirmed. Final severity: Low.** MG3 player.qc:259,:264 fire from frames; ad/items/weapons.ts:60-65,:95-98 schedule a separate entity and test only null.
- Severity: Low
- Category: bug
- Location: src/content/q1/addons/items/weapons.ts:60-65, :95-98
- Confidence: traced
- Evidence: MG3 player.qc:259 and :264 call `HIP_FireMjolnir()` from an animation frame, and PlayerDie replaces that think chain, so a dead player never reaches it. Port schedules a separate `mg3_hammer_strike` entity for 0.2 s later, and `hammerStrike` tests only `player === null || body === null`, not health. CONTENT1-014 reports the same class for the axe; this is a separate code path it does not name.
- Impact: A player killed during the wind-up still deals 40 to 120 damage from the corpse.
- Remediation: Return early from hammerStrike when health is 0 or less.

### SRC4Q1B-017 — MG deathmatch map rotation is missing
- **Verification (VERIFY-T): confirmed-with-changes. Final severity: Low.** MG3 client.qc:1150-1168 is as cited and `mgdm` is absent from src/content and src/app. Change: only mgdm1 is wrong, repeating via rules.ts:211. The triggers on mgdm2, 3 and 4 point to mgdm3, 4 and 1, which is the authored rotation, so the claim about the others is false.
- Severity: Low
- Category: bug
- Location: src/content/q1/base/rules.ts:204-211
- Confidence: traced
- Evidence: MG3 client.qc:1150-1168 and MG1 client.qc:1193 onward: `else if (world.model == "maps/mgdm1.bsp") { o = spawn(); o.map = "mgdm2"; }`, continuing through mgdm4 to mgdm1, ahead of the trigger_changelevel lookup. Port: `next = [...].find(entity => entity.classname === "trigger_changelevel")?.text("map") || next`, and a grep for `mgdm` finds nothing in src/content or src/app. Map data: mgdm1 has no trigger_changelevel and mgdm2 through mgdm4 have one each.
- Impact: At a frag or time limit mgdm1 repeats forever, and the others go wherever their trigger points, not through the authored rotation.
- Remediation: Add the rotation for MG programs.

### SRC4Q1B-018 — Observer door and teleporter search takes the lowest entity and includes non-solid ones
- **Verification (VERIFY-T): confirmed. Final severity: Low.** WQ pr_cmds.c:888-906 skips SOLID_NOT and builds the chain highest entity first; CTF observ.qc:235 stops at the first match; ad/ctf/observer.ts:52-57 iterates ascending with no solid test.
- Severity: Low
- Category: bug
- Location: src/content/q1/addons/ctf/observer.ts:52-57
- Confidence: traced
- Evidence: CTF observ.qc:235 (`e = findradius(self.origin,75)`) stops at the first match in the returned chain. WQ pr_cmds.c PF_findradius (from :873) skips `SOLID_NOT` and builds the chain with the highest-numbered entity first (`ent->v.chain = EDICT_TO_PROG(chain); chain = ent;`). Port iterates `game.entities.values()` ascending with no solid test, then `break`s at the first match.
- Impact: Near both a door and a teleporter the observer interacts with a different entity than in the original. A non-solid `func_door` can capture the search.
- Remediation: Iterate in descending order and skip non-solid entities.
